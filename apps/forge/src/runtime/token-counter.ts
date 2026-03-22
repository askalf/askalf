/**
 * Token Counter & Cost Calculation
 *
 * Pricing is loaded dynamically:
 * 1. DB overrides (forge_model_pricing table) — highest priority
 * 2. Built-in defaults — updated periodically, used as fallback
 *
 * All prices are USD per 1,000 tokens.
 */

// ============================================
// Token Estimation
// ============================================

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: ReadonlyArray<{ role: string; content: string }>,
): number {
  let total = 0;
  for (const message of messages) {
    total += 4 + estimateTokens(message.content);
  }
  total += 3;
  return total;
}

// ============================================
// Pricing — defaults updated March 2026
// ============================================

interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
}

const DEFAULT_PRICING_TABLE: Record<string, ModelPricing> = {
  // Anthropic — Claude 4.6 (March 2026)
  'claude-opus-4-6':              { inputPer1k: 0.005, outputPer1k: 0.025 },
  'claude-sonnet-4-6':            { inputPer1k: 0.003, outputPer1k: 0.015 },
  // Anthropic — Claude 4.5
  'claude-haiku-4-5':             { inputPer1k: 0.001, outputPer1k: 0.005 },
  'claude-haiku-4-5-20251001':    { inputPer1k: 0.001, outputPer1k: 0.005 },
  'claude-opus-4-5-20251101':     { inputPer1k: 0.005, outputPer1k: 0.025 },
  'claude-sonnet-4-5-20250929':   { inputPer1k: 0.003, outputPer1k: 0.015 },
  // Anthropic — Claude 4.0 (legacy)
  'claude-opus-4-20250514':       { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-sonnet-4-20250514':     { inputPer1k: 0.003, outputPer1k: 0.015 },
  // OpenAI — GPT-5 series (March 2026)
  'gpt-5.4':                      { inputPer1k: 0.0025, outputPer1k: 0.015 },
  'gpt-5.4-mini':                 { inputPer1k: 0.00075, outputPer1k: 0.003 },
  'gpt-5.4-nano':                 { inputPer1k: 0.0002, outputPer1k: 0.0008 },
  'gpt-5.3-instant':              { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-5':                        { inputPer1k: 0.00125, outputPer1k: 0.01 },
  'gpt-5.2':                      { inputPer1k: 0.00175, outputPer1k: 0.007 },
  // OpenAI — GPT-4 series (legacy)
  'gpt-4o':                       { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4o-mini':                  { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4-turbo':                  { inputPer1k: 0.01, outputPer1k: 0.03 },
  // OpenAI — reasoning
  'o1':                           { inputPer1k: 0.015, outputPer1k: 0.06 },
  'o1-mini':                      { inputPer1k: 0.003, outputPer1k: 0.012 },
  'o3-mini':                      { inputPer1k: 0.0011, outputPer1k: 0.0044 },
  // Google
  'gemini-2.0-flash':             { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  'gemini-1.5-pro':               { inputPer1k: 0.00125, outputPer1k: 0.005 },
  'gemini-1.5-flash':             { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  // DeepSeek
  'deepseek-chat':                { inputPer1k: 0.00027, outputPer1k: 0.0011 },
  'deepseek-reasoner':            { inputPer1k: 0.00055, outputPer1k: 0.0022 },
};

const FALLBACK_PRICING: ModelPricing = { inputPer1k: 0.003, outputPer1k: 0.015 };

// Dynamic pricing cache — loaded from DB on first use
let dbPricingCache: Record<string, ModelPricing> | null = null;
let dbPricingCacheAt = 0;
const DB_PRICING_TTL_MS = 3600_000; // 1 hour

async function loadDbPricing(): Promise<Record<string, ModelPricing>> {
  if (dbPricingCache && Date.now() - dbPricingCacheAt < DB_PRICING_TTL_MS) {
    return dbPricingCache;
  }
  try {
    // Dynamic import to avoid circular deps
    const { query } = await import('../database.js');
    const rows = await query<{ model_id: string; input_per_1k: string; output_per_1k: string }>(
      `SELECT model_id, input_per_1k::text, output_per_1k::text FROM forge_model_pricing WHERE is_active = true`,
    );
    const pricing: Record<string, ModelPricing> = {};
    for (const r of rows) {
      pricing[r.model_id] = {
        inputPer1k: parseFloat(r.input_per_1k) || 0,
        outputPer1k: parseFloat(r.output_per_1k) || 0,
      };
    }
    dbPricingCache = pricing;
    dbPricingCacheAt = Date.now();
    return pricing;
  } catch {
    // Table may not exist yet — use defaults
    return {};
  }
}

function getPricingSync(model: string): ModelPricing {
  // Check DB cache first (if loaded)
  if (dbPricingCache?.[model]) return dbPricingCache[model];

  // Exact match in defaults
  if (DEFAULT_PRICING_TABLE[model]) return DEFAULT_PRICING_TABLE[model];

  // Prefix match
  for (const [key, value] of Object.entries(DEFAULT_PRICING_TABLE)) {
    if (model.startsWith(key) || key.startsWith(model)) return value;
  }

  return FALLBACK_PRICING;
}

// ============================================
// Cost Calculation
// ============================================

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const pricing = getPricingSync(model);
  return (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
}

/**
 * Async version that checks DB overrides first.
 * Use this for accurate cost calculation when you can await.
 */
export async function calculateCostAsync(
  inputTokens: number,
  outputTokens: number,
  model: string,
): Promise<number> {
  await loadDbPricing();
  return calculateCost(inputTokens, outputTokens, model);
}

/**
 * Get all known model pricing (defaults + DB overrides merged).
 */
export async function getAllPricing(): Promise<Record<string, ModelPricing>> {
  const dbPricing = await loadDbPricing();
  return { ...DEFAULT_PRICING_TABLE, ...dbPricing };
}

// ============================================
// Budget Enforcement
// ============================================

export interface BudgetCheckResult {
  allowed: boolean;
  currentCost: number;
  maxCost: number;
  remaining: number;
  usagePercent: number;
}

export function checkBudget(currentCost: number, maxCost: number): BudgetCheckResult {
  const remaining = Math.max(0, maxCost - currentCost);
  const usagePercent = maxCost > 0 ? (currentCost / maxCost) * 100 : 0;
  return { allowed: currentCost < maxCost, currentCost, maxCost, remaining, usagePercent };
}
