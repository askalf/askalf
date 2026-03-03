/**
 * Agent Daemon — Persistent event loop for autonomous agents.
 *
 * Each daemon is a lightweight JS object running inside Forge (NOT a subprocess).
 * It ticks on a fixed interval, heartbeats, checks triggers, picks goal work,
 * and executes via the existing engine.
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';
import { getEventBus } from '../orchestration/event-bus.js';

// ============================================
// Types
// ============================================

export type DaemonStatus =
  | 'stopped'
  | 'starting'
  | 'idle'
  | 'thinking'
  | 'acting'
  | 'paused'
  | 'hibernated'
  | 'error';

export interface DaemonConfig {
  agentId: string;
  agentName: string;
  tickIntervalMs?: number;
  maxIdleMinutes?: number;
  maxSessionCostUsd?: number;
}

export interface DaemonTickContext {
  daemonId: string;
  agentId: string;
  agentName: string;
  tickNumber: number;
  status: DaemonStatus;
}

export type TickHandler = (ctx: DaemonTickContext) => Promise<void>;

// ============================================
// Agent Daemon
// ============================================

export class AgentDaemon {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;

  private status: DaemonStatus = 'stopped';
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private tickNumber = 0;
  private sessionCostUsd = 0;
  private sessionExecutions = 0;
  private consecutiveErrors = 0;
  private idleSince: Date | null = null;
  private lastError: string | null = null;
  private startedAt: Date | null = null;

  private readonly tickIntervalMs: number;
  private readonly maxIdleMinutes: number;
  private readonly maxSessionCostUsd: number;

  // External handlers injected by DaemonManager
  private onTriggerCheck: TickHandler | null = null;
  private onMessageCheck: TickHandler | null = null;
  private onGoalWork: TickHandler | null = null;

  constructor(config: DaemonConfig) {
    this.id = ulid();
    this.agentId = config.agentId;
    this.agentName = config.agentName;
    this.tickIntervalMs = config.tickIntervalMs ?? 5000;
    this.maxIdleMinutes = config.maxIdleMinutes ?? 30;
    this.maxSessionCostUsd = config.maxSessionCostUsd ?? 5.0;
  }

  // ---- Lifecycle ----

  async start(): Promise<void> {
    if (this.status !== 'stopped' && this.status !== 'error' && this.status !== 'hibernated') {
      return; // Already running or paused
    }

    this.status = 'starting';
    this.startedAt = new Date();
    this.sessionCostUsd = 0;
    this.sessionExecutions = 0;
    this.consecutiveErrors = 0;
    this.lastError = null;
    this.tickNumber = 0;

    // Persist to DB
    await query(
      `INSERT INTO forge_agent_daemons (id, agent_id, status, started_at, last_heartbeat, max_idle_minutes, max_session_cost_usd)
       VALUES ($1, $2, 'starting', NOW(), NOW(), $3, $4)
       ON CONFLICT (agent_id) DO UPDATE SET
         id = $1, status = 'starting', started_at = NOW(), last_heartbeat = NOW(),
         session_cost_usd = 0, session_executions = 0, consecutive_errors = 0,
         last_error = NULL, idle_since = NULL, current_goal_id = NULL,
         current_execution_id = NULL, max_idle_minutes = $3, max_session_cost_usd = $4,
         updated_at = NOW()`,
      [this.id, this.agentId, this.maxIdleMinutes, this.maxSessionCostUsd],
    );

    this.status = 'idle';
    this.idleSince = new Date();
    await this.updateDbStatus('idle');

    // Start tick loop
    this.tickInterval = setInterval(() => {
      void this.tick().catch((err) => {
        console.error(`[Daemon:${this.agentName}] Tick error:`, err instanceof Error ? err.message : err);
      });
    }, this.tickIntervalMs);

    console.log(`[Daemon:${this.agentName}] Started (tick=${this.tickIntervalMs}ms, maxIdle=${this.maxIdleMinutes}min, budget=$${this.maxSessionCostUsd})`);

    void getEventBus()?.emitAgent('status_changed', this.agentId, this.agentName, {
      daemon_status: 'idle',
      daemon_id: this.id,
    }).catch(() => {});
  }

  async stop(): Promise<void> {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.status = 'stopped';
    await this.updateDbStatus('stopped');
    console.log(`[Daemon:${this.agentName}] Stopped (cost=$${this.sessionCostUsd.toFixed(4)}, execs=${this.sessionExecutions})`);
  }

  async pause(): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'thinking' && this.status !== 'acting') return;
    this.status = 'paused';
    await this.updateDbStatus('paused');
    console.log(`[Daemon:${this.agentName}] Paused`);
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') return;
    this.status = 'idle';
    this.idleSince = new Date();
    this.consecutiveErrors = 0;
    await this.updateDbStatus('idle');
    console.log(`[Daemon:${this.agentName}] Resumed`);
  }

  async hibernate(): Promise<void> {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.status = 'hibernated';
    await this.updateDbStatus('hibernated');
    console.log(`[Daemon:${this.agentName}] Hibernated after ${this.maxIdleMinutes}min idle`);
  }

  // ---- Tick Loop ----

  private async tick(): Promise<void> {
    if (this.status === 'stopped' || this.status === 'paused' || this.status === 'hibernated') return;

    this.tickNumber++;

    // 1. Heartbeat
    await this.heartbeat();

    // 2. Budget check
    if (this.sessionCostUsd >= this.maxSessionCostUsd) {
      console.log(`[Daemon:${this.agentName}] Budget exhausted ($${this.sessionCostUsd.toFixed(4)}/$${this.maxSessionCostUsd})`);
      await this.stop();
      return;
    }

    // 3. Auto-hibernate check
    if (this.status === 'idle' && this.idleSince) {
      const idleMs = Date.now() - this.idleSince.getTime();
      if (idleMs > this.maxIdleMinutes * 60 * 1000) {
        await this.hibernate();
        return;
      }
    }

    // 4. Auto-pause on consecutive errors
    if (this.consecutiveErrors >= 5) {
      console.log(`[Daemon:${this.agentName}] Auto-pausing after ${this.consecutiveErrors} consecutive errors`);
      await this.pause();
      return;
    }

    // Only do work when idle
    if (this.status !== 'idle') return;

    const ctx: DaemonTickContext = {
      daemonId: this.id,
      agentId: this.agentId,
      agentName: this.agentName,
      tickNumber: this.tickNumber,
      status: this.status,
    };

    try {
      // Priority: triggers > messages > goal work
      if (this.onTriggerCheck) {
        await this.onTriggerCheck(ctx);
      }
      if (this.status === 'idle' && this.onMessageCheck) {
        await this.onMessageCheck(ctx);
      }
      if (this.status === 'idle' && this.onGoalWork) {
        await this.onGoalWork(ctx);
      }
    } catch (err) {
      this.consecutiveErrors++;
      this.lastError = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE forge_agent_daemons SET consecutive_errors = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
        [this.consecutiveErrors, this.lastError, this.id],
      );
    }
  }

  // ---- State Transitions ----

  async setThinking(): Promise<void> {
    this.status = 'thinking';
    this.idleSince = null;
    await this.updateDbStatus('thinking');
  }

  async setActing(executionId?: string): Promise<void> {
    this.status = 'acting';
    this.idleSince = null;
    if (executionId) {
      await query(
        `UPDATE forge_agent_daemons SET status = 'acting', current_execution_id = $1, updated_at = NOW() WHERE id = $2`,
        [executionId, this.id],
      );
    } else {
      await this.updateDbStatus('acting');
    }
  }

  async setIdle(): Promise<void> {
    this.status = 'idle';
    this.idleSince = new Date();
    this.consecutiveErrors = 0;
    await query(
      `UPDATE forge_agent_daemons SET status = 'idle', idle_since = NOW(), current_execution_id = NULL,
       consecutive_errors = 0, updated_at = NOW() WHERE id = $1`,
      [this.id],
    );
  }

  async setError(error: string): Promise<void> {
    this.consecutiveErrors++;
    this.lastError = error;
    if (this.consecutiveErrors >= 5) {
      this.status = 'paused';
    } else {
      this.status = 'error';
    }
    await query(
      `UPDATE forge_agent_daemons SET status = $1, consecutive_errors = $2, last_error = $3, updated_at = NOW() WHERE id = $4`,
      [this.status, this.consecutiveErrors, error, this.id],
    );
  }

  // ---- Cost Tracking ----

  recordCost(cost: number): void {
    this.sessionCostUsd += cost;
    this.sessionExecutions++;
    void query(
      `UPDATE forge_agent_daemons SET session_cost_usd = $1, session_executions = $2, updated_at = NOW() WHERE id = $3`,
      [this.sessionCostUsd, this.sessionExecutions, this.id],
    ).catch(() => {});
  }

  // ---- Handler Registration ----

  setTriggerHandler(handler: TickHandler): void {
    this.onTriggerCheck = handler;
  }

  setMessageHandler(handler: TickHandler): void {
    this.onMessageCheck = handler;
  }

  setGoalHandler(handler: TickHandler): void {
    this.onGoalWork = handler;
  }

  // ---- Getters ----

  getStatus(): DaemonStatus { return this.status; }
  getSessionCost(): number { return this.sessionCostUsd; }
  getSessionExecutions(): number { return this.sessionExecutions; }
  getTickNumber(): number { return this.tickNumber; }

  getInfo(): Record<string, unknown> {
    return {
      id: this.id,
      agentId: this.agentId,
      agentName: this.agentName,
      status: this.status,
      tickNumber: this.tickNumber,
      sessionCostUsd: this.sessionCostUsd,
      sessionExecutions: this.sessionExecutions,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
      startedAt: this.startedAt?.toISOString() ?? null,
      idleSince: this.idleSince?.toISOString() ?? null,
      maxIdleMinutes: this.maxIdleMinutes,
      maxSessionCostUsd: this.maxSessionCostUsd,
    };
  }

  // ---- Internal Helpers ----

  private async heartbeat(): Promise<void> {
    await query(
      `UPDATE forge_agent_daemons SET last_heartbeat = NOW(), updated_at = NOW() WHERE id = $1`,
      [this.id],
    ).catch(() => {});
  }

  private async updateDbStatus(status: DaemonStatus): Promise<void> {
    await query(
      `UPDATE forge_agent_daemons SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, this.id],
    ).catch(() => {});
  }
}
