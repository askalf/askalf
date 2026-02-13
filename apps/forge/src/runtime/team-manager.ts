/**
 * Team Manager
 *
 * Manages Agent Teams lifecycle for fleet coordination.
 * Bridges FleetCoordinator's DAG-based plans with actual
 * agent execution via Redis pubsub and result aggregation.
 *
 * Responsibilities:
 * - Listen for task results from agent containers
 * - Advance coordination plans as tasks complete
 * - Handle failures with retry/skip strategies
 * - Synthesize final results for the lead agent
 * - Persist coordination audit trail
 */

import { ulid } from 'ulid';
import { Redis } from 'ioredis';
import { query, queryOne } from '../database.js';
import { FleetCoordinator, type CoordinationPlan } from './fleet-coordinator.js';

// ============================================
// Types
// ============================================

export interface TeamSession {
  id: string;
  planId: string;
  leadAgentId: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  summary?: string;
}

interface TaskResult {
  executionId: string;
  agentId: string;
  status: 'completed' | 'failed';
  output: string;
  error?: string;
  durationMs: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  planId?: string;
  taskId?: string;
}

export interface TeamConfig {
  maxRetries: number;
  taskTimeoutMs: number;
  failFast: boolean; // Stop all tasks on first failure
}

const DEFAULT_CONFIG: TeamConfig = {
  maxRetries: 1,
  taskTimeoutMs: 300_000, // 5 minutes
  failFast: false,
};

// ============================================
// Team Manager
// ============================================

export class TeamManager {
  private redis: Redis;
  private subscriber: Redis;
  private coordinator: FleetCoordinator;
  private config: TeamConfig;
  private activeSessions: Map<string, TeamSession> = new Map();
  private taskRetries: Map<string, number> = new Map();
  private listening = false;

