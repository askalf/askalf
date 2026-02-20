/**
 * Built-in Tool: Knowledge Graph Ops (Level 15 — Vibe Completeness)
 * Graph traversal and fleet knowledge statistics: traverse node neighborhoods,
 * view graph stats, and search nodes semantically.
 */

import {
  getNodeNeighborhood,
  getGraphStats,
  searchNodes,
} from '../../orchestration/knowledge-graph.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface KnowledgeGraphOpsInput {
  action: 'traverse' | 'stats' | 'search';
  // For traverse:
  node_id?: string;
  depth?: number;
  // For search:
  query?: string;
  entity_type?: string;
  limit?: number;
}

// ============================================
// Implementation
// ============================================

export async function knowledgeGraphOps(input: KnowledgeGraphOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'traverse':
        return await handleTraverse(input, startTime);
      case 'stats':
        return await handleStats(startTime);
      case 'search':
        return await handleSearch(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: traverse, stats, search`,
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
// Traverse Action
// ============================================

async function handleTraverse(input: KnowledgeGraphOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.node_id) {
    return { output: null, error: 'node_id is required for traverse', durationMs: 0 };
  }

  const result = await getNodeNeighborhood(input.node_id, input.depth ?? 1);

  return {
    output: {
      node_id: input.node_id,
      depth: input.depth ?? 1,
      nodes: result.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        entity_type: n.entity_type,
        description: n.description,
        mention_count: n.mention_count,
      })),
      edges: result.edges.map((e) => ({
        id: e.id,
        source_id: e.source_id,
        target_id: e.target_id,
        relation: e.relation,
        weight: e.weight,
      })),
      total_nodes: result.nodes.length,
      total_edges: result.edges.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Stats Action
// ============================================

async function handleStats(startTime: number): Promise<ToolResult> {
  const stats = await getGraphStats();

  return {
    output: {
      total_nodes: stats.totalNodes,
      total_edges: stats.totalEdges,
      top_entities: stats.topEntities,
      top_relations: stats.topRelations,
      message: `Knowledge graph: ${stats.totalNodes} nodes, ${stats.totalEdges} edges.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Search Action
// ============================================

async function handleSearch(input: KnowledgeGraphOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.query) {
    return { output: null, error: 'query is required for search', durationMs: 0 };
  }

  const results = await searchNodes(input.query, {
    entityType: input.entity_type,
    limit: Math.min(input.limit ?? 10, 20),
  });

  return {
    output: {
      query: input.query,
      results: results.map((r) => ({
        id: r.id,
        label: r.label,
        entity_type: r.entity_type,
        description: r.description,
        mention_count: r.mention_count,
        similarity: Math.round(r.similarity * 1000) / 1000,
      })),
      total: results.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
