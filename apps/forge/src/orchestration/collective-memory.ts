/**
 * Collective Memory — Shared Knowledge Graph
 *
 * Every agent execution adds edges to a growing knowledge graph.
 * The fleet builds a map of the entire system that no single agent has.
 *
 * Node types: concept, entity, event, pattern, decision, outcome
 * Edge types: causes, fixes, relates_to, depends_on, precedes, contradicts
 *
 * Agents query the graph for context before acting.
 * Dream Cycles consolidate and strengthen high-value paths.
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';

export interface KnowledgeNode {
  id: string;
  label: string;
  node_type: string;
  content: string;
  source_agent: string;
  confidence: number;
  access_count: number;
  created_at: string;
}

export interface KnowledgeEdge {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
  context: string;
  created_at: string;
}

/**
 * Add a knowledge node (concept, entity, event, pattern, decision, outcome).
 * Deduplicates by label — if a node with the same label exists, strengthens it.
 */
export async function addKnowledge(
  label: string,
  nodeType: string,
  content: string,
  sourceAgent: string,
  confidence: number = 0.7,
): Promise<string> {
  // Check for existing node with same label
  const existing = await queryOne<{ id: string; confidence: number; access_count: number }>(
    `SELECT id, confidence, access_count FROM forge_knowledge_nodes WHERE label = $1 LIMIT 1`,
    [label],
  );

  if (existing) {
    // Strengthen existing node
    const newConfidence = Math.min(1.0, existing.confidence + (confidence * 0.1));
    await query(
      `UPDATE forge_knowledge_nodes SET confidence = $1, access_count = access_count + 1, content = CASE WHEN LENGTH($2) > LENGTH(content) THEN $2 ELSE content END WHERE id = $3`,
      [newConfidence, content, existing.id],
    );
    return existing.id;
  }

  const id = ulid();
  await query(
    `INSERT INTO forge_knowledge_nodes (id, label, node_type, content, source_agent, confidence)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, label, nodeType, content, sourceAgent, confidence],
  );
  return id;
}

/**
 * Connect two knowledge nodes with a typed edge.
 */
export async function connectKnowledge(
  sourceLabel: string,
  targetLabel: string,
  edgeType: string,
  context: string = '',
  weight: number = 1.0,
): Promise<void> {
  const source = await queryOne<{ id: string }>(`SELECT id FROM forge_knowledge_nodes WHERE label = $1 LIMIT 1`, [sourceLabel]);
  const target = await queryOne<{ id: string }>(`SELECT id FROM forge_knowledge_nodes WHERE label = $1 LIMIT 1`, [targetLabel]);
  if (!source || !target) return;

  // Check for existing edge
  const existing = await queryOne<{ id: string; weight: number }>(
    `SELECT id, weight FROM forge_knowledge_edges WHERE source_id = $1 AND target_id = $2 AND edge_type = $3 LIMIT 1`,
    [source.id, target.id, edgeType],
  );

  if (existing) {
    await query(
      `UPDATE forge_knowledge_edges SET weight = $1, context = CASE WHEN LENGTH($2) > 0 THEN $2 ELSE context END WHERE id = $3`,
      [Math.min(10.0, existing.weight + weight * 0.2), context, existing.id],
    );
    return;
  }

  await query(
    `INSERT INTO forge_knowledge_edges (id, source_id, target_id, edge_type, weight, context)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ulid(), source.id, target.id, edgeType, weight, context],
  );
}

/**
 * Query the knowledge graph for context about a topic.
 * Returns the most relevant nodes and their connections.
 */
export async function queryKnowledge(topic: string, limit: number = 10): Promise<{
  nodes: KnowledgeNode[];
  edges: { source: string; target: string; type: string; weight: number }[];
}> {
  // Find relevant nodes by label similarity
  const nodes = await query<KnowledgeNode>(
    `SELECT * FROM forge_knowledge_nodes
     WHERE label ILIKE $1 OR content ILIKE $1
     ORDER BY confidence DESC, access_count DESC LIMIT $2`,
    [`%${topic}%`, limit],
  );

  if (nodes.length === 0) return { nodes: [], edges: [] };

  // Increment access count
  const nodeIds = nodes.map(n => n.id);
  await query(`UPDATE forge_knowledge_nodes SET access_count = access_count + 1 WHERE id = ANY($1)`, [nodeIds]);

  // Get edges between these nodes and their neighbors
  const edges = await query<{ source_label: string; target_label: string; edge_type: string; weight: number }>(
    `SELECT sn.label as source_label, tn.label as target_label, e.edge_type, e.weight
     FROM forge_knowledge_edges e
     JOIN forge_knowledge_nodes sn ON sn.id = e.source_id
     JOIN forge_knowledge_nodes tn ON tn.id = e.target_id
     WHERE e.source_id = ANY($1) OR e.target_id = ANY($1)
     ORDER BY e.weight DESC LIMIT 20`,
    [nodeIds],
  );

  return {
    nodes,
    edges: edges.map(e => ({ source: e.source_label, target: e.target_label, type: e.edge_type, weight: e.weight })),
  };
}

