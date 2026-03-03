/**
 * Daemon Manager — Manages all daemon instances.
 * Handles start/stop/pause/resume, health checks, crash recovery on startup.
 */

import { query } from '../database.js';
import { AgentDaemon, type DaemonConfig, type DaemonStatus } from './daemon.js';
import { createTriggerHandler, createMessageHandler, createGoalHandler } from './daemon-handlers.js';

// ============================================
// Singleton
// ============================================

let instance: DaemonManager | null = null;

export function getDaemonManager(): DaemonManager | null {
  return instance;
}

export function initDaemonManager(): DaemonManager {
  instance = new DaemonManager();
  return instance;
}

// ============================================
// DaemonManager
// ============================================

export class DaemonManager {
  private daemons: Map<string, AgentDaemon> = new Map(); // agentId → daemon
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  // ---- Lifecycle ----

  /**
   * On Forge startup: restart daemons that were running before shutdown.
   */
  async initialize(): Promise<void> {
    // Find agents that had running daemons before shutdown
    const runningDaemons = await query<{
      agent_id: string;
      max_idle_minutes: number;
      max_session_cost_usd: string;
    }>(
      `SELECT d.agent_id, d.max_idle_minutes, d.max_session_cost_usd
       FROM forge_agent_daemons d
       JOIN forge_agents a ON a.id = d.agent_id
       WHERE d.status NOT IN ('stopped', 'hibernated')
         AND a.status = 'active'
         AND a.runtime_mode = 'daemon'`,
    );

    if (runningDaemons.length > 0) {
      console.log(`[DaemonManager] Recovering ${runningDaemons.length} daemon(s) from previous session`);
      for (const row of runningDaemons) {
        try {
          await this.startDaemon(row.agent_id);
        } catch (err) {
          console.warn(`[DaemonManager] Failed to recover daemon for ${row.agent_id}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    // Auto-start daemons for agents with runtime_mode = 'daemon' that aren't already running
    const daemonAgents = await query<{ id: string }>(
      `SELECT id FROM forge_agents WHERE runtime_mode = 'daemon' AND status = 'active'`,
    );
    for (const a of daemonAgents) {
      if (!this.daemons.has(a.id)) {
        try {
          await this.startDaemon(a.id);
        } catch (err) {
          console.warn(`[DaemonManager] Failed to auto-start daemon for ${a.id}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    // Start health check loop (30s)
    this.healthCheckInterval = setInterval(() => {
      void this.healthCheck().catch(() => {});
    }, 30_000);

    console.log(`[DaemonManager] Initialized (${this.daemons.size} active daemons)`);
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    const stopPromises: Promise<void>[] = [];
    for (const daemon of this.daemons.values()) {
      stopPromises.push(daemon.stop());
    }
    await Promise.allSettled(stopPromises);
    this.daemons.clear();
    console.log('[DaemonManager] All daemons stopped');
  }

  // ---- Agent Daemon Operations ----

  async startDaemon(agentId: string): Promise<AgentDaemon> {
    // Check if already running
    const existing = this.daemons.get(agentId);
    if (existing && existing.getStatus() !== 'stopped' && existing.getStatus() !== 'error' && existing.getStatus() !== 'hibernated') {
      return existing;
    }

    // Load agent config
    const agent = await query<{
      id: string; name: string; runtime_mode: string;
      max_cost_per_execution: string; autonomy_level: number;
    }>(
      `SELECT id, name, runtime_mode, max_cost_per_execution, autonomy_level FROM forge_agents WHERE id = $1`,
      [agentId],
    );
    if (agent.length === 0) throw new Error(`Agent not found: ${agentId}`);
    const a = agent[0]!;

    // Load daemon config from existing DB record or use defaults
    const existingDaemon = await query<{
      max_idle_minutes: number;
      max_session_cost_usd: string;
    }>(
      `SELECT max_idle_minutes, max_session_cost_usd FROM forge_agent_daemons WHERE agent_id = $1`,
      [agentId],
    );

    const config: DaemonConfig = {
      agentId: a.id,
      agentName: a.name,
      tickIntervalMs: 5000,
      maxIdleMinutes: existingDaemon[0]?.max_idle_minutes ?? 30,
      maxSessionCostUsd: existingDaemon[0]?.max_session_cost_usd
        ? parseFloat(existingDaemon[0].max_session_cost_usd)
        : 5.0,
    };

    const daemon = new AgentDaemon(config);
    const deps = { agentId: a.id, agentName: a.name };
    daemon.setTriggerHandler(createTriggerHandler(deps));
    daemon.setMessageHandler(createMessageHandler(deps));
    daemon.setGoalHandler(createGoalHandler(deps));
    this.daemons.set(agentId, daemon);

    await daemon.start();

    // Mark agent as daemon mode if not already
    if (a.runtime_mode !== 'daemon') {
      await query(`UPDATE forge_agents SET runtime_mode = 'daemon' WHERE id = $1`, [agentId]);
    }

    return daemon;
  }

  async stopDaemon(agentId: string): Promise<void> {
    const daemon = this.daemons.get(agentId);
    if (!daemon) {
      // Update DB in case it's stale
      await query(
        `UPDATE forge_agent_daemons SET status = 'stopped', updated_at = NOW() WHERE agent_id = $1`,
        [agentId],
      );
      return;
    }
    await daemon.stop();
    this.daemons.delete(agentId);
  }

  async pauseDaemon(agentId: string): Promise<void> {
    const daemon = this.daemons.get(agentId);
    if (!daemon) throw new Error(`No active daemon for agent: ${agentId}`);
    await daemon.pause();
  }

  async resumeDaemon(agentId: string): Promise<void> {
    const daemon = this.daemons.get(agentId);
    if (!daemon) throw new Error(`No active daemon for agent: ${agentId}`);
    await daemon.resume();
  }

  /**
   * Wake a daemon from hibernation or idle, typically called by TriggerEngine.
   */
  async wakeDaemon(agentId: string, context?: Record<string, unknown>): Promise<void> {
    let daemon = this.daemons.get(agentId);
    if (!daemon || daemon.getStatus() === 'stopped' || daemon.getStatus() === 'hibernated') {
      daemon = await this.startDaemon(agentId);
    }
    if (daemon.getStatus() === 'paused') {
      await daemon.resume();
    }
    if (context) {
      await query(
        `UPDATE forge_agent_daemons SET metadata = metadata || $1, updated_at = NOW() WHERE agent_id = $2`,
        [JSON.stringify({ wake_context: context }), agentId],
      );
    }
  }

  // ---- Query ----

  getDaemon(agentId: string): AgentDaemon | undefined {
    return this.daemons.get(agentId);
  }

  getAllDaemons(): AgentDaemon[] {
    return Array.from(this.daemons.values());
  }

  getActiveDaemonCount(): number {
    let count = 0;
    for (const d of this.daemons.values()) {
      if (d.getStatus() !== 'stopped') count++;
    }
    return count;
  }

  // ---- Health Check ----

  private async healthCheck(): Promise<void> {
    // Find daemons that haven't heartbeated in 60s — they may have crashed
    const stale = await query<{ agent_id: string; status: string }>(
      `SELECT agent_id, status FROM forge_agent_daemons
       WHERE status NOT IN ('stopped', 'hibernated', 'paused')
         AND last_heartbeat < NOW() - INTERVAL '60 seconds'`,
    );

    for (const row of stale) {
      const daemon = this.daemons.get(row.agent_id);
      if (!daemon) {
        // Daemon is in DB but not in memory — mark as stopped
        await query(
          `UPDATE forge_agent_daemons SET status = 'stopped', last_error = 'Lost in-memory daemon reference', updated_at = NOW() WHERE agent_id = $1`,
          [row.agent_id],
        );
        continue;
      }
      // If daemon object exists but isn't ticking, it crashed — restart
      console.warn(`[DaemonManager] Daemon for ${row.agent_id} appears stale (status=${row.status}), restarting`);
      try {
        await daemon.stop();
        this.daemons.delete(row.agent_id);
        await this.startDaemon(row.agent_id);
      } catch (err) {
        console.error(`[DaemonManager] Failed to restart stale daemon ${row.agent_id}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}
