/**
 * Parallel Execution
 * Runs multiple workflow nodes concurrently via Promise.allSettled,
 * collecting results and handling partial failures gracefully.
 */

import type { WorkflowNode } from './dag.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParallelResult {
  /** Results keyed by node ID. Only populated for nodes that succeeded. */
  results: Map<string, unknown>;
  /** Errors keyed by node ID. Only populated for nodes that failed. */
  errors: Map<string, Error>;
  /** Whether every node completed successfully. */
  allSucceeded: boolean;
}

/**
 * The function signature callers must supply for executing a single node.
 * Receives the node and the shared context, and must return the node's output.
 */
export type NodeExecuteFn = (
  node: WorkflowNode,
  context: Record<string, unknown>,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Execute an array of workflow nodes in parallel.
 *
 * Uses `Promise.allSettled` so that a failure in one node does not prevent
 * the others from completing. The caller receives a `ParallelResult` that
 * contains both the successful outputs and any errors encountered.
 *
 * ```ts
 * const { results, errors, allSucceeded } = await executeParallel(
 *   nodes,
 *   sharedContext,
 *   async (node, ctx) => { ... },
 * );
 * ```
 */
export async function executeParallel(
  nodes: WorkflowNode[],
  context: Record<string, unknown>,
  executeFn: NodeExecuteFn,
): Promise<ParallelResult> {
  const results = new Map<string, unknown>();
  const errors = new Map<string, Error>();

  const promises = nodes.map(async (node) => {
    return { nodeId: node.id, output: await executeFn(node, context) };
  });

  const settled = await Promise.allSettled(promises);

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const node = nodes[i]!;

    if (outcome.status === 'fulfilled') {
      results.set(node.id, outcome.value.output);
    } else {
      const reason = outcome.reason instanceof Error
        ? outcome.reason
        : new Error(String(outcome.reason));
      errors.set(node.id, reason);
    }
  }

  return {
    results,
    errors,
    allSucceeded: errors.size === 0,
  };
}
