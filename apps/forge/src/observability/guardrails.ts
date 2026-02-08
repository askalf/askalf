/**
 * Forge Guardrails
 * Safety checks before agent execution: cost limits, rate limits,
 * content filters, and tool restrictions.
 */

import { query } from '../database.js';

interface CheckGuardrailsOptions {
  ownerId: string;
  agentId: string;
  input: string;
  toolName?: string;
  estimatedCost?: number;
}

interface GuardrailResult {
  allowed: boolean;
  reason?: string;
}

interface GuardrailRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  is_enabled: boolean;
  is_global: boolean;
  agent_ids: string[];
  priority: number;
  created_at: string;
  updated_at: string;
}

interface CostSumRow {
  total_cost: string;
}

interface ExecutionCountRow {
  count: string;
}

// Basic list of blocked keywords for content filtering
const DEFAULT_BLOCKED_KEYWORDS = [
  'ignore previous instructions',
  'ignore all instructions',
  'disregard your instructions',
  'override your system prompt',
  'bypass safety',
  'jailbreak',
];

/**
 * Load applicable guardrails for an owner + agent combination.
 * Returns global guardrails plus any agent-specific ones, sorted by priority.
 */
async function loadGuardrails(
  ownerId: string,
  agentId: string,
): Promise<GuardrailRow[]> {
  const rows = await query<GuardrailRow>(
    `SELECT id, owner_id, name, description, type, config, is_enabled, is_global, agent_ids, priority, created_at, updated_at
     FROM forge_guardrails
     WHERE is_enabled = true
       AND (
         is_global = true
         OR owner_id = $1
       )
       AND (
         is_global = true
         OR agent_ids = '{}'
         OR $2 = ANY(agent_ids)
       )
     ORDER BY priority ASC`,
    [ownerId, agentId],
  );

  return rows;
}

/**
 * Check all applicable guardrails before executing an agent.
 * Returns { allowed: true } if all checks pass, or { allowed: false, reason } on first failure.
 */
export async function checkGuardrails(
  opts: CheckGuardrailsOptions,
): Promise<GuardrailResult> {
  const guardrails = await loadGuardrails(opts.ownerId, opts.agentId);

  for (const guardrail of guardrails) {
    const result = await evaluateGuardrail(guardrail, opts);
    if (!result.allowed) {
      return result;
    }
  }

  return { allowed: true };
}

async function evaluateGuardrail(
  guardrail: GuardrailRow,
  opts: CheckGuardrailsOptions,
): Promise<GuardrailResult> {
  switch (guardrail.type) {
    case 'cost_limit':
      return evaluateCostLimit(guardrail, opts);
    case 'rate_limit':
      return evaluateRateLimit(guardrail, opts);
    case 'content_filter':
      return evaluateContentFilter(guardrail, opts);
    case 'tool_restriction':
      return evaluateToolRestriction(guardrail, opts);
    default:
      // Unknown guardrail types are allowed by default
      return { allowed: true };
  }
}

async function evaluateCostLimit(
  guardrail: GuardrailRow,
  opts: CheckGuardrailsOptions,
): Promise<GuardrailResult> {
  const config = guardrail.config as {
    maxCostPerExecution?: number;
    maxCostPerDay?: number;
  };

  // Check estimated cost against per-execution limit
  if (
    config.maxCostPerExecution !== undefined &&
    opts.estimatedCost !== undefined &&
    opts.estimatedCost > config.maxCostPerExecution
  ) {
    return {
      allowed: false,
      reason: `Estimated cost ($${opts.estimatedCost.toFixed(4)}) exceeds per-execution limit ($${config.maxCostPerExecution.toFixed(2)})`,
    };
  }

  // Check daily cost limit
  if (config.maxCostPerDay !== undefined) {
    const dailyCostResult = await query<CostSumRow>(
      `SELECT COALESCE(SUM(cost), 0) AS total_cost
       FROM forge_cost_events
       WHERE owner_id = $1
         AND created_at >= DATE_TRUNC('day', NOW())`,
      [opts.ownerId],
    );

    const todaysCost = dailyCostResult[0]
      ? parseFloat(dailyCostResult[0].total_cost)
      : 0;

    const projected = todaysCost + (opts.estimatedCost ?? 0);
    if (projected > config.maxCostPerDay) {
      return {
        allowed: false,
        reason: `Daily cost ($${todaysCost.toFixed(2)}) would exceed daily limit ($${config.maxCostPerDay.toFixed(2)}) with this execution`,
      };
    }
  }

  return { allowed: true };
}

async function evaluateRateLimit(
  guardrail: GuardrailRow,
  opts: CheckGuardrailsOptions,
): Promise<GuardrailResult> {
  const config = guardrail.config as {
    maxExecutionsPerMinute?: number;
    maxExecutionsPerHour?: number;
  };

  if (config.maxExecutionsPerMinute !== undefined) {
    const minuteResult = await query<ExecutionCountRow>(
      `SELECT COUNT(*) AS count
       FROM forge_executions
       WHERE owner_id = $1
         AND created_at >= NOW() - INTERVAL '1 minute'`,
      [opts.ownerId],
    );

    const minuteCount = minuteResult[0]
      ? parseInt(minuteResult[0].count, 10)
      : 0;

    if (minuteCount >= config.maxExecutionsPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${minuteCount}/${config.maxExecutionsPerMinute} executions per minute`,
      };
    }
  }

  if (config.maxExecutionsPerHour !== undefined) {
    const hourResult = await query<ExecutionCountRow>(
      `SELECT COUNT(*) AS count
       FROM forge_executions
       WHERE owner_id = $1
         AND created_at >= NOW() - INTERVAL '1 hour'`,
      [opts.ownerId],
    );

    const hourCount = hourResult[0]
      ? parseInt(hourResult[0].count, 10)
      : 0;

    if (hourCount >= config.maxExecutionsPerHour) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${hourCount}/${config.maxExecutionsPerHour} executions per hour`,
      };
    }
  }

  return { allowed: true };
}

function evaluateContentFilter(
  guardrail: GuardrailRow,
  opts: CheckGuardrailsOptions,
): GuardrailResult {
  const config = guardrail.config as {
    blockedKeywords?: string[];
    caseSensitive?: boolean;
  };

  const keywords = config.blockedKeywords ?? DEFAULT_BLOCKED_KEYWORDS;
  const inputLower = config.caseSensitive ? opts.input : opts.input.toLowerCase();

  for (const keyword of keywords) {
    const target = config.caseSensitive ? keyword : keyword.toLowerCase();
    if (inputLower.includes(target)) {
      return {
        allowed: false,
        reason: `Content filter triggered: input contains blocked content`,
      };
    }
  }

  return { allowed: true };
}

function evaluateToolRestriction(
  guardrail: GuardrailRow,
  opts: CheckGuardrailsOptions,
): GuardrailResult {
  if (!opts.toolName) {
    return { allowed: true };
  }

  const config = guardrail.config as {
    blockedTools?: string[];
    allowedTools?: string[];
  };

  if (config.blockedTools && config.blockedTools.includes(opts.toolName)) {
    return {
      allowed: false,
      reason: `Tool '${opts.toolName}' is blocked by guardrail '${guardrail.name}'`,
    };
  }

  if (config.allowedTools && !config.allowedTools.includes(opts.toolName)) {
    return {
      allowed: false,
      reason: `Tool '${opts.toolName}' is not in the allowed tools list for guardrail '${guardrail.name}'`,
    };
  }

  return { allowed: true };
}
