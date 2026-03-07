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
  /** Estimated cost for this execution. If not provided, falls back to agent's max_cost_per_execution. */
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
    case 'output_filter':
      return evaluateOutputFilter(guardrail, opts);
    case 'custom':
      return evaluateCustomGuardrail(guardrail, opts);
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

  // Resolve estimated cost: use provided value, or fall back to agent's max_cost_per_execution
  let estimatedCost = opts.estimatedCost;
  if (estimatedCost === undefined) {
    const agentRow = await query<{ max_cost_per_execution: string }>(
      `SELECT max_cost_per_execution FROM forge_agents WHERE id = $1`,
      [opts.agentId],
    );
    estimatedCost = agentRow[0] ? parseFloat(agentRow[0].max_cost_per_execution) || 0 : 0;
  }

  // Check estimated cost against per-execution limit
  if (
    config.maxCostPerExecution !== undefined &&
    estimatedCost > config.maxCostPerExecution
  ) {
    return {
      allowed: false,
      reason: `Estimated cost ($${estimatedCost.toFixed(4)}) exceeds per-execution limit ($${config.maxCostPerExecution.toFixed(2)})`,
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

    const projected = todaysCost + estimatedCost;
    if (projected > config.maxCostPerDay) {
      return {
        allowed: false,
        reason: `Daily cost ($${todaysCost.toFixed(2)}) would exceed daily limit ($${config.maxCostPerDay.toFixed(2)}) with this execution (+$${estimatedCost.toFixed(2)})`,
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

/**
 * Check user budget from forge_user_preferences.
 * Returns { allowed: true } if no budget set or within limits.
 * Called before every execution across all layers.
 */
export async function checkUserBudget(userId: string): Promise<GuardrailResult> {
  // Load user preferences
  const prefs = await query<{
    budget_limit_daily: string | null;
    budget_limit_monthly: string | null;
  }>(
    `SELECT budget_limit_daily, budget_limit_monthly
     FROM forge_user_preferences WHERE user_id = $1`,
    [userId],
  );

  if (prefs.length === 0) return { allowed: true };
  const pref = prefs[0]!;

  // Check daily budget
  if (pref.budget_limit_daily !== null) {
    const dailyLimit = parseFloat(pref.budget_limit_daily);
    if (dailyLimit > 0) {
      const dailyCost = await query<CostSumRow>(
        `SELECT COALESCE(SUM(cost), 0) AS total_cost
         FROM forge_cost_events
         WHERE owner_id = $1 AND created_at >= DATE_TRUNC('day', NOW())`,
        [userId],
      );
      const todaysCost = dailyCost[0] ? parseFloat(dailyCost[0].total_cost) : 0;
      if (todaysCost >= dailyLimit) {
        return {
          allowed: false,
          reason: `Daily budget exceeded: $${todaysCost.toFixed(2)}/$${dailyLimit.toFixed(2)}`,
        };
      }
    }
  }

  // Check monthly budget
  if (pref.budget_limit_monthly !== null) {
    const monthlyLimit = parseFloat(pref.budget_limit_monthly);
    if (monthlyLimit > 0) {
      const monthlyCost = await query<CostSumRow>(
        `SELECT COALESCE(SUM(cost), 0) AS total_cost
         FROM forge_cost_events
         WHERE owner_id = $1 AND created_at >= DATE_TRUNC('month', NOW())`,
        [userId],
      );
      const monthCost = monthlyCost[0] ? parseFloat(monthlyCost[0].total_cost) : 0;
      if (monthCost >= monthlyLimit) {
        return {
          allowed: false,
          reason: `Monthly budget exceeded: $${monthCost.toFixed(2)}/$${monthlyLimit.toFixed(2)}`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Output Filter: scan agent output for blocked patterns, PII, or sensitive content.
 */
function evaluateOutputFilter(
  guardrail: GuardrailRow,
  opts: CheckGuardrailsOptions,
): GuardrailResult {
  const config = guardrail.config as {
    blockedPatterns?: string[];
    blockPII?: boolean;
    maxOutputLength?: number;
    caseSensitive?: boolean;
  };

  const input = opts.input;

  // Check blocked patterns in output
  if (config.blockedPatterns && config.blockedPatterns.length > 0) {
    const target = config.caseSensitive ? input : input.toLowerCase();
    for (const pattern of config.blockedPatterns) {
      const search = config.caseSensitive ? pattern : pattern.toLowerCase();
      if (target.includes(search)) {
        return {
          allowed: false,
          reason: `Output filter triggered: output contains blocked pattern`,
        };
      }
    }
  }

  // Block PII patterns (SSN, credit card, email-like patterns in output)
  if (config.blockPII) {
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/,           // SSN
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
      /\b[A-Z]{2}\d{6,8}\b/i,             // Passport-like
    ];
    for (const regex of piiPatterns) {
      if (regex.test(input)) {
        return {
          allowed: false,
          reason: `Output filter triggered: potential PII detected in content`,
        };
      }
    }
  }

  // Check max output length
  if (config.maxOutputLength && input.length > config.maxOutputLength) {
    return {
      allowed: false,
      reason: `Output filter triggered: content length (${input.length}) exceeds maximum (${config.maxOutputLength})`,
    };
  }

  return { allowed: true };
}

/**
 * Custom guardrail: evaluate user-defined rules via regex patterns,
 * JSON schema validation, or webhook callbacks.
 */
async function evaluateCustomGuardrail(
  guardrail: GuardrailRow,
  opts: CheckGuardrailsOptions,
): Promise<GuardrailResult> {
  const config = guardrail.config as {
    mode?: 'regex' | 'webhook' | 'script';
    patterns?: Array<{ pattern: string; action: 'block' | 'warn'; message?: string }>;
    webhookUrl?: string;
    webhookTimeoutMs?: number;
    script?: string;
  };

  const mode = config.mode ?? 'regex';

  if (mode === 'regex' && config.patterns) {
    for (const rule of config.patterns) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(opts.input)) {
          if (rule.action === 'block') {
            return {
              allowed: false,
              reason: rule.message ?? `Custom guardrail '${guardrail.name}' blocked: pattern matched`,
            };
          }
        }
      } catch {
        // Invalid regex — skip
      }
    }
  }

  if (mode === 'webhook' && config.webhookUrl) {
    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guardrailId: guardrail.id,
          guardrailName: guardrail.name,
          input: opts.input.substring(0, 10000),
          agentId: opts.agentId,
          toolName: opts.toolName,
        }),
        signal: AbortSignal.timeout(config.webhookTimeoutMs ?? 5000),
      });

      if (response.ok) {
        const result = await response.json() as { allowed?: boolean; reason?: string };
        if (result.allowed === false) {
          return {
            allowed: false,
            reason: result.reason ?? `Custom guardrail '${guardrail.name}' webhook blocked execution`,
          };
        }
      }
    } catch {
      // Webhook failure — allow by default (fail-open for custom guardrails)
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
