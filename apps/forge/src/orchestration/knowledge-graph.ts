/**
 * Knowledge Graph (Phase 11)
 * Entity-relationship graph built from agent executions.
 * Nodes are concepts/entities, edges are relationships between them.
 * Uses pgvector for semantic node search.
 */

import { query } from '../database.js';
import { ulid } from 'ulid';
import { generateEmbedding } from '../memory/embeddings.js';
import { runCliQuery } from '../runtime/worker.js';

export interface KnowledgeNode {
  id: string;
  agent_id: string | null;
  label: string;
  entity_type: string;
  description: string | null;
  properties: Record<string, unknown>;
  mention_count: number;
}

export interface KnowledgeEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  properties: Record<string, unknown>;
}

/**
 * Extract entities and relationships from execution output.
 * Uses LLM to parse unstructured text into graph nodes and edges.
 */
export async function extractKnowledge(
  agentId: string,
  executionOutput: string,
  executionInput?: string,
): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
  if (executionOutput.length < 100) {
    return { nodes: [], edges: [] };
  }

  const prompt = `Extract key entities and relationships from the following text. Return ONLY valid JSON (no markdown fences):

INPUT CONTEXT: ${(executionInput ?? '').substring(0, 300)}

OUTPUT TEXT:
${executionOutput.substring(0, 2000)}

Return:
{
  "entities": [
    { "label": "entity name", "type": "concept|person|tool|service|file|error|pattern", "description": "brief description" }
  ],
  "relationships": [
    { "source": "entity A label", "target": "entity B label", "relation": "uses|depends_on|causes|fixes|relates_to|contains|produces" }
  ]
}

Rules:
- Extract 0-8 entities (only significant ones worth remembering)
- Extract 0-6 relationships
- Return {"entities":[],"relationships":[]} if nothing notable
- Focus on technical entities: tools, services, patterns, errors`;

  try {
    const result = await runCliQuery(prompt, {
      model: 'claude-haiku-4-5',
      maxTurns: 1,
      timeout: 30000,
    });

    if (result.isError) return { nodes: [], edges: [] };

    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { nodes: [], edges: [] };

    const parsed = JSON.parse(jsonMatch[0]) as {
      entities: Array<{ label: string; type: string; description?: string }>;
      relationships: Array<{ source: string; target: string; relation: string }>;
    };

    const nodes: KnowledgeNode[] = [];
    const nodeMap = new Map<string, string>(); // label → id

    // Upsert nodes
    for (const entity of (parsed.entities ?? []).slice(0, 8)) {
      const normalizedLabel = entity.label.toLowerCase().trim();
      if (!normalizedLabel || normalizedLabel.length < 2) continue;

      // Check if node exists
      const existing = await query<{ id: string; mention_count: number }>(
        `SELECT id, mention_count FROM forge_knowledge_nodes WHERE LOWER(label) = $1 AND (agent_id = $2 OR agent_id IS NULL) LIMIT 1`,
        [normalizedLabel, agentId],
      );

      let nodeId: string;
      if (existing.length > 0) {
        nodeId = existing[0]!.id;
        await query(
          `UPDATE forge_knowledge_nodes SET mention_count = mention_count + 1, last_mentioned = NOW() WHERE id = $1`,
          [nodeId],
        );
      } else {
        nodeId = ulid();
        const embedding = await generateEmbedding(normalizedLabel + ' ' + (entity.description ?? '')).catch(() => null);
        const vecLiteral = embedding ? `[${embedding.join(',')}]` : null;

        await query(
          `INSERT INTO forge_knowledge_nodes (id, agent_id, label, entity_type, description, embedding)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [nodeId, agentId, normalizedLabel, entity.type || 'concept', entity.description ?? null, vecLiteral],
        );
      }

      nodeMap.set(normalizedLabel, nodeId);
      nodes.push({
        id: nodeId, agent_id: agentId, label: normalizedLabel,
        entity_type: entity.type || 'concept', description: entity.description ?? null,
        properties: {}, mention_count: (existing[0]?.mention_count ?? 0) + 1,
      });
    }

    // Create edges
    const edges: KnowledgeEdge[] = [];
    for (const rel of (parsed.relationships ?? []).slice(0, 6)) {
      const sourceId = nodeMap.get(rel.source.toLowerCase().trim());
      const targetId = nodeMap.get(rel.target.toLowerCase().trim());
      if (!sourceId || !targetId || sourceId === targetId) continue;

      // Check for existing edge
      const existingEdge = await query<{ id: string; weight: number }>(
        `SELECT id, weight::float AS weight FROM forge_knowledge_edges
         WHERE source_id = $1 AND target_id = $2 AND relation = $3 LIMIT 1`,
        [sourceId, targetId, rel.relation],
      );

      let edgeId: string;
      if (existingEdge.length > 0) {
        edgeId = existingEdge[0]!.id;
        await query(
          `UPDATE forge_knowledge_edges SET weight = LEAST(1.0, weight + 0.1) WHERE id = $1`,
          [edgeId],
        );
      } else {
        edgeId = ulid();
        await query(
          `INSERT INTO forge_knowledge_edges (id, source_id, target_id, relation, weight)
           VALUES ($1, $2, $3, $4, 0.5)`,
          [edgeId, sourceId, targetId, rel.relation],
        );
      }

      edges.push({
        id: edgeId, source_id: sourceId, target_id: targetId,
        relation: rel.relation, weight: existingEdge[0]?.weight ?? 0.5, properties: {},
      });
    }

    return { nodes, edges };
  } catch (err) {
    console.warn(`[KnowledgeGraph] Extraction failed:`, err instanceof Error ? err.message : err);
    return { nodes: [], edges: [] };
  }
}

/**
 * Semantic search for knowledge nodes.
 */
export async function searchNodes(
  queryText: string,
  options?: { limit?: number; entityType?: string; agentId?: string },
): Promise<Array<KnowledgeNode & { similarity: number }>> {
  const embedding = await generateEmbedding(queryText);
  const vecLiteral = `[${embedding.join(',')}]`;

  const filters: string[] = [];
  const params: unknown[] = [vecLiteral];
  let idx = 2;

  if (options?.entityType) {
    filters.push(`entity_type = $${idx++}`);
    params.push(options.entityType);
  }
  if (options?.agentId) {
    filters.push(`(agent_id = $${idx++} OR agent_id IS NULL)`);
    params.push(options.agentId);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const limit = options?.limit ?? 20;

  return query<KnowledgeNode & { similarity: number }>(
    `SELECT id, agent_id, label, entity_type, description, properties, mention_count,
            1 - (embedding <=> $1::vector) AS similarity
     FROM forge_knowledge_nodes
     ${where}
     ORDER BY embedding <=> $1::vector
     LIMIT ${limit}`,
    params,
  );
}

/**
 * Get the neighborhood of a node (connected edges and nodes).
 */
export async function getNodeNeighborhood(nodeId: string, depth: number = 1): Promise<{
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}> {
  // Get edges connected to this node
  const edges = await query<KnowledgeEdge>(
    `SELECT id, source_id, target_id, relation, weight::float AS weight, properties
     FROM forge_knowledge_edges
     WHERE source_id = $1 OR target_id = $1
     ORDER BY weight DESC LIMIT 50`,
    [nodeId],
  );

  // Get connected node IDs
  const connectedIds = new Set<string>();
  connectedIds.add(nodeId);
  for (const edge of edges) {
    connectedIds.add(edge.source_id);
    connectedIds.add(edge.target_id);
  }

  const nodeIds = Array.from(connectedIds);
  const nodes = nodeIds.length > 0
    ? await query<KnowledgeNode>(
        `SELECT id, agent_id, label, entity_type, description, properties, mention_count
         FROM forge_knowledge_nodes WHERE id = ANY($1)`,
        [nodeIds],
      )
    : [];

  return { nodes, edges };
}

/**
 * Get knowledge graph stats.
 */
/**
 * Get full graph data for visualization (paginated).
 * Returns nodes + edges suitable for force-directed graph rendering.
 */
export async function getFullGraph(options?: {
  limit?: number;
  offset?: number;
  entityType?: string;
  agentId?: string;
  minMentions?: number;
}): Promise<{
  nodes: Array<KnowledgeNode & { created_at: string; last_mentioned: string | null }>;
  edges: KnowledgeEdge[];
  total: number;
}> {
  const filters: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (options?.entityType) {
    filters.push(`n.entity_type = $${idx++}`);
    params.push(options.entityType);
  }
  if (options?.agentId) {
    filters.push(`n.agent_id = $${idx++}`);
    params.push(options.agentId);
  }
  if (options?.minMentions) {
    filters.push(`n.mention_count >= $${idx++}`);
    params.push(options.minMentions);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const limit = Math.min(options?.limit ?? 500, 2000);
  const offset = options?.offset ?? 0;

  const [nodes, countResult] = await Promise.all([
    query<KnowledgeNode & { created_at: string; last_mentioned: string | null }>(
      `SELECT id, agent_id, label, entity_type, description, properties, mention_count,
              created_at::text, last_mentioned::text
       FROM forge_knowledge_nodes n
       ${where}
       ORDER BY mention_count DESC, created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM forge_knowledge_nodes n ${where}`,
      params,
    ),
  ]);

  // Get edges for the returned nodes
  const nodeIds = nodes.map((n) => n.id);
  const edges = nodeIds.length > 0
    ? await query<KnowledgeEdge>(
        `SELECT id, source_id, target_id, relation, weight::float AS weight, properties
         FROM forge_knowledge_edges
         WHERE source_id = ANY($1) AND target_id = ANY($1)`,
        [nodeIds],
      )
    : [];

  return {
    nodes,
    edges,
    total: parseInt(countResult[0]?.count ?? '0'),
  };
}

/**
 * Get a single node by ID with its edge count.
 */
export async function getNodeById(nodeId: string): Promise<
  (KnowledgeNode & { created_at: string; last_mentioned: string | null; edge_count: number; agent_name: string | null }) | null
> {
  const row = await query<
    KnowledgeNode & { created_at: string; last_mentioned: string | null; edge_count: string; agent_name: string | null }
  >(
    `SELECT n.id, n.agent_id, n.label, n.entity_type, n.description, n.properties, n.mention_count,
            n.created_at::text, n.last_mentioned::text,
            (SELECT COUNT(*)::text FROM forge_knowledge_edges e
             WHERE e.source_id = n.id OR e.target_id = n.id) AS edge_count,
            a.name AS agent_name
     FROM forge_knowledge_nodes n
     LEFT JOIN forge_agents a ON a.id = n.agent_id
     WHERE n.id = $1`,
    [nodeId],
  );
  if (row.length === 0) return null;
  return { ...row[0]!, edge_count: parseInt(row[0]!.edge_count) };
}

/**
 * Get entity type distribution for visualization.
 */
export async function getEntityTypeDistribution(): Promise<
  Array<{ entity_type: string; count: number; avg_mentions: number }>
> {
  const rows = await query<{ entity_type: string; count: string; avg_mentions: string }>(
    `SELECT entity_type,
            COUNT(*)::text AS count,
            ROUND(AVG(mention_count), 1)::text AS avg_mentions
     FROM forge_knowledge_nodes
     GROUP BY entity_type
     ORDER BY COUNT(*) DESC`,
  );
  return rows.map((r) => ({
    entity_type: r.entity_type,
    count: parseInt(r.count),
    avg_mentions: parseFloat(r.avg_mentions),
  }));
}

/**
 * Get agent contributions to the knowledge graph.
 */
export async function getAgentContributions(): Promise<
  Array<{ agent_id: string; agent_name: string | null; node_count: number; top_types: string[] }>
> {
  const rows = await query<{ agent_id: string; agent_name: string | null; node_count: string; top_types: string }>(
    `SELECT n.agent_id,
            a.name AS agent_name,
            COUNT(*)::text AS node_count,
            STRING_AGG(DISTINCT n.entity_type, ',' ORDER BY n.entity_type) AS top_types
     FROM forge_knowledge_nodes n
     LEFT JOIN forge_agents a ON a.id = n.agent_id
     WHERE n.agent_id IS NOT NULL
     GROUP BY n.agent_id, a.name
     ORDER BY COUNT(*) DESC`,
  );
  return rows.map((r) => ({
    agent_id: r.agent_id,
    agent_name: r.agent_name,
    node_count: parseInt(r.node_count),
    top_types: r.top_types ? r.top_types.split(',') : [],
  }));
}

/**
 * Get most-connected hub nodes.
 */
export async function getTopConnectedNodes(limit: number = 20): Promise<
  Array<KnowledgeNode & { edge_count: number }>
> {
  const rows = await query<KnowledgeNode & { edge_count: string }>(
    `SELECT n.id, n.agent_id, n.label, n.entity_type, n.description, n.properties, n.mention_count,
            (SELECT COUNT(*) FROM forge_knowledge_edges e
             WHERE e.source_id = n.id OR e.target_id = n.id)::text AS edge_count
     FROM forge_knowledge_nodes n
     ORDER BY (SELECT COUNT(*) FROM forge_knowledge_edges e
               WHERE e.source_id = n.id OR e.target_id = n.id) DESC
     LIMIT ${Math.min(limit, 100)}`,
  );
  return rows.map((r) => ({ ...r, edge_count: parseInt(r.edge_count) }));
}

export async function getGraphStats(): Promise<{
  totalNodes: number;
  totalEdges: number;
  topEntities: Array<{ label: string; mention_count: number; entity_type: string }>;
  topRelations: Array<{ relation: string; count: number }>;
}> {
  const [nodeCount, edgeCount, topEntities, topRelations] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM forge_knowledge_nodes`),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM forge_knowledge_edges`),
    query<{ label: string; mention_count: number; entity_type: string }>(
      `SELECT label, mention_count, entity_type FROM forge_knowledge_nodes ORDER BY mention_count DESC LIMIT 10`,
    ),
    query<{ relation: string; count: string }>(
      `SELECT relation, COUNT(*)::text AS count FROM forge_knowledge_edges GROUP BY relation ORDER BY COUNT(*) DESC LIMIT 10`,
    ),
  ]);

  return {
    totalNodes: parseInt(nodeCount[0]?.count ?? '0'),
    totalEdges: parseInt(edgeCount[0]?.count ?? '0'),
    topEntities,
    topRelations: topRelations.map((r) => ({ relation: r.relation, count: parseInt(r.count) })),
  };
}
