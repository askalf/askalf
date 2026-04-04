/**
 * Built-in Tool: Knowledge Search (Level 7 — Vibe Memory)
 * Fleet-wide knowledge graph search. Agents can query entities and
 * relationships extracted from all executions across the entire fleet.
 */

import { query } from '../../database.js';
import { searchNodes } from '../../orchestration/knowledge-graph.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface KnowledgeSearchInput {
  action: 'search' | 'related';
  // For search:
  query?: string;
  entity_type?: string;
  limit?: number;
  // For related:
  node_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function knowledgeSearch(input: KnowledgeSearchInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'search':
        return await handleSearch(input, startTime);
      case 'related':
        return await handleRelated(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: search, related`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

// ============================================
// Search Action
// ============================================

async function handleSearch(input: KnowledgeSearchInput, startTime: number): Promise<ToolResult> {
  if (!input.query) {
    return { output: null, error: 'query is required for search action', durationMs: 0 };
  }

  const limit = Math.min(input.limit ?? 10, 20);

  // searchNodes without agentId = fleet-wide search
  const nodes = await searchNodes(input.query, {
    limit,
    entityType: input.entity_type,
    // No agentId — searches across all agents
  });

  return {
    output: {
      query: input.query,
      entity_type_filter: input.entity_type ?? 'all',
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        entity_type: n.entity_type,
        description: n.description,
        mention_count: n.mention_count,
        similarity: Math.round(n.similarity * 1000) / 1000,
      })),
      total: nodes.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Related Action
// ============================================

async function handleRelated(input: KnowledgeSearchInput, startTime: number): Promise<ToolResult> {
  if (!input.node_id) {
    return { output: null, error: 'node_id is required for related action', durationMs: 0 };
  }

  // Get the node itself
  const node = await query<{
    id: string; label: string; entity_type: string; description: string | null; mention_count: number;
  }>(
    `SELECT id, label, entity_type, description, mention_count
     FROM forge_knowledge_nodes WHERE id = $1`,
    [input.node_id],
  );

  if (node.length === 0) {
    return {
      output: null,
      error: `Node not found: ${input.node_id}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Get outgoing edges (this node is source)
  const outgoing = await query<{
    id: string; relation: string; weight: number;
    target_label: string; target_type: string; target_id: string;
  }>(
    `SELECT e.id, e.relation, e.weight,
            n.label AS target_label, n.entity_type AS target_type, n.id AS target_id
     FROM forge_knowledge_edges e
     JOIN forge_knowledge_nodes n ON e.target_id = n.id
     WHERE e.source_id = $1
     ORDER BY e.weight DESC
     LIMIT 20`,
    [input.node_id],
  );

  // Get incoming edges (this node is target)
  const incoming = await query<{
    id: string; relation: string; weight: number;
    source_label: string; source_type: string; source_id: string;
  }>(
    `SELECT e.id, e.relation, e.weight,
            n.label AS source_label, n.entity_type AS source_type, n.id AS source_id
     FROM forge_knowledge_edges e
     JOIN forge_knowledge_nodes n ON e.source_id = n.id
     WHERE e.target_id = $1
     ORDER BY e.weight DESC
     LIMIT 20`,
    [input.node_id],
  );

  return {
    output: {
      node: node[0],
      outgoing: outgoing.map((e) => ({
        relation: e.relation,
        target: e.target_label,
        target_type: e.target_type,
        target_id: e.target_id,
        weight: e.weight,
      })),
      incoming: incoming.map((e) => ({
        relation: e.relation,
        source: e.source_label,
        source_type: e.source_type,
        source_id: e.source_id,
        weight: e.weight,
      })),
      total_relationships: outgoing.length + incoming.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
