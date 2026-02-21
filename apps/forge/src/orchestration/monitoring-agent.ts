/**
 * Production Monitoring Agent (Phase 12)
 * Continuously monitors system health, detects anomalies, and alerts.
 * Runs as a periodic cycle inside Forge (no separate container).
 */

import { query } from '../database.js';
import { substrateQuery } from '../database.js';
import { getEventBus } from './event-bus.js';

export interface HealthReport {
  timestamp: string;
  overall: 'healthy' | 'degraded' | 'critical';
  checks: HealthCheck[];
  alerts: Alert[];
}

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  value: string;
  threshold?: string;
}

interface Alert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

let lastReport: HealthReport | null = null;

/** Map alert metrics to the agent responsible for handling them */
const ALERT_ASSIGNMENT: Record<string, string> = {
  execution_failure_rate: 'Nexus',
  stuck_executions: 'DevOps',
  hourly_cost: 'Crucible',
  agents_in_error: 'DevOps',
};

/**
 * Create a ticket from a monitoring alert (with deduplication).
 * Only creates if no open/in_progress ticket exists for the same metric.
 */
async function createAlertTicket(alert: Alert): Promise<void> {
  try {
    // Deduplicate: skip if open ticket already exists for this metric
    const existing = await substrateQuery<{ id: string }>(
      `SELECT id FROM agent_tickets
       WHERE metadata->>'alert_metric' = $1
         AND status IN ('open', 'in_progress')
       LIMIT 1`,
      [alert.metric],
    );
    if (existing.length > 0) return;

    const id = `MON-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const assignedTo = ALERT_ASSIGNMENT[alert.metric] || 'Nexus';
    const priority = alert.severity === 'critical' ? 'urgent' : 'high';

    await substrateQuery(
      `INSERT INTO agent_tickets
       (id, title, description, status, priority, category, created_by, assigned_to,
        is_agent_ticket, source, metadata)
       VALUES ($1, $2, $3, 'open', $4, 'monitoring', 'system:monitor', $5,
        true, 'agent', $6)`,
      [
        id,
        `[${alert.severity.toUpperCase()}] ${alert.metric}: ${alert.message}`,
        `Monitoring alert detected at ${new Date().toISOString()}.\n\nMetric: ${alert.metric}\nValue: ${alert.value}\nThreshold: ${alert.threshold}\nSeverity: ${alert.severity}\n\nInvestigate and resolve the underlying issue.`,
        priority,
        assignedTo,
        JSON.stringify({ alert_metric: alert.metric, alert_severity: alert.severity, auto_created: true }),
      ],
    );

    // Audit trail
    await substrateQuery(
      `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
       VALUES ('ticket', $1, 'created', 'system:monitor', '{}', $2)`,
      [id, JSON.stringify({ title: alert.message, priority, assigned_to: assignedTo })],
    ).catch(() => {});

    console.log(`[Monitor] Auto-created ticket ${id} for ${alert.metric} → assigned to ${assignedTo}`);
  } catch (err) {
    console.warn(`[Monitor] Failed to create alert ticket for ${alert.metric}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Run a full health check across all monitored systems.
 */
export async function runHealthCheck(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const alerts: Alert[] = [];

  // 1. Execution failure rate (last hour) — exclude operational failures (SIGTERM from deploys, orphaned)
  const failureRate = await query<{ total: string; failed: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'failed' AND error NOT LIKE '%SIGTERM%' AND error NOT LIKE '%shutting down%' AND error NOT LIKE '%Orphaned%')::text AS failed
     FROM forge_executions
     WHERE started_at > NOW() - INTERVAL '1 hour'`,
  );
  const total = parseInt(failureRate[0]?.total ?? '0');
  const failed = parseInt(failureRate[0]?.failed ?? '0');
  const rate = total > 0 ? failed / total : 0;

  checks.push({
    name: 'execution_failure_rate',
    status: rate > 0.5 ? 'fail' : rate > 0.25 ? 'warn' : 'pass',
    value: `${(rate * 100).toFixed(1)}%`,
    threshold: '25%/50%',
  });

  if (rate > 0.5 && total >= 3) {
    alerts.push({
      severity: 'critical',
      message: `High execution failure rate: ${(rate * 100).toFixed(1)}% (${failed}/${total})`,
      metric: 'execution_failure_rate',
      value: rate,
      threshold: 0.5,
    });
  }

  // 2. Stuck executions (running > 15 min)
  const stuck = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM forge_executions
     WHERE status = 'running' AND started_at < NOW() - INTERVAL '15 minutes'`,
  );
  const stuckCount = parseInt(stuck[0]?.count ?? '0');

  checks.push({
    name: 'stuck_executions',
    status: stuckCount > 2 ? 'fail' : stuckCount > 0 ? 'warn' : 'pass',
    value: String(stuckCount),
    threshold: '0/2',
  });

  if (stuckCount > 0) {
    alerts.push({
      severity: stuckCount > 2 ? 'critical' : 'warning',
      message: `${stuckCount} execution(s) stuck (running > 15 min)`,
      metric: 'stuck_executions',
      value: stuckCount,
      threshold: 0,
    });
  }

  // 3. Cost burn rate (last hour)
  // Baseline with 16 agents is $7-10/hr. Warn at $10 (high-normal), fail at $15 (over budget).
  const costResult = await query<{ total_cost: string }>(
    `SELECT COALESCE(SUM(cost), 0)::text AS total_cost
     FROM forge_executions
     WHERE started_at > NOW() - INTERVAL '1 hour' AND cost IS NOT NULL`,
  );
  const hourlyCost = parseFloat(costResult[0]?.total_cost ?? '0');

  checks.push({
    name: 'hourly_cost',
    status: hourlyCost > 15.0 ? 'fail' : hourlyCost > 10.0 ? 'warn' : 'pass',
    value: `$${hourlyCost.toFixed(2)}`,
    threshold: '$10.00/$15.00',
  });

  if (hourlyCost > 15.0) {
    alerts.push({
      severity: 'critical',
      message: `High hourly cost: $${hourlyCost.toFixed(2)} in last hour (exceeds $15 budget)`,
      metric: 'hourly_cost',
      value: hourlyCost,
      threshold: 15.0,
    });
  }

  // 4. Agent health (any agents in error state)
  const errorAgents = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM forge_agents WHERE status = 'error'`,
  );
  const errorCount = parseInt(errorAgents[0]?.count ?? '0');

  checks.push({
    name: 'agents_in_error',
    status: errorCount > 0 ? 'warn' : 'pass',
    value: String(errorCount),
  });

  // 5. Memory system health (check recent stores)
  const recentMemories = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM forge_semantic_memories
     WHERE created_at > NOW() - INTERVAL '6 hours'`,
  );
  const memCount = parseInt(recentMemories[0]?.count ?? '0');

  checks.push({
    name: 'memory_activity',
    status: 'pass',
    value: `${memCount} memories stored (6h)`,
  });

  // 6. Pending interventions (human attention needed)
  // Note: interventions live in the substrate DB (agent_interventions), not forge DB.
  // Query execution feedback as a proxy for pending attention items.
  let pendingCount = 0;
  try {
    const pendingItems = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM forge_execution_feedback WHERE processed = false`,
    );
    pendingCount = parseInt(pendingItems[0]?.count ?? '0');
  } catch { /* table may not exist yet */ }

  checks.push({
    name: 'pending_interventions',
    status: pendingCount > 10 ? 'warn' : 'pass',
    value: String(pendingCount),
  });

  // Determine overall status
  const hasFailures = checks.some((c) => c.status === 'fail');
  const hasWarnings = checks.some((c) => c.status === 'warn');
  const overall = hasFailures ? 'critical' : hasWarnings ? 'degraded' : 'healthy';

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    overall,
    checks,
    alerts,
  };

  lastReport = report;

  // Emit alerts via event bus + auto-create tickets
  if (alerts.length > 0) {
    const eventBus = getEventBus();
    for (const alert of alerts) {
      void eventBus?.emitAgent('status_changed', 'system-monitor', 'System Monitor', {
        event: 'alert',
        severity: alert.severity,
        message: alert.message,
      }).catch(() => {});

      // Level 4: Auto-create tickets for alerts so agents can pick them up
      void createAlertTicket(alert).catch(() => {});
    }
  }

  return report;
}

/**
 * Get the last health report (cached).
 */
export function getLastHealthReport(): HealthReport | null {
  return lastReport;
}

/**
 * Auto-heal stuck executions by marking them as failed.
 */
export async function healStuckExecutions(): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE forge_executions
     SET status = 'failed', error = 'Auto-healed: execution stuck > 30 minutes', completed_at = NOW()
     WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes'
     RETURNING id`,
  );

  if (result.length > 0) {
    console.log(`[Monitor] Auto-healed ${result.length} stuck executions`);
  }
  return result.length;
}

/**
 * Start monitoring cycles.
 * - Health check every 5 minutes
 * - Auto-heal stuck executions every 10 minutes
 */
export function startMonitoring(): void {
  console.log('[Monitor] Production monitoring started (health=5m, heal=10m)');

  // Initial check after 30 seconds
  setTimeout(() => {
    void runHealthCheck().catch((err) => console.warn('[Monitor] Health check failed:', err));
  }, 30_000);

  // Regular health checks
  setInterval(() => {
    void runHealthCheck().catch((err) => console.warn('[Monitor] Health check failed:', err));
  }, 5 * 60_000);

  // Auto-heal
  setInterval(() => {
    void healStuckExecutions().catch((err) => console.warn('[Monitor] Auto-heal failed:', err));
  }, 10 * 60_000);
}
