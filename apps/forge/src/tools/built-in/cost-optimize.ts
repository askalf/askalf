/**
 * Built-in Tool: Cost Optimize (Level 11 — Vibe Autonomy)
 * Cost-aware decision making: view cost profiles, get model recommendations,
 * batch recommendations, and analyze own spending patterns.
 */

import { query } from '../../database.js';
import { getCostDashboard, selectOptimalModel, getModelRecommendations } from '../../orchestration/cost-router.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface CostOptimizeInput {
  action: 'dashboard' | 'recommend' | 'recommend_batch' | 'my_costs';
  // For recommend:
  capability?: string;
  min_quality?: number;
  // For recommend_batch:
  capabilities?: string[];
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function costOptimize(input: CostOptimizeInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'dashboard':
        return await handleDashboard(startTime);
      case 'recommend':
        return await handleRecommend(input, startTime);
      case 'recommend_batch':
        return await handleRecommendBatch(input, startTime);
      case 'my_costs':
        return await handleMyCosts(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: dashboard, recommend, recommend_batch, my_costs`,
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
// Dashboard Action
// ============================================

async function handleDashboard(startTime: number): Promise<ToolResult> {
  const dashboard = await getCostDashboard();

  return {
    output: {
      profiles: dashboard.profiles.map((p) => ({
        capability: p.capability,
        model_id: p.model_id,
        avg_cost: Math.round(p.avg_cost * 10000) / 10000,
        avg_quality: Math.round(p.avg_quality * 100) / 100,
        sample_count: p.sample_count,
      })),
      total_profiles: dashboard.profiles.length,
      savings: {
        total_samples: dashboard.savings.totalSamples,
        avg_cost_reduction_pct: Number.isFinite(dashboard.savings.avgCostReduction) ? Math.round(dashboard.savings.avgCostReduction * 100) : 0,
      },
      message: `${dashboard.profiles.length} cost profiles across ${new Set(dashboard.profiles.map((p) => p.capability)).size} capabilities. Potential average savings: ${Number.isFinite(dashboard.savings.avgCostReduction) ? Math.round(dashboard.savings.avgCostReduction * 100) : 0}%.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Recommend Action
// ============================================

async function handleRecommend(input: CostOptimizeInput, startTime: number): Promise<ToolResult> {
  if (!input.capability) {
    return { output: null, error: 'capability is required for recommend', durationMs: 0 };
  }

  const result = await selectOptimalModel(input.capability, input.min_quality ?? 0.7);

  return {
    output: {
      capability: input.capability,
      recommended_model: result.modelId,
      reason: result.reason,
      min_quality: input.min_quality ?? 0.7,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Recommend Batch Action
// ============================================

async function handleRecommendBatch(input: CostOptimizeInput, startTime: number): Promise<ToolResult> {
  if (!input.capabilities || input.capabilities.length === 0) {
    return { output: null, error: 'capabilities array is required for recommend_batch', durationMs: 0 };
  }

  const recommendations = await getModelRecommendations(
    input.capabilities,
    input.min_quality ?? 0.7,
  );

  return {
    output: {
      recommendations: recommendations.map((r) => ({
        capability: r.capability,
        recommended_model: r.modelId,
        reason: r.reason,
      })),
      total: recommendations.length,
      min_quality: input.min_quality ?? 0.7,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// My Costs Action
// ============================================

async function handleMyCosts(input: CostOptimizeInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  // Recent cost breakdown
  const costs = await query<{
    total_cost: string;
    avg_cost: string;
    execution_count: string;
    model_id: string;
    model_cost: string;
    model_count: string;
  }>(
    `SELECT
       SUM(cost)::text AS total_cost,
       AVG(cost)::text AS avg_cost,
       COUNT(*)::text AS execution_count,
       COALESCE(metadata->>'model_id', 'unknown') AS model_id,
       SUM(cost)::text AS model_cost,
       COUNT(*)::text AS model_count
     FROM forge_executions
     WHERE agent_id = $1
       AND started_at > NOW() - INTERVAL '7 days'
     GROUP BY COALESCE(metadata->>'model_id', 'unknown')
     ORDER BY SUM(cost) DESC`,
    [agentId],
  );

  // Overall totals
  const totals = await query<{ total_cost: string; avg_cost: string; execution_count: string }>(
    `SELECT SUM(cost)::text AS total_cost, AVG(cost)::text AS avg_cost, COUNT(*)::text AS execution_count
     FROM forge_executions
     WHERE agent_id = $1 AND started_at > NOW() - INTERVAL '7 days'`,
    [agentId],
  );

  return {
    output: {
      agent_id: agentId,
      period: '7 days',
      total_cost: parseFloat(totals[0]?.total_cost ?? '0') || 0,
      avg_cost_per_execution: parseFloat(totals[0]?.avg_cost ?? '0') || 0,
      total_executions: parseInt(totals[0]?.execution_count ?? '0', 10) || 0,
      by_model: costs.map((c) => ({
        model_id: c.model_id,
        cost: parseFloat(c.model_cost ?? '0') || 0,
        executions: parseInt(c.model_count ?? '0', 10) || 0,
      })),
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
