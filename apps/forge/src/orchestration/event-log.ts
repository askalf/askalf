/**
 * Execution Event Log (Phase 14)
 * Persistent event log for execution replay and fleet analytics.
 * All forge events are logged to postgres for auditing and replay.
 */

import { query } from '../database.js';
import { getEventBus, type ForgeEvent } from './event-bus.js';

// ============================================
// Concurrency Limiter — prevents pool exhaustion
// ============================================
// Under high concurrency (8/8 agents), the event bus can fire 100+ events/sec,
// each triggering a DB INSERT. Without throttling, these exhaust the pg.Pool
// (max 60 slots), causing connection timeouts. Limit to MAX_CONCURRENT and
// drop events gracefully if the queue fills up (analytics are non-critical).

const MAX_CONCURRENT_LOG_WRITES = 5;
const MAX_QUEUE_SIZE = 200;

let activeLogWrites = 0;
const logWriteQueue: Array<() => void> = [];

function acquireWriteSlot(): Promise<boolean> {
  if (activeLogWrites < MAX_CONCURRENT_LOG_WRITES) {
    activeLogWrites++;
    return Promise.resolve(true);
  }
  if (logWriteQueue.length >= MAX_QUEUE_SIZE) {
    // Queue full — drop event to prevent memory growth and pool starvation
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    logWriteQueue.push(() => resolve(true));
  });
}

function releaseWriteSlot(): void {
  const next = logWriteQueue.shift();
  if (next) {
    // Hand off slot to next waiter without decrementing (they take the slot)
    next();
  } else {
    activeLogWrites--;
  }
}

// ============================================
// Core Log Function
// ============================================

/**
 * Log an event to the persistent store.
 * Rate-limited to MAX_CONCURRENT_LOG_WRITES concurrent DB writes.
 * Drops events gracefully when under extreme pressure.
 */
export async function logEvent(event: ForgeEvent): Promise<void> {
  const acquired = await acquireWriteSlot();
  if (!acquired) {
    console.warn('[EventLog] Write queue full — dropping event:', event.type, event.event);
    return;
  }

  try {
    const e = event as unknown as Record<string, unknown>;
    const agentId = (e['agentId'] as string) ?? null;
    const agentName = (e['agentName'] as string) ?? null;
    const executionId = (e['executionId'] as string) ?? null;
    const sessionId = (e['sessionId'] as string) ?? null;

    await query(
      `INSERT INTO forge_event_log
       (event_type, event_name, session_id, execution_id, agent_id, agent_name, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.type, event.event, sessionId, executionId, agentId, agentName, JSON.stringify(event)],
    );
  } finally {
    releaseWriteSlot();
  }
}

/**
 * Subscribe to the event bus and log all events persistently.
 */
export function startEventLogger(): void {
  const eventBus = getEventBus();
  if (!eventBus) {
    console.warn('[EventLog] Event bus not available — persistent logging disabled');
    return;
  }

  eventBus.on('*', (event) => {
    void logEvent(event).catch((err) => {
      console.warn('[EventLog] Failed to persist event:', err instanceof Error ? err.message : err);
    });
  });

  console.log('[EventLog] Persistent event logger started');
}

/**
 * Get events for an execution (replay).
 */
export async function getExecutionEvents(executionId: string): Promise<Array<{
  id: number;
  event_type: string;
  event_name: string;
  agent_name: string | null;
  data: Record<string, unknown>;
  created_at: string;
}>> {
  return query(
    `SELECT id, event_type, event_name, agent_name, data, created_at::text
     FROM forge_event_log
     WHERE execution_id = $1
     ORDER BY id`,
    [executionId],
  );
}

/**
 * Get events for a session (orchestration replay).
 */
export async function getSessionEvents(sessionId: string): Promise<Array<{
  id: number;
  event_type: string;
  event_name: string;
  agent_name: string | null;
  data: Record<string, unknown>;
  created_at: string;
}>> {
  return query(
    `SELECT id, event_type, event_name, agent_name, data, created_at::text
     FROM forge_event_log
     WHERE session_id = $1
     ORDER BY id`,
    [sessionId],
  );
}

/**
 * Get recent events (dashboard live feed).
 */
export async function getRecentEvents(limit: number = 50): Promise<Array<{
  id: number;
  event_type: string;
  event_name: string;
  agent_name: string | null;
  execution_id: string | null;
  session_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}>> {
  return query(
    `SELECT id, event_type, event_name, agent_name, execution_id, session_id, data, created_at::text
     FROM forge_event_log
     ORDER BY id DESC
     LIMIT $1`,
    [limit],
  );
}

/**
 * Fleet leaderboard: rank agents by performance metrics.
 */
export async function getFleetLeaderboard(): Promise<Array<{
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksFailed: number;
  successRate: number;
  avgCost: number;
  avgDuration: number;
  totalCost: number;
  memoryCount: number;
}>> {
  const agents = await query<{
    id: string;
    name: string;
    tasks_completed: number;
    tasks_failed: number;
    avg_cost: string;
    avg_duration: string;
    total_cost: string;
  }>(
    `SELECT a.id, a.name, a.tasks_completed, a.tasks_failed,
            COALESCE(AVG(e.cost), 0)::text AS avg_cost,
            COALESCE(AVG(e.duration_ms), 0)::text AS avg_duration,
            COALESCE(SUM(e.cost), 0)::text AS total_cost
     FROM forge_agents a
     LEFT JOIN forge_executions e ON e.agent_id = a.id AND e.status IN ('completed', 'failed')
     WHERE a.is_decommissioned IS NOT TRUE
     GROUP BY a.id, a.name, a.tasks_completed, a.tasks_failed
     ORDER BY a.tasks_completed DESC`,
  );

  // Get memory counts per agent
  const memoryCounts = await query<{ agent_id: string; count: string }>(
    `SELECT agent_id, COUNT(*)::text AS count
     FROM forge_semantic_memories
     GROUP BY agent_id`,
  );
  const memMap = new Map(memoryCounts.map((m) => [m.agent_id, parseInt(m.count)]));

  return agents.map((a) => {
    const total = a.tasks_completed + a.tasks_failed;
    return {
      agentId: a.id,
      agentName: a.name,
      tasksCompleted: a.tasks_completed,
      tasksFailed: a.tasks_failed,
      successRate: total > 0 ? a.tasks_completed / total : 0,
      avgCost: parseFloat(a.avg_cost) || 0,
      avgDuration: parseFloat(a.avg_duration) || 0,
      totalCost: parseFloat(a.total_cost) || 0,
      memoryCount: memMap.get(a.id) ?? 0,
    };
  });
}

/**
 * Event log stats.
 */
export async function getEventLogStats(): Promise<{
  totalEvents: number;
  eventsLast24h: number;
  topEventTypes: Array<{ type: string; count: number }>;
}> {
  const [total, recent, types] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM forge_event_log`),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM forge_event_log WHERE created_at > NOW() - INTERVAL '24 hours'`),
    query<{ event_type: string; count: string }>(
      `SELECT event_type, COUNT(*)::text AS count FROM forge_event_log
       GROUP BY event_type ORDER BY COUNT(*) DESC LIMIT 10`),
  ]);

  return {
    totalEvents: parseInt(total[0]?.count ?? '0', 10) || 0,
    eventsLast24h: parseInt(recent[0]?.count ?? '0', 10) || 0,
    topEventTypes: types.map((t) => ({ type: t.event_type, count: parseInt(t.count) })),
  };
}
