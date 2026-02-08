/**
 * Token Counter & Budget Enforcement
 * Provides rough token estimation, cost calculation from model pricing,
 * and budget checking for execution loops.
 */

// ============================================
// Token Estimation
// ============================================

/**
 * Rough token estimation based on character count.
 * Uses the common heuristic of ~4 characters per token for English text.
 * This is intentionally an overestimate for safety.
 *
 * @param text - The text to estimate token count for
 * @returns Estimated number of tokens
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the total tokens for an array of messages.
 * Accounts for a small overhead per message for role and formatting tokens.
 *
 * @param messages - Array of messages with role and content
 * @returns Estimated total token count
 */
export function estimateMessagesTokens(
  messages: ReadonlyArray<{ role: string; content: string }>,
): number {
  let total = 0;
  for (const message of messages) {
    // ~4 tokens overhead per message for role, formatting, etc.
    total += 4 + estimateTokens(message.content);
  }
  // Add a small fixed overhead for the conversation wrapper
  total += 3;
  return total;
}

// ============================================
// Cost Calculation
// ============================================

/**
 * Known model pricing in USD per 1000 tokens.
 * Format: { inputPer1k, outputPer1k }
 */
interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-20250514': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-sonnet-4-20250514': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-5-sonnet-20241022': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-haiku-4-5-20251001': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'claude-3-5-haiku-20241022': { inputPer1k: 0.001, outputPer1k: 0.005 },
  'claude-3-haiku-20240307': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  // OpenAI
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
  'o1': { inputPer1k: 0.015, outputPer1k: 0.06 },
  'o1-mini': { inputPer1k: 0.003, outputPer1k: 0.012 },
  'o3-mini': { inputPer1k: 0.0011, outputPer1k: 0.0044 },
  // Google
  'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
  'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  'gemini-2.0-flash': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  // DeepSeek
  'deepseek-chat': { inputPer1k: 0.00027, outputPer1k: 0.0011 },
  'deepseek-reasoner': { inputPer1k: 0.00055, outputPer1k: 0.0022 },
};

/**
 * Default fallback pricing for unknown models (conservative overestimate).
 */
const DEFAULT_PRICING: ModelPricing = { inputPer1k: 0.01, outputPer1k: 0.03 };

/**
 * Calculate the cost for a given number of input and output tokens.
 *
 * @param inputTokens - Number of input tokens consumed
 * @param outputTokens - Number of output tokens produced
 * @param model - The model identifier to look up pricing
 * @returns Cost in USD
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  // Try exact match first, then try prefix matching for versioned model IDs
  let pricing = MODEL_PRICING[model];

  if (!pricing) {
    // Try prefix match (e.g., "claude-3-5-sonnet-latest" -> "claude-3-5-sonnet-...")
    for (const [key, value] of Object.entries(MODEL_PRICING)) {
      if (model.startsWith(key) || key.startsWith(model)) {
        pricing = value;
        break;
      }
    }
  }

  if (!pricing) {
    pricing = DEFAULT_PRICING;
  }

  const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
  const outputCost = (outputTokens / 1000) * pricing.outputPer1k;

  return inputCost + outputCost;
}

// ============================================
// Budget Enforcement
// ============================================

export interface BudgetCheckResult {
  /** Whether the budget allows more iterations. */
  allowed: boolean;
  /** Current accumulated cost. */
  currentCost: number;
  /** Maximum cost limit. */
  maxCost: number;
  /** Remaining budget. */
  remaining: number;
  /** What percentage of the budget has been consumed. */
  usagePercent: number;
}

/**
 * Check whether the current execution cost is within budget.
 *
 * @param currentCost - Current accumulated cost in USD
 * @param maxCost - Maximum allowed cost in USD
 * @returns Budget check result with allowed flag and details
 */
export function checkBudget(currentCost: number, maxCost: number): BudgetCheckResult {
  const remaining = Math.max(0, maxCost - currentCost);
  const usagePercent = maxCost > 0 ? (currentCost / maxCost) * 100 : 0;

  return {
    allowed: currentCost < maxCost,
    currentCost,
    maxCost,
    remaining,
    usagePercent,
  };
}