  constructor(redis: Redis, config?: Partial<TeamConfig>) {
    this.redis = redis;
    this.subscriber = redis.duplicate();
    this.coordinator = new FleetCoordinator(redis);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start a new team session from a coordination plan.
   * Creates the plan, begins execution, and monitors results.
   */
  async startTeam(
    leadAgentId: string,
    leadAgentName: string,
    title: string,
    pattern: CoordinationPlan['pattern'],
    tasks: Array<{
      title: string;
      description: string;
      agentName: string;
      dependencies?: string[];
    }>,
  ): Promise<TeamSession> {
    // Create the coordination plan
    const plan = await this.coordinator.createPlan(
      leadAgentId,
      leadAgentName,
      title,
      pattern,
      tasks,
    );

    // Create team session
    const session: TeamSession = {
      id: ulid(),
      planId: plan.id,
      leadAgentId,
      status: 'active',
      startedAt: new Date().toISOString(),
    };

    // Store session
    this.activeSessions.set(session.id, session);
    await this.redis.setex(
      `fleet:session:${session.id}`,
      86400,
      JSON.stringify(session),
    );

    // Ensure we're listening for results
    if (!this.listening) {
      await this.startListening();
    }

    // Subscribe to result channels for all assigned agents
    const agentIds = new Set(plan.tasks.map((t) => t.assignedAgentId).filter(Boolean));
    for (const agentId of agentIds) {
      const channel = `agent:${agentId}:results`;
      await this.subscriber.subscribe(channel);
    }

    // Begin plan execution (dispatches tasks with no dependencies)
    await this.coordinator.executePlan(plan.id);

    // Set up task timeouts
    for (const task of plan.tasks) {
      this.scheduleTaskTimeout(plan.id, task.id);
    }

    console.log(
      `[TeamManager] Started team session ${session.id} for plan "${title}" ` +
      `with ${plan.tasks.length} tasks (${pattern})`,
    );

    return session;
  }

  /**
   * Get team session status with current plan state.
   */
  async getSession(sessionId: string): Promise<(TeamSession & { plan: CoordinationPlan | null }) | null> {
    let session = this.activeSessions.get(sessionId) ?? null;

    if (!session) {
      const data = await this.redis.get(`fleet:session:${sessionId}`);
      if (!data) return null;
      session = JSON.parse(data) as TeamSession;
    }

    const plan = await this.coordinator.getPlan(session.planId);
    return { ...session, plan };
  }

  /**
   * List all team sessions.
   */
  async listSessions(): Promise<TeamSession[]> {
    const keys = await this.scanKeys('fleet:session:*');
    const sessions: TeamSession[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        try {
          sessions.push(JSON.parse(data) as TeamSession);
        } catch { /* skip invalid */ }
      }
    }

    return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /**
   * Cancel an active team session.
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.status = 'cancelled';
    session.completedAt = new Date().toISOString();

    this.activeSessions.delete(sessionId);
    await this.redis.setex(
      `fleet:session:${sessionId}`,
      86400,
      JSON.stringify(session),
    );

    console.log(`[TeamManager] Cancelled session ${sessionId}`);
  }

  /**
   * Synthesize results from a completed plan into a summary.
   */
  async synthesizeResults(plan: CoordinationPlan): Promise<string> {
    const completedTasks = plan.tasks.filter((t) => t.status === 'completed');
    const failedTasks = plan.tasks.filter((t) => t.status === 'failed');

    const lines: string[] = [
      `## Coordination Results: ${plan.title}`,
      `Pattern: ${plan.pattern} | Lead: ${plan.leadAgentName}`,
      `Status: ${plan.status}`,
      '',
      `### Completed Tasks (${completedTasks.length}/${plan.tasks.length})`,
    ];

    for (const task of completedTasks) {
      lines.push(`**${task.assignedAgent} — ${task.title}**`);
      lines.push(task.result ?? '(no output)');
      lines.push('');
    }

    if (failedTasks.length > 0) {
      lines.push(`### Failed Tasks (${failedTasks.length})`);
      for (const task of failedTasks) {
        lines.push(`**${task.assignedAgent} — ${task.title}**: ${task.error ?? 'unknown error'}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Clean up resources.
   */
  async shutdown(): Promise<void> {
    this.listening = false;
    try {
      await this.subscriber.unsubscribe();
      await this.subscriber.quit();
    } catch {
      // Ignore cleanup errors
    }
  }

  // ============================================
  // Private
  // ============================================

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  private async startListening(): Promise<void> {
    this.listening = true;

    this.subscriber.on('message', async (_channel: string, message: string) => {
      try {
        const result = JSON.parse(message) as TaskResult;

        // Only handle results that belong to a coordination plan
        if (!result.planId || !result.taskId) return;

        await this.handleTaskResult(result);
      } catch (err) {
        console.error(
          `[TeamManager] Error processing result: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    this.subscriber.on('error', (err) => {
      console.error(`[TeamManager] Redis subscriber error: ${err.message}`);
    });
  }

  private async handleTaskResult(result: TaskResult): Promise<void> {
    const { planId, taskId } = result;
    if (!planId || !taskId) return;

    console.log(
      `[TeamManager] Task result: plan=${planId} task=${taskId} status=${result.status}`,
    );

    if (result.status === 'failed' && !this.config.failFast) {
      // Check retry count
      const retryKey = `${planId}:${taskId}`;
      const retries = this.taskRetries.get(retryKey) ?? 0;

      if (retries < this.config.maxRetries) {
        this.taskRetries.set(retryKey, retries + 1);
        console.log(
          `[TeamManager] Retrying task ${taskId} (attempt ${retries + 1}/${this.config.maxRetries})`,
        );

        // Re-dispatch via coordinator
        const plan = await this.coordinator.getPlan(planId);
        if (plan) {
          const task = plan.tasks.find((t) => t.id === taskId);
          if (task) {
            task.status = 'pending';
            await this.redis.setex(`fleet:plan:${planId}`, 86400, JSON.stringify(plan));
            await this.coordinator.executePlan(planId);
          }
        }
        return;
      }
    }

    // Report task completion to coordinator (advances DAG)
    const updatedPlan = await this.coordinator.completeTask(
      planId,
      taskId,
      result.output,
      result.status,
      result.error,
    );

    // Check if plan is now complete
    if (updatedPlan.status === 'completed' || updatedPlan.status === 'failed') {
      await this.onPlanComplete(updatedPlan);
    }
  }

  private async onPlanComplete(plan: CoordinationPlan): Promise<void> {
    // Find the session for this plan
    let session: TeamSession | undefined;
    for (const [, s] of this.activeSessions) {
      if (s.planId === plan.id) {
        session = s;
        break;
      }
    }

    if (!session) return;

    // Update session
    session.status = plan.status === 'completed' ? 'completed' : 'failed';
    session.completedAt = new Date().toISOString();
    session.summary = await this.synthesizeResults(plan);

    // Persist
    await this.redis.setex(
      `fleet:session:${session.id}`,
      86400,
      JSON.stringify(session),
    );

    this.activeSessions.delete(session.id);

    // Publish completion event for the lead agent
    await this.redis.publish(
      `agent:${plan.leadAgentId}:coordination`,
      JSON.stringify({
        type: 'plan_complete',
        planId: plan.id,
        sessionId: session.id,
        status: plan.status,
        summary: session.summary,
        timestamp: new Date().toISOString(),
      }),
    );

    // Persist audit record to database
    try {
      await query(
        `INSERT INTO agent_audit_log (id, agent_id, action_type, action_detail, result, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          ulid(),
          plan.leadAgentId,
          'fleet_coordination',
          JSON.stringify({ planId: plan.id, title: plan.title, pattern: plan.pattern }),
          JSON.stringify({ status: plan.status, tasks: plan.tasks.length }),
        ],
      );
    } catch {
      // Non-fatal — audit log may not exist in forge DB
    }

    console.log(
      `[TeamManager] Plan "${plan.title}" ${plan.status}. ` +
      `${plan.tasks.filter((t) => t.status === 'completed').length}/${plan.tasks.length} tasks completed.`,
    );
  }

  private scheduleTaskTimeout(planId: string, taskId: string): void {
    setTimeout(async () => {
      try {
        const plan = await this.coordinator.getPlan(planId);
        if (!plan) return;

        const task = plan.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== 'running') return;

        // Task timed out
        console.log(`[TeamManager] Task ${taskId} timed out`);
        await this.coordinator.completeTask(
          planId,
          taskId,
          '',
          'failed',
          `Task timed out after ${this.config.taskTimeoutMs}ms`,
        );
      } catch (err) {
        console.error(`[TeamManager] Timeout handler error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, this.config.taskTimeoutMs);
  }
}
