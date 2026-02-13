/**
 * Execution Context Store
 * Uses AsyncLocalStorage to propagate execution context (ownerId, depth, executionId)
 * through the call chain without changing tool interfaces.
 * Primary consumer: agent_call tool, which needs context to create child executions.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ExecutionLocalContext {
  ownerId: string;
  executionId: string;
  depth: number;
}

export const executionStore = new AsyncLocalStorage<ExecutionLocalContext>();

export function getExecutionContext(): ExecutionLocalContext | undefined {
  return executionStore.getStore();
}
