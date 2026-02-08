/**
 * Sandboxed Tool Executor
 * Executes tool calls with timeout, risk-level checking, and
 * records each execution in the forge_tool_executions table.
 */

import { ulid } from 'ulid';
import { query } from '../database.js';
import type { ToolRegistry, ToolResult, ToolDefinition } from './registry.js';

// ============================================
// Types
// ============================================

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolExecutionRecord {
  id: string;
  executionId: string;
  toolName: string;
  toolType: string;
  input: Record<string, unknown>;
  output: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'denied';
  durationMs: number | null;
  error: string | null;
}

export interface ExecuteToolsOptions {
  /** Default timeout per tool call in milliseconds. Defaults to 30000 (30s). */
  timeoutMs?: number | undefined;
  /** Maximum allowed risk level. Tools above this level are denied. */
  maxRiskLevel?: ToolDefinition['riskLevel'] | undefined;
}

// ============================================
// Risk level ordering
// ============================================

const RISK_LEVEL_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function riskLevelValue(level: string): number {
  return RISK_LEVEL_ORDER[level] ?? 0;
}

// ============================================
// Executor
// ============================================

/**
 * Execute an array of tool calls against the registry.
 * Each call is recorded in forge_tool_executions for auditability.
 *
 * @param toolCalls - The tool calls to execute
 * @param registry - The tool registry to look up tool definitions
 * @param executionId - The parent forge_executions.id for linking
 * @param options - Optional timeout and risk level constraints
 * @returns An array of ToolResult in the same order as toolCalls
 */
export async function executeTools(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  executionId: string,
  options: ExecuteToolsOptions = {},
): Promise<ToolResult[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRiskLevel = options.maxRiskLevel ?? 'high';

  const results: ToolResult[] = [];

  for (const call of toolCalls) {
    const recordId = ulid();
    const tool = registry.get(call.name);

    // Insert pending record
    await query(
      `INSERT INTO forge_tool_executions
       (id, execution_id, tool_name, tool_type, input, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        recordId,
        executionId,
        call.name,
        tool?.type ?? 'unknown',
        JSON.stringify(call.input),
        'pending',
      ],
    );

    // Tool not found
    if (!tool) {
      const result: ToolResult = {
        output: null,
        error: `Tool '${call.name}' not found in registry`,
        durationMs: 0,
      };
      await updateExecutionRecord(recordId, 'failed', null, result.error ?? null, 0);
      results.push(result);
      continue;
    }

    // Risk level check
    if (riskLevelValue(tool.riskLevel) > riskLevelValue(maxRiskLevel)) {
      const result: ToolResult = {
        output: null,
        error: `Tool '${call.name}' denied: risk level '${tool.riskLevel}' exceeds maximum allowed '${maxRiskLevel}'`,
        durationMs: 0,
      };
      await updateExecutionRecord(recordId, 'denied', null, result.error ?? null, 0);
      results.push(result);
      continue;
    }

    // Mark as running
    await query(
      `UPDATE forge_tool_executions SET status = 'running' WHERE id = $1`,
      [recordId],
    );

    // Execute with timeout
    const startTime = performance.now();
    let result: ToolResult;

    try {
      result = await executeWithTimeout(tool.execute, call.input, timeoutMs);
    } catch (err) {
      const elapsed = Math.round(performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : String(err);
      result = {
        output: null,
        error: errorMessage,
        durationMs: elapsed,
      };
    }

    // Record completion
    const finalStatus = result.error != null ? 'failed' : 'completed';
    await updateExecutionRecord(
      recordId,
      finalStatus,
      result.output,
      result.error ?? null,
      result.durationMs,
    );

    results.push(result);
  }

  return results;
}

// ============================================
// Helpers
// ============================================

/**
 * Executes a tool function with a timeout. If the tool does not complete
 * within the specified duration, the promise rejects with a timeout error.
 */
async function executeWithTimeout(
  executeFn: (input: Record<string, unknown>) => Promise<ToolResult>,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<ToolResult> {
  return new Promise<ToolResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    executeFn(input)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Updates a forge_tool_executions record with final status, output, error, and duration.
 */
async function updateExecutionRecord(
  recordId: string,
  status: string,
  output: unknown,
  error: string | null,
  durationMs: number,
): Promise<void> {
  await query(
    `UPDATE forge_tool_executions
     SET status = $1, output = $2, error = $3, duration_ms = $4
     WHERE id = $5`,
    [
      status,
      output != null ? JSON.stringify(output) : null,
      error,
      durationMs,
      recordId,
    ],
  );
}
