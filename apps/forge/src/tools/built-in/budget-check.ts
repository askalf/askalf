/**
 * Built-in Tool: Budget Check (Level 15 — Vibe Completeness)
 * Cost estimation and budget monitoring before expensive operations.
 * Estimate costs for model usage and check budget remaining.
 */

import { calculateCost, checkBudget } from '../../runtime/token-counter.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface BudgetCheckInput {
  action: 'estimate' | 'check';
  // For estimate:
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  // For check:
  current_cost?: number;
  max_cost?: number;
}

// ============================================
// Implementation
// ============================================

export async function budgetCheck(input: BudgetCheckInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'estimate':
        return handleEstimate(input, startTime);
      case 'check':
        return handleCheck(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: estimate, check`,
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
// Estimate Action
// ============================================

function handleEstimate(input: BudgetCheckInput, startTime: number): ToolResult {
  if (input.input_tokens === undefined) {
    return { output: null, error: 'input_tokens is required for estimate', durationMs: 0 };
  }
  if (input.output_tokens === undefined) {
    return { output: null, error: 'output_tokens is required for estimate', durationMs: 0 };
  }
  if (!input.model) {
    return { output: null, error: 'model is required for estimate', durationMs: 0 };
  }

  const cost = calculateCost(input.input_tokens, input.output_tokens, input.model);

  return {
    output: {
      model: input.model,
      input_tokens: input.input_tokens,
      output_tokens: input.output_tokens,
      estimated_cost_usd: Math.round(cost * 1000000) / 1000000,
      message: `Estimated cost: $${cost.toFixed(6)} for ${input.input_tokens} input + ${input.output_tokens} output tokens on ${input.model}.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Check Action
// ============================================

function handleCheck(input: BudgetCheckInput, startTime: number): ToolResult {
  if (input.current_cost === undefined) {
    return { output: null, error: 'current_cost is required for check', durationMs: 0 };
  }
  if (input.max_cost === undefined) {
    return { output: null, error: 'max_cost is required for check', durationMs: 0 };
  }

  const result = checkBudget(input.current_cost, input.max_cost);

  return {
    output: {
      allowed: result.allowed,
      current_cost: result.currentCost,
      max_cost: result.maxCost,
      remaining: Math.round(result.remaining * 1000000) / 1000000,
      usage_percent: Math.round(result.usagePercent * 100) / 100,
      status: result.usagePercent >= 90 ? 'critical' : result.usagePercent >= 75 ? 'warning' : 'ok',
      message: result.allowed
        ? `Budget OK: $${result.remaining.toFixed(4)} remaining (${result.usagePercent.toFixed(1)}% used).`
        : `Budget EXCEEDED: $${result.currentCost.toFixed(4)} / $${result.maxCost.toFixed(4)}.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