/**
 * Build a knowledge context string for an agent's system prompt.
 * Queries the graph for relevant knowledge based on the task input.
 */
export async function buildKnowledgeContext(taskInput: string): Promise<string> {
  // Extract key terms (simple — take first 3 significant words)
  const words = taskInput.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4);
  const searchTerms = words.slice(0, 3);

  if (searchTerms.length === 0) return '';

  const allNodes: KnowledgeNode[] = [];
  for (const term of searchTerms) {
    const result = await queryKnowledge(term, 3);
    allNodes.push(...result.nodes);
  }

  if (allNodes.length === 0) return '';

  // Deduplicate
  const seen = new Set<string>();
  const unique = allNodes.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });

  const lines = ['== KNOWLEDGE CONTEXT =='];
  for (const node of unique.slice(0, 5)) {
    lines.push(`[${node.node_type}] ${node.label}: ${node.content.substring(0, 150)}`);
  }
  return lines.join('\n');
}

/**
 * Post-execution knowledge extraction.
 * Called after every agent execution to grow the knowledge graph.
 */
export async function extractExecutionKnowledge(
  agentName: string,
  input: string,
  output: string,
  status: string,
): Promise<void> {
  if (!output || output.length < 50) return;

  // Extract the execution as an event node
  const eventLabel = `${agentName} execution: ${input.substring(0, 60)}`;
  const eventId = await addKnowledge(
    eventLabel, 'event',
    `${status}: ${output.substring(0, 300)}`,
    agentName, status === 'completed' ? 0.8 : 0.4,
  );

  // Add the agent as an entity
  await addKnowledge(agentName, 'entity', `Agent: ${agentName}`, 'system', 0.9);

  // Connect agent to event
  await connectKnowledge(agentName, eventLabel, status === 'completed' ? 'fixes' : 'relates_to');

  // If the output mentions specific concepts, add them
  const concepts = extractConcepts(output);
  for (const concept of concepts.slice(0, 3)) {
    await addKnowledge(concept, 'concept', `Referenced in ${agentName} execution`, agentName, 0.5);
    await connectKnowledge(eventLabel, concept, 'relates_to');
  }

  // If this was a ticket resolution, create a pattern
  if (status === 'completed' && input.includes('TKT-')) {
    const patternLabel = `Pattern: ${input.substring(0, 50)} → fixed by ${agentName}`;
    await addKnowledge(patternLabel, 'pattern', output.substring(0, 200), agentName, 0.7);
    await connectKnowledge(patternLabel, agentName, 'fixes');
  }
}

/**
 * Simple concept extraction from text.
 */
function extractConcepts(text: string): string[] {
  const concepts: string[] = [];
  // Look for capitalized multi-word phrases (proper nouns / concepts)
  const matches = text.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g) || [];
  for (const m of matches) {
    if (m.length > 5 && m.length < 50 && !m.includes('The ') && !m.includes('This ')) {
      concepts.push(m);
    }
  }
  // Look for quoted terms
  const quoted = text.match(/"([^"]{3,30})"/g) || [];
  concepts.push(...quoted.map(q => q.replace(/"/g, '')));

  return [...new Set(concepts)].slice(0, 5);
}

/**
 * Get knowledge graph stats.
 */
export async function getGraphStats(): Promise<{ nodes: number; edges: number; topConcepts: string[] }> {
  const nodeCount = await queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_knowledge_nodes`);
  const edgeCount = await queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_knowledge_edges`);
  const topNodes = await query<{ label: string }>(
    `SELECT label FROM forge_knowledge_nodes ORDER BY access_count DESC, confidence DESC LIMIT 10`,
  );

  return {
    nodes: parseInt(nodeCount?.count || '0'),
    edges: parseInt(edgeCount?.count || '0'),
    topConcepts: topNodes.map(n => n.label),
  };
}
