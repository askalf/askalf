/**
 * Shared Execution Persistence
 *
 * Extracted from engine.ts to be shared between:
 * - Legacy ReAct engine (engine.ts)
 * - SDK engine (sdk-engine.ts)
 * - Container signal path (worker.ts)
 *
 * All execution record creation/completion/failure logic in one place.
 */

import { ulid } from 'ulid';
import { query } from '../database.js';

// ============================================
// Types
// ============================================

export interface ExecutionResult {
  output: string;
  toolCalls: Array<{ id?: string; name: string; input: Record<string, unknown> }>;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  messages: Array<{ role: string; content: string }>;
}

// ============================================
// Execution Record CRUD
// ============================================

export async function createExecutionRecord(
  executionId: string,
  agentId: string,
  sessionId: string | undefined,
  ownerId: string,
  input: string,
  runtimeMode?: string,
  parentExecutionId?: string,
  depth?: number,
): Promise<void> {
  await query(
    `INSERT INTO forge_executions
     (id, agent_id, session_id, owner_id, status, input, runtime_mode, parent_execution_id, depth, started_at)
     VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET status = 'running', runtime_mode = EXCLUDED.runtime_mode, started_at = NOW()`,
    [executionId, agentId, sessionId ?? null, ownerId, input, runtimeMode ?? 'legacy', parentExecutionId ?? null, depth ?? 0],
  );
}

export async function completeExecutionRecord(
  executionId: string,
  result: ExecutionResult,
): Promise<void> {
  await query(
    `UPDATE forge_executions
     SET status = 'completed',
         output = $1,
         messages = $2,
         tool_calls = $3,
         iterations = $4,
         input_tokens = $5,
         output_tokens = $6,
         total_tokens = $7,
         cost = $8,
         duration_ms = $9,
         completed_at = NOW()
     WHERE id = $10`,
    [
      result.output,
      JSON.stringify(result.messages),
      JSON.stringify(result.toolCalls),
      result.iterations,
      result.inputTokens,
      result.outputTokens,
      result.inputTokens + result.outputTokens,
      result.cost,
      result.durationMs,
      executionId,
    ],
  );
}

export async function failExecutionRecord(
  executionId: string,
  error: string,
  partialResult: Partial<ExecutionResult>,
): Promise<void> {
  await query(
    `UPDATE forge_executions
     SET status = 'failed',
         error = $1,
         output = $2,
         messages = $3,
         tool_calls = $4,
         iterations = $5,
         input_tokens = $6,
         output_tokens = $7,
         total_tokens = $8,
         cost = $9,
         duration_ms = $10,
         completed_at = NOW()
     WHERE id = $11`,
    [
      error,
      partialResult.output ?? null,
      JSON.stringify(partialResult.messages ?? []),
      JSON.stringify(partialResult.toolCalls ?? []),
      partialResult.iterations ?? 0,
      partialResult.inputTokens ?? 0,
      partialResult.outputTokens ?? 0,
      (partialResult.inputTokens ?? 0) + (partialResult.outputTokens ?? 0),
      partialResult.cost ?? 0,
      partialResult.durationMs ?? 0,
      executionId,
    ],
  );
}

export async function recordCostEvent(
  executionId: string,
  agentId: string,
  ownerId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
): Promise<void> {
  await query(
    `INSERT INTO forge_cost_events
     (id, execution_id, agent_id, owner_id, provider, model, input_tokens, output_tokens, cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ulid(), executionId, agentId, ownerId, provider, model, inputTokens, outputTokens, cost],
  );
}
