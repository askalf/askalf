/**
 * Built-in Tool: Self Heal (Level 8 — Vibe Self-Awareness)
 * Autonomous corrective actions: heal stuck executions, pause agents,
 * reset circuit breakers, rebalance workload away from degraded agents.
 */

import { query, substrateQuery } from '../../database.js';
import { healStuckExecutions } from '../../orchestration/monitoring-agent.js';
import { getCircuitBreaker, getCircuitBreakerNames } from '../../runtime/error-handler.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface SelfHealInput {
  action: 'heal_stuck' | 'pause_agent' | 'reset_circuit_breaker' | 'rebalance';
  agent_id?: string;
  reason?: string;
  breaker_name?: string;
  degraded_agent_id?: string;
  // Context (injected by runtime):
  agent_name?: string;
}

// ============================================
// Implementation
// ============================================

export async function selfHeal(input: SelfHealInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'heal_stuck':
        return await handleHealStuck(startTime);
      case 'pause_agent':
        return await handlePauseAgent(input, startTime);
      case 'reset_circuit_breaker':
        return await handleResetCircuitBreaker(input, startTime);
      case 'rebalance':
        return await handleRebalance(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: heal_stuck, pause_agent, reset_circuit_breaker, rebalance`,
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
// Heal Stuck Action
// ============================================

async function handleHealStuck(startTime: number): Promise<ToolResult> {
  const healed = await healStuckExecutions();

  return {
    output: {
      healed_count: healed,
      message: healed > 0
        ? `Healed ${healed} stuck execution(s) by marking them as failed.`
        : 'No stuck executions found (all running < 30 minutes).',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Pause Agent Action
// ============================================

async function handlePauseAgent(input: SelfHealInput, startTime: number): Promise<ToolResult> {
  if (!input.agent_id) {
    return { output: null, error: 'agent_id is required for pause_agent', durationMs: 0 };
  }
  if (!input.reason) {
    return { output: null, error: 'reason is required for pause_agent', durationMs: 0 };
  }

  // Verify target agent exists
  const targets = await query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM forge_agents WHERE id = $1`,
    [input.agent_id],
  );
  if (targets.length === 0) {
    return {
      output: null,
      error: `Agent not found: ${input.agent_id}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const target = targets[0]!;

  if (target.status === 'paused') {
    return {
      output: { already_paused: true, agent_name: target.name },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Prevent pausing system agents
  const meta = await query<{ system_agent: string }>(
    `SELECT COALESCE(metadata->>'system_agent', 'false') AS system_agent
     FROM forge_agents WHERE id = $1`,
    [input.agent_id],
  );
  if (meta[0]?.system_agent === 'true') {
    return {
      output: null,
      error: 'Cannot pause system agents',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  await query(
    `UPDATE forge_agents SET status = 'paused', updated_at = NOW() WHERE id = $1`,
    [input.agent_id],
  );

  // Disable schedule
  try {
    await substrateQuery(
      `UPDATE agent_schedules SET is_continuous = false WHERE agent_id = $1`,
      [input.agent_id],
    );
  } catch { /* non-fatal */ }

  // Audit trail
  try {
    await substrateQuery(
      `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
       VALUES ('agent', $1, 'paused_by_agent', $2, $3, $4)`,
      [
        input.agent_id,
        `agent:${input.agent_name ?? 'unknown'}`,
        JSON.stringify({ status: target.status }),
        JSON.stringify({ status: 'paused', reason: input.reason, paused_by: input.agent_name }),
      ],
    );
  } catch { /* non-fatal */ }

  console.log(`[SelfHeal] Agent "${target.name}" paused by ${input.agent_name ?? 'unknown'}: ${input.reason}`);

  return {
    output: {
      paused: true,
      agent_id: input.agent_id,
      agent_name: target.name,
      reason: input.reason,
      message: `Agent "${target.name}" has been paused. Reason: ${input.reason}`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Reset Circuit Breaker Action
// ============================================

async function handleResetCircuitBreaker(input: SelfHealInput, startTime: number): Promise<ToolResult> {
  const name = input.breaker_name ?? 'provider';
  const breaker = getCircuitBreaker(name);

  if (!breaker) {
    const available = getCircuitBreakerNames();
    return {
      output: null,
      error: `Circuit breaker '${name}' not found. Available: ${available.length > 0 ? available.join(', ') : 'none registered'}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const before = breaker.getMetrics();
  breaker.reset();
  const after = breaker.getMetrics();

  console.log(`[SelfHeal] Circuit breaker '${name}' reset by ${input.agent_name ?? 'unknown'}: ${before.state} → ${after.state}`);

  return {
    output: {
      breaker_name: name,
      previous_state: before.state,
      current_state: after.state,
      previous_failure_count: before.failureCount,
      message: `Circuit breaker '${name}' reset from ${before.state} to ${after.state}.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Rebalance Action
// ============================================

async function handleRebalance(input: SelfHealInput, startTime: number): Promise<ToolResult> {
  if (!input.degraded_agent_id) {
    return { output: null, error: 'degraded_agent_id is required for rebalance', durationMs: 0 };
  }

  // Get current schedule
  const schedules = await substrateQuery<{
    agent_id: string; schedule_interval_minutes: number; is_continuous: boolean;
  }>(
    `SELECT agent_id, schedule_interval_minutes, is_continuous
     FROM agent_schedules WHERE agent_id = $1`,
    [input.degraded_agent_id],
  );

  if (schedules.length === 0) {
    return {
      output: null,
      error: 'No schedule found for this agent',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const current = schedules[0]!;
  const newInterval = Math.min(current.schedule_interval_minutes * 2, 240); // cap at 4 hours

  if (newInterval === current.schedule_interval_minutes) {
    return {
      output: {
        agent_id: input.degraded_agent_id,
        message: `Agent already at maximum interval (${current.schedule_interval_minutes}m). Consider pausing instead.`,
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  await substrateQuery(
    `UPDATE agent_schedules
     SET schedule_interval_minutes = $1,
         next_run_at = NOW() + INTERVAL '1 minute' * $1,
         updated_at = NOW()
     WHERE agent_id = $2`,
    [newInterval, input.degraded_agent_id],
  );

  // Get agent name for logging
  const agents = await query<{ name: string }>(
    `SELECT name FROM forge_agents WHERE id = $1`,
    [input.degraded_agent_id],
  );
  const agentName = agents[0]?.name ?? input.degraded_agent_id;

  console.log(`[SelfHeal] Rebalanced ${agentName}: ${current.schedule_interval_minutes}m → ${newInterval}m`);

  return {
    output: {
      agent_id: input.degraded_agent_id,
      agent_name: agentName,
      previous_interval_minutes: current.schedule_interval_minutes,
      new_interval_minutes: newInterval,
      message: `Schedule interval extended from ${current.schedule_interval_minutes}m to ${newInterval}m to reduce load.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
