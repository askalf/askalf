/**
 * SELF Worker Queues
 * BullMQ workers for heartbeat, schedules, and action execution.
 * Designed to be imported and started by the main worker app.
 */

import { Queue, Worker } from 'bullmq';
import { query, queryOne } from '../database.js';
import { logActivity } from '../services/activity-logger.js';
import { recordHeartbeat, getDueHeartbeats, resetDailyBudgets, resetMonthlyBudgets } from '../services/heartbeat.js';
import { decideAutonomy } from '../services/autonomy.js';
import { publishActivity } from '../services/sse-stream.js';
import { executeIntegrationTool, getToolRiskScore } from '../integrations/index.js';
import { ulid } from 'ulid';

// ============================================
// Queue Names
// ============================================

export const SELF_QUEUES = {
  HEARTBEAT: 'self-heartbeat',
  SCHEDULE: 'self-schedule',
  ACTION: 'self-action',
  BUDGET_RESET: 'self-budget-reset',
} as const;

// ============================================
// Types
// ============================================

interface SelfInstanceRow {
  id: string;
  user_id: string;
  tenant_id: string;
  autonomy_level: number;
  daily_budget_usd: string;
  daily_spent_usd: string;
  monthly_budget_usd: string;
  monthly_spent_usd: string;
  forge_agent_id: string | null;
  status: string;
}

interface IntegrationRow {
  id: string;
  self_id: string;
  provider: string;
  status: string;
  poll_interval_ms: number | null;
  next_poll_at: string | null;
}

interface ScheduleRow {
  id: string;
  self_id: string;
  name: string;
  action_type: string;
  action_config: Record<string, unknown>;
}

// ============================================
// Heartbeat Worker
// ============================================

export function createHeartbeatWorker(redisConfig: { host: string; port: number; password?: string }): Worker {
  return new Worker(
    SELF_QUEUES.HEARTBEAT,
    async (job) => {
      const selfId = job.data.selfId as string | undefined;

      if (selfId) {
        // Process a specific SELF instance
        await processHeartbeat(selfId);
      } else {
        // Scan for all due heartbeats
        const dueInstances = await getDueHeartbeats();
        for (const instance of dueInstances) {
          try {
            await processHeartbeat(instance.id);
          } catch (err) {
            console.error(`[SELF Heartbeat] Failed for ${instance.id}:`, err);
          }
        }
      }
    },
    {
      connection: redisConfig,
      concurrency: 5,
      lockDuration: 120000, // 2 minutes
    },
  );
}

