/**
 * Built-in Tool: Orchestrate (Level 10 — Vibe Orchestration)
 * Natural language orchestration: give a plain English instruction and
 * the system decomposes, matches agents, and executes across the fleet.
 */

import { query } from '../../database.js';
import { orchestrateFromNL, getOrchestrationStatus } from '../../orchestration/nl-orchestrator.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface OrchestrateInput {
  action: 'run' | 'status';
  // For run:
  instruction?: string;
  max_agents?: number;
  // For status:
  session_id?: string;
  // Context:
  agent_id?: string;
}

const MAX_CONCURRENT_ORCHESTRATIONS = 2;

// ============================================
// Implementation
// ============================================

export async function orchestrate(input: OrchestrateInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'run':
        return await handleRun(input, startTime);
      case 'status':
        return await handleStatus(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: run, status`,
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
// Run Action
// ============================================

async function handleRun(input: OrchestrateInput, startTime: number): Promise<ToolResult> {
  if (!input.instruction) {
    return { output: null, error: 'instruction is required for run', durationMs: 0 };
  }

  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';
  const ownerId = ctx?.ownerId ?? 'system';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }

  // Check autonomy level — must be >= 4 to auto-delegate work
  const agents = await query<{ autonomy_level: number; name: string }>(
    `SELECT autonomy_level, name FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 4) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 4 for NL orchestration.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Guard: limit concurrent orchestrations per agent
  const running = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM forge_executions
     WHERE agent_id = $1
       AND metadata->>'source' = 'nl-orchestration'
       AND status = 'running'`,
    [agentId],
  );
  if (parseInt(running[0]?.count ?? '0', 10) >= MAX_CONCURRENT_ORCHESTRATIONS) {
    return {
      output: null,
      error: `Maximum ${MAX_CONCURRENT_ORCHESTRATIONS} concurrent orchestrations reached. Wait for running orchestrations to complete.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const result = await orchestrateFromNL({
    instruction: input.instruction,
    ownerId,
    maxAgents: input.max_agents ?? 5,
    autoApprove: true,
  });

  return {
    output: {
      session_id: result.sessionId,
      tasks: result.tasks.map((t) => ({
        title: t.title,
        agent_name: t.agentName,
        execution_id: t.executionId,
        status: t.status,
      })),
      total_tasks: result.totalTasks,
      message: `Orchestration started with ${result.totalTasks} tasks. Use status with session_id="${result.sessionId}" to monitor.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Status Action
// ============================================

async function handleStatus(input: OrchestrateInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for status', durationMs: 0 };
  }

  const status = await getOrchestrationStatus(input.session_id);

  return {
    output: {
      session_id: input.session_id,
      tasks: status.tasks.map((t) => ({
        execution_id: t.executionId,
        agent_name: t.agentName,
        task_title: t.taskTitle,
        status: t.status,
        output: t.output,
        error: t.error,
        duration_ms: t.durationMs,
      })),
      completed: status.completed,
      failed: status.failed,
      running: status.running,
      pending: status.pending,
      total: status.tasks.length,
      all_done: status.running === 0 && status.pending === 0,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
