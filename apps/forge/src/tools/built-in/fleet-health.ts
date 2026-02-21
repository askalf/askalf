/**
 * Built-in Tool: Fleet Health (Level 8 — Vibe Self-Awareness)
 * Exposes fleet diagnostics to agents: health checks, leaderboard,
 * cost summaries, and execution statistics with anomaly detection.
 */

import { query } from '../../database.js';
import { runHealthCheck } from '../../orchestration/monitoring-agent.js';
import { getFleetLeaderboard } from '../../orchestration/event-log.js';
import { getCostSummary, getDailyCosts } from '../../observability/cost-tracker.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface FleetHealthInput {
  action: 'check' | 'leaderboard' | 'costs' | 'execution_stats';
  days?: number;
  owner_id?: string;
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function fleetHealth(input: FleetHealthInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'check':
        return await handleCheck(startTime);
      case 'leaderboard':
        return await handleLeaderboard(startTime);
      case 'costs':
        return await handleCosts(input, startTime);
      case 'execution_stats':
        return await handleExecutionStats(startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: check, leaderboard, costs, execution_stats`,
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
// Check Action
// ============================================

async function handleCheck(startTime: number): Promise<ToolResult> {
  const report = await runHealthCheck();

  return {
    output: {
      overall: report.overall,
      timestamp: report.timestamp,
      checks: report.checks,
      alerts: report.alerts,
      alert_count: report.alerts.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Leaderboard Action
// ============================================

async function handleLeaderboard(startTime: number): Promise<ToolResult> {
  const leaderboard = await getFleetLeaderboard();

  return {
    output: {
      agents: leaderboard.map((a) => ({
        agent_id: a.agentId,
        name: a.agentName,
        tasks_completed: a.tasksCompleted,
        tasks_failed: a.tasksFailed,
        success_rate: Math.round(a.successRate * 100),
        avg_cost: parseFloat((a.avgCost || 0).toFixed(4)),
        avg_duration_ms: Math.round(a.avgDuration || 0),
        total_cost: parseFloat((a.totalCost || 0).toFixed(4)),
        memory_count: a.memoryCount,
      })),
      total_agents: leaderboard.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Costs Action
// ============================================

async function handleCosts(input: FleetHealthInput, startTime: number): Promise<ToolResult> {
  const days = input.days ?? 7;
  const ownerId = input.owner_id ?? 'system:forge';

  const [summary, daily] = await Promise.all([
    getCostSummary(ownerId, { agentId: input.agent_id }),
    getDailyCosts(ownerId, days),
  ]);

  return {
    output: { summary, daily, period_days: days },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Execution Stats Action
// ============================================

async function handleExecutionStats(startTime: number): Promise<ToolResult> {
  // Per-agent execution stats for last 24h
  const stats = await query<{
    agent_id: string; agent_name: string;
    total: string; completed: string; failed: string;
    avg_cost: string; avg_duration: string;
  }>(
    `SELECT e.agent_id, a.name AS agent_name,
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE e.status = 'completed')::text AS completed,
            COUNT(*) FILTER (WHERE e.status = 'failed')::text AS failed,
            COALESCE(AVG(e.cost), 0)::text AS avg_cost,
            COALESCE(AVG(e.duration_ms), 0)::text AS avg_duration
     FROM forge_executions e
     JOIN forge_agents a ON e.agent_id = a.id
     WHERE e.started_at > NOW() - INTERVAL '24 hours'
     GROUP BY e.agent_id, a.name
     ORDER BY COUNT(*) DESC`,
  );

  // Compare last 1h vs baseline (2h-24h) for anomaly detection
  const lastHour = await query<{ total: string; failed: string; total_cost: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
            COALESCE(SUM(cost), 0)::text AS total_cost
     FROM forge_executions
     WHERE started_at > NOW() - INTERVAL '1 hour'`,
  );
  const baseline = await query<{ total: string; failed: string; total_cost: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
            COALESCE(SUM(cost), 0)::text AS total_cost
     FROM forge_executions
     WHERE started_at BETWEEN NOW() - INTERVAL '24 hours' AND NOW() - INTERVAL '1 hour'`,
  );

  // Calculate anomalies
  const anomalies: Array<{ type: string; message: string; severity: string }> = [];
  const hourTotal = parseInt(lastHour[0]?.total ?? '0', 10);
  const hourFailed = parseInt(lastHour[0]?.failed ?? '0', 10);
  const hourCost = parseFloat(lastHour[0]?.total_cost ?? '0') || 0;
  const baseTotal = parseInt(baseline[0]?.total ?? '0', 10) || 0;
  const baseFailed = parseInt(baseline[0]?.failed ?? '0', 10) || 0;
  const baseCost = parseFloat(baseline[0]?.total_cost ?? '0') || 0;
  const baseHours = 23;

  const hourFailRate = hourTotal > 0 ? hourFailed / hourTotal : 0;
  const baseFailRate = baseTotal > 0 ? baseFailed / baseTotal : 0;
  const hourlyBaseCost = baseHours > 0 ? baseCost / baseHours : 0;

  if (hourTotal >= 3 && hourFailRate > baseFailRate * 2 && hourFailRate > 0.3) {
    anomalies.push({
      type: 'failure_rate_spike',
      message: `Failure rate ${(hourFailRate * 100).toFixed(0)}% vs baseline ${(baseFailRate * 100).toFixed(0)}%`,
      severity: hourFailRate > 0.6 ? 'critical' : 'warning',
    });
  }
  if (hourlyBaseCost > 0.01 && hourCost > hourlyBaseCost * 3) {
    anomalies.push({
      type: 'cost_spike',
      message: `Hourly cost $${hourCost.toFixed(2)} vs baseline $${hourlyBaseCost.toFixed(2)}/hr`,
      severity: hourCost > hourlyBaseCost * 5 ? 'critical' : 'warning',
    });
  }

  return {
    output: {
      period: '24h',
      agents: stats.map((s) => ({
        agent_id: s.agent_id,
        name: s.agent_name,
        total: parseInt(s.total, 10),
        completed: parseInt(s.completed, 10),
        failed: parseInt(s.failed, 10),
        success_rate: parseInt(s.total, 10) > 0
          ? Math.round(parseInt(s.completed, 10) / parseInt(s.total, 10) * 100)
          : 0,
        avg_cost: parseFloat((parseFloat(s.avg_cost) || 0).toFixed(4)),
        avg_duration_ms: Math.round(parseFloat(s.avg_duration) || 0),
      })),
      anomalies,
      last_hour: { total: hourTotal, failed: hourFailed, cost: parseFloat(hourCost.toFixed(4)) },
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
