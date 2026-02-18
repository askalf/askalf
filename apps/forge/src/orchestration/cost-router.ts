/**
 * Cost Optimization Router (Phase 10)
 * Tracks cost/quality per capability+model and routes tasks to the cheapest
 * model that meets quality thresholds.
 */

import { query } from '../database.js';

interface CostProfile {
  capability: string;
  model_id: string;
  avg_cost: number;
  avg_tokens: number;
  avg_quality: number;
  sample_count: number;
}

const MODEL_TIERS: Record<string, { label: string; costMultiplier: number }> = {
  // Current aliases
  'claude-haiku-4-5': { label: 'haiku', costMultiplier: 0.2 },
  'claude-sonnet-4-6': { label: 'sonnet', costMultiplier: 1.0 },
  'claude-opus-4-6': { label: 'opus', costMultiplier: 5.0 },
  // Dated versions (backwards compat)
  'claude-haiku-4-5-20251001': { label: 'haiku', costMultiplier: 0.2 },
  'claude-sonnet-4-5-20250929': { label: 'sonnet', costMultiplier: 1.0 },
};

/**
 * Record execution cost/quality data for a capability+model pair.
 */
export async function recordCostSample(
  capability: string,
  modelId: string,
  cost: number,
  tokens: number,
  quality: number,
): Promise<void> {
  // Upsert: update running averages
  await query(
    `INSERT INTO forge_cost_profiles (id, capability, model_id, avg_cost, avg_tokens, avg_quality, sample_count)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 1)
     ON CONFLICT (capability, model_id) DO UPDATE SET
       avg_cost = (forge_cost_profiles.avg_cost * forge_cost_profiles.sample_count + $3) / (forge_cost_profiles.sample_count + 1),
       avg_tokens = (forge_cost_profiles.avg_tokens * forge_cost_profiles.sample_count + $4) / (forge_cost_profiles.sample_count + 1),
       avg_quality = (forge_cost_profiles.avg_quality * forge_cost_profiles.sample_count + $5) / (forge_cost_profiles.sample_count + 1),
       sample_count = forge_cost_profiles.sample_count + 1,
       last_updated = NOW()`,
    [capability, modelId, cost, tokens, quality],
  );
}

/**
 * Select the best model for a capability based on quality threshold.
 * Returns the cheapest model that meets the quality requirement.
 */
export async function selectOptimalModel(
  capability: string,
  minQuality: number = 0.7,
): Promise<{ modelId: string; reason: string }> {
  const profiles = await query<CostProfile>(
    `SELECT capability, model_id, avg_cost::float AS avg_cost, avg_tokens,
            avg_quality::float AS avg_quality, sample_count
     FROM forge_cost_profiles
     WHERE capability = $1 AND sample_count >= 3
     ORDER BY avg_cost ASC`,
    [capability],
  );

  // Find cheapest model meeting quality threshold
  for (const profile of profiles) {
    if (profile.avg_quality >= minQuality) {
      return {
        modelId: profile.model_id,
        reason: `cheapest for ${capability} at quality ${(profile.avg_quality * 100).toFixed(0)}% (n=${profile.sample_count}, avg $${profile.avg_cost.toFixed(4)})`,
      };
    }
  }

  // Not enough data or no model meets threshold — default to sonnet
  return {
    modelId: 'claude-sonnet-4-6',
    reason: profiles.length === 0
      ? `no cost data for ${capability} — defaulting to sonnet`
      : `no model meets quality threshold ${(minQuality * 100).toFixed(0)}% for ${capability} — defaulting to sonnet`,
  };
}

/**
 * Get cost profiles for all capabilities (dashboard view).
 */
export async function getCostDashboard(): Promise<{
  profiles: CostProfile[];
  savings: { totalSamples: number; avgCostReduction: number };
}> {
  const profiles = await query<CostProfile>(
    `SELECT capability, model_id, avg_cost::float AS avg_cost, avg_tokens,
            avg_quality::float AS avg_quality, sample_count
     FROM forge_cost_profiles
     ORDER BY capability, avg_cost`,
  );

  const totalSamples = profiles.reduce((sum, p) => sum + p.sample_count, 0);

  // Calculate potential savings: compare cheapest qualifying model vs most expensive per capability
  const byCapability = new Map<string, CostProfile[]>();
  for (const p of profiles) {
    const list = byCapability.get(p.capability) ?? [];
    list.push(p);
    byCapability.set(p.capability, list);
  }

  let savingsSum = 0;
  let capabilitiesWithSavings = 0;
  for (const [, caps] of byCapability) {
    if (caps.length < 2) continue;
    const cheapest = caps[0]!;
    const expensive = caps[caps.length - 1]!;
    if (expensive.avg_cost > 0) {
      savingsSum += 1 - cheapest.avg_cost / expensive.avg_cost;
      capabilitiesWithSavings++;
    }
  }

  return {
    profiles,
    savings: {
      totalSamples,
      avgCostReduction: capabilitiesWithSavings > 0 ? savingsSum / capabilitiesWithSavings : 0,
    },
  };
}

/**
 * Get model recommendation for a list of capabilities.
 */
export async function getModelRecommendations(
  capabilities: string[],
  minQuality: number = 0.7,
): Promise<Array<{ capability: string; modelId: string; reason: string }>> {
  const results: Array<{ capability: string; modelId: string; reason: string }> = [];
  for (const cap of capabilities) {
    const rec = await selectOptimalModel(cap, minQuality);
    results.push({ capability: cap, ...rec });
  }
  return results;
}