async function processHeartbeat(selfId: string): Promise<void> {
  const self = await queryOne<SelfInstanceRow>(
    `SELECT id, user_id, tenant_id, autonomy_level,
            daily_budget_usd, daily_spent_usd,
            monthly_budget_usd, monthly_spent_usd,
            forge_agent_id, status
     FROM self_instances WHERE id = $1 AND status = 'active'`,
    [selfId],
  );

  if (!self) return;

  // Check budget
  const dailyRemaining = parseFloat(self.daily_budget_usd) - parseFloat(self.daily_spent_usd);
  if (dailyRemaining <= 0) {
    await recordHeartbeat(selfId);
    return;
  }

  // Poll due integrations
  const dueIntegrations = await query<IntegrationRow>(
    `SELECT id, self_id, provider, status, poll_interval_ms, next_poll_at
     FROM self_integrations
     WHERE self_id = $1 AND status = 'connected'
       AND poll_interval_ms IS NOT NULL
       AND (next_poll_at IS NULL OR next_poll_at <= NOW())`,
    [selfId],
  );

  const observations: string[] = [];

  for (const integration of dueIntegrations) {
    try {
      const result = await pollIntegration(self, integration);
      if (result) {
        observations.push(result);
      }

      // Update next poll time
      await query(
        `UPDATE self_integrations
         SET next_poll_at = NOW() + ($1 || ' milliseconds')::interval,
             last_sync = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [integration.poll_interval_ms, integration.id],
      );
    } catch (err) {
      console.error(`[SELF Heartbeat] Poll failed for integration ${integration.id}:`, err);
    }
  }

  // Check due schedules
  const dueSchedules = await query<ScheduleRow>(
    `SELECT id, self_id, name, action_type, action_config
     FROM self_schedules
     WHERE self_id = $1 AND enabled = true
       AND next_run_at IS NOT NULL AND next_run_at <= NOW()`,
    [selfId],
  );

  for (const schedule of dueSchedules) {
    try {
      await executeScheduledAction(self, schedule);
    } catch (err) {
      console.error(`[SELF Heartbeat] Schedule failed for ${schedule.id}:`, err);
    }
  }

  // If there are observations, feed them to SELF for processing
  if (observations.length > 0) {
    await logActivity({
      selfId,
      userId: self.user_id,
      type: 'observation',
      title: `Heartbeat: ${observations.length} new observations`,
      body: observations.join('\n'),
      importance: 4,
      visibleToUser: false,
    });
  }

  await recordHeartbeat(selfId);
}

async function pollIntegration(
  self: SelfInstanceRow,
  integration: IntegrationRow,
): Promise<string | null> {
  switch (integration.provider) {
    case 'gmail': {
      const result = await executeIntegrationTool(integration.id, 'gmail_get_unread_count', {});
      if (result.error) return null;
      const data = result.result as { unread_count: number };
      if (data.unread_count > 0) {
        const activityId = await logActivity({
          selfId: self.id,
          userId: self.user_id,
          type: 'observation',
          title: `${data.unread_count} unread email${data.unread_count > 1 ? 's' : ''}`,
          integrationId: integration.id,
          importance: data.unread_count > 5 ? 6 : 4,
        });
        publishActivity(self.id, {
          id: activityId,
          type: 'observation',
          title: `${data.unread_count} unread emails`,
        });
        return `${data.unread_count} unread emails`;
      }
      return null;
    }

    case 'google_calendar': {
      const result = await executeIntegrationTool(integration.id, 'calendar_today', {});
      if (result.error) return null;
      const events = result.result as Array<{ summary: string; start: { dateTime: string } }>;
      if (events.length > 0) {
        const upcoming = events.filter(e => new Date(e.start.dateTime) > new Date());
        if (upcoming.length > 0) {
          const next = upcoming[0]!;
          const activityId = await logActivity({
            selfId: self.id,
            userId: self.user_id,
            type: 'observation',
            title: `Next event: ${next.summary}`,
            body: `Starting at ${new Date(next.start.dateTime).toLocaleTimeString()}`,
            integrationId: integration.id,
            importance: 5,
          });
          publishActivity(self.id, {
            id: activityId,
            type: 'observation',
            title: `Next event: ${next.summary}`,
          });
          return `Next event: ${next.summary}`;
        }
      }
      return null;
    }

    default:
      return null;
  }
}

async function executeScheduledAction(
  self: SelfInstanceRow,
  schedule: ScheduleRow,
): Promise<void> {
  const config = schedule.action_config;
  const actionType = schedule.action_type;

  // Check autonomy
  const decision = decideAutonomy(
    self.autonomy_level,
    actionType,
    0, // scheduled actions have no direct cost
    parseFloat(self.daily_budget_usd),
    parseFloat(self.daily_spent_usd),
  );

  if (!decision.shouldAct) {
    // Create approval request
    await query(
      `INSERT INTO self_approvals (id, self_id, user_id, type, title, description, proposed_action, status, urgency)
       VALUES ($1, $2, $3, 'action', $4, $5, $6, 'pending', 'normal')`,
      [
        ulid(),
        self.id,
        self.user_id,
        `Scheduled: ${schedule.name}`,
        `SELF wants to run "${schedule.name}" but needs your approval (risk: ${decision.riskScore}).`,
        JSON.stringify(config),
      ],
    );

    await logActivity({
      selfId: self.id,
      userId: self.user_id,
      type: 'approval_request',
      title: `Needs approval: ${schedule.name}`,
      importance: 6,
    });

    return;
  }

  // Execute the action
  await logActivity({
    selfId: self.id,
    userId: self.user_id,
    type: 'action',
    title: `Running: ${schedule.name}`,
    metadata: config,
    importance: 5,
  });

  // Update schedule next_run_at
  await query(
    `UPDATE self_schedules
     SET last_run_at = NOW(),
         next_run_at = CASE
           WHEN interval_ms IS NOT NULL THEN NOW() + (interval_ms || ' milliseconds')::interval
           ELSE NULL
         END,
         updated_at = NOW()
     WHERE id = $1`,
    [schedule.id],
  );
}

// ============================================
// Schedule Worker
// ============================================

export function createScheduleWorker(redisConfig: { host: string; port: number; password?: string }): Worker {
  return new Worker(
    SELF_QUEUES.SCHEDULE,
    async (job) => {
      const { selfId, scheduleId, actionType, actionConfig } = job.data;

      const self = await queryOne<SelfInstanceRow>(
        `SELECT * FROM self_instances WHERE id = $1 AND status = 'active'`,
        [selfId],
      );

      if (!self) return;

      await logActivity({
        selfId,
        userId: self.user_id,
        type: 'action',
        title: `Scheduled task: ${actionType}`,
        metadata: actionConfig,
        importance: 4,
      });
    },
    {
      connection: redisConfig,
      concurrency: 3,
      lockDuration: 60000,
    },
  );
}

// ============================================
// Action Worker
// ============================================

export function createActionWorker(redisConfig: { host: string; port: number; password?: string }): Worker {
  return new Worker(
    SELF_QUEUES.ACTION,
    async (job) => {
      const {
        selfId,
        userId,
        integrationId,
        toolName,
        toolArgs,
        approvalId,
      } = job.data;

      const riskScore = getToolRiskScore(toolName);

      // Execute the tool
      const result = await executeIntegrationTool(integrationId, toolName, toolArgs);

      if (result.error) {
        await logActivity({
          selfId,
          userId,
          type: 'error',
          title: `Action failed: ${toolName}`,
          body: result.error,
          integrationId,
          approvalId,
          importance: 7,
        });
      } else {
        // Update stats
        await query(
          `UPDATE self_instances
           SET actions_taken = actions_taken + 1, updated_at = NOW()
           WHERE id = $1`,
          [selfId],
        );

        const activityId = await logActivity({
          selfId,
          userId,
          type: 'action',
          title: `Completed: ${toolName}`,
          body: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
          integrationId,
          approvalId,
          importance: 5,
        });

        publishActivity(selfId, {
          id: activityId,
          type: 'action',
          title: `Completed: ${toolName}`,
        });
      }
    },
    {
      connection: redisConfig,
      concurrency: 10,
      lockDuration: 30000,
    },
  );
}

// ============================================
// Budget Reset Worker
// ============================================

export function createBudgetResetWorker(redisConfig: { host: string; port: number; password?: string }): Worker {
  return new Worker(
    SELF_QUEUES.BUDGET_RESET,
    async (job) => {
      const { type } = job.data;

      if (type === 'daily') {
        const count = await resetDailyBudgets();
        console.log(`[SELF Budget] Reset daily budgets for ${count} instances`);
      } else if (type === 'monthly') {
        const count = await resetMonthlyBudgets();
        console.log(`[SELF Budget] Reset monthly budgets for ${count} instances`);
      }
    },
    {
      connection: redisConfig,
      concurrency: 1,
      lockDuration: 30000,
    },
  );
}

// ============================================
// Queue Setup (for scheduler)
// ============================================

export async function scheduleSelfJobs(redisConfig: { host: string; port: number; password?: string }): Promise<void> {
  const heartbeatQueue = new Queue(SELF_QUEUES.HEARTBEAT, { connection: redisConfig });
  const budgetQueue = new Queue(SELF_QUEUES.BUDGET_RESET, { connection: redisConfig });

  // Clean existing repeatable jobs
  const existingHeartbeat = await heartbeatQueue.getRepeatableJobs();
  for (const job of existingHeartbeat) {
    await heartbeatQueue.removeRepeatableByKey(job.key);
  }
  const existingBudget = await budgetQueue.getRepeatableJobs();
  for (const job of existingBudget) {
    await budgetQueue.removeRepeatableByKey(job.key);
  }

  // Heartbeat scanner: every 1 minute, finds SELF instances due for heartbeat
  await heartbeatQueue.add(
    'scan',
    {},
    {
      repeat: { pattern: '*/1 * * * *' }, // Every minute
      removeOnComplete: 50,
      removeOnFail: 50,
      jobId: 'self-heartbeat-scan',
    },
  );

  // Daily budget reset: midnight UTC
  await budgetQueue.add(
    'daily-reset',
    { type: 'daily' },
    {
      repeat: { pattern: '0 0 * * *' }, // Midnight daily
      removeOnComplete: 10,
      removeOnFail: 10,
      jobId: 'self-budget-daily-reset',
    },
  );

  // Monthly budget reset: first of month midnight UTC
  await budgetQueue.add(
    'monthly-reset',
    { type: 'monthly' },
    {
      repeat: { pattern: '0 0 1 * *' }, // First of month
      removeOnComplete: 10,
      removeOnFail: 10,
      jobId: 'self-budget-monthly-reset',
    },
  );

  await heartbeatQueue.close();
  await budgetQueue.close();

  console.log('[SELF] Scheduled heartbeat scan (every 1min), daily budget reset, monthly budget reset');
}
