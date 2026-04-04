/**
 * Built-in Tool: Memory Search
 * Thin wrapper around MemoryManager.recall() that queries
 * semantic and episodic memory for an agent.
 */

import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface MemorySearchInput {
  query: string;
  memoryType?: string | undefined;
  limit?: number | undefined;
  /** Search across all agents' memories (fleet-wide). Default: false (agent-only). */
  fleet?: boolean | undefined;
}

/**
 * Interface for the MemoryManager dependency.
 * The actual MemoryManager lives in the memory module;
 * we define a minimal interface here to avoid tight coupling.
 */
export interface MemoryManagerDep {
  recall(params: {
    agentId: string;
    query: string;
    memoryType?: string | undefined;
    limit?: number | undefined;
  }): Promise<MemoryRecallResult>;
  recallFleet?(
    query: string,
    options?: { k?: number },
  ): Promise<MemoryRecallResult>;
}

export interface MemoryRecallResult {
  memories: Array<{
    id: string;
    content: string;
    memoryType: string;
    similarity?: number | undefined;
    createdAt: string;
    metadata?: Record<string, unknown> | undefined;
  }>;
  total: number;
}

export interface MemorySearchDeps {
  memoryManager: MemoryManagerDep;
  agentId: string;
}

// ============================================
// Implementation
// ============================================

const DEFAULT_LIMIT = 5;

/**
 * Search agent memory using the MemoryManager.
 * This is a thin wrapper that delegates to memoryManager.recall().
 *
 * @param input - Search parameters (query, memoryType, limit)
 * @param deps - Dependencies including the MemoryManager instance and current agentId
 */
export async function memorySearch(
  input: MemorySearchInput,
  deps: MemorySearchDeps,
): Promise<ToolResult> {
  const startTime = performance.now();

  if (!input.query.trim()) {
    return {
      output: null,
      error: 'Search query cannot be empty',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const limit = input.limit ?? DEFAULT_LIMIT;

  try {
    let result: MemoryRecallResult;

    if (input.fleet && deps.memoryManager.recallFleet) {
      // Fleet-wide search across all agents' memories
      result = await deps.memoryManager.recallFleet(input.query, { k: limit });
    } else {
      result = await deps.memoryManager.recall({
        agentId: deps.agentId,
        query: input.query,
        memoryType: input.memoryType,
        limit,
      });
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      output: {
        query: input.query,
        memoryType: input.memoryType ?? 'all',
        fleet: input.fleet ?? false,
        memories: result.memories,
        total: result.total,
        limit,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      output: null,
      error: `Memory search failed: ${errorMessage}`,
      durationMs,
    };
  }
}
