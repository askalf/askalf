/**
 * Trigger Engine — Evaluates triggers against events, cron expressions, and webhooks.
 * Subscribes to ForgeEventBus and fires daemon wake-ups when conditions are met.
 */

import { query } from '../database.js';
import { getEventBus, type ForgeEvent } from '../orchestration/event-bus.js';
import { getDaemonManager } from './daemon-manager.js';
import { ulid } from 'ulid';

// ============================================
// Types
// ============================================

export interface TriggerRecord {
  id: string;
  agent_id: string;
  trigger_type: string;
  config: TriggerConfig;
  prompt_template: string | null;
  cooldown_minutes: number;
  max_fires_per_hour: number;
  fires_this_hour: number;
  hour_reset_at: string;
  last_fired_at: string | null;
  enabled: boolean;
  priority: number;
}

export interface TriggerConfig {
  // event trigger
  event_type?: string;       // 'execution', 'coordination', 'agent', 'handoff'
  event_name?: string;       // 'completed', 'failed', etc.
  agent_filter?: string;     // specific agent_id to watch

  // schedule trigger
  cron?: string;             // cron expression (e.g., '*/5 * * * *')

  // webhook trigger
  secret?: string;           // webhook secret for verification

  // state_change trigger
  query_template?: string;   // SQL query that returns a boolean
  threshold?: number;

  // message trigger
  from_agent_id?: string;    // specific sender

  // goal_progress trigger
  goal_id?: string;
  progress_threshold?: number;

  // general
  [key: string]: unknown;
}

// ============================================
// Singleton
// ============================================

let instance: TriggerEngine | null = null;

export function getTriggerEngine(): TriggerEngine | null {
  return instance;
}

export function initTriggerEngine(): TriggerEngine {
  instance = new TriggerEngine();
  return instance;
}

// ============================================
// TriggerEngine
// ============================================

export class TriggerEngine {
  private cronInterval: ReturnType<typeof setInterval> | null = null;
  private eventUnsubscribe: (() => void) | null = null;

  async start(): Promise<void> {
    // Subscribe to all ForgeEventBus events
    const bus = getEventBus();
    if (bus) {
      const handler = (event: ForgeEvent) => {
        void this.evaluateEventTriggers(event).catch((err) => {
          console.warn('[TriggerEngine] Event evaluation error:', err instanceof Error ? err.message : err);
        });
      };
      bus.on('*', handler);
      this.eventUnsubscribe = () => bus.off('*', handler);
    }

    // Start cron evaluation loop (30s)
    this.cronInterval = setInterval(() => {
      void this.evaluateScheduleTriggers().catch((err) => {
        console.warn('[TriggerEngine] Schedule evaluation error:', err instanceof Error ? err.message : err);
      });
    }, 30_000);

    console.log('[TriggerEngine] Started (event subscription + 30s cron loop)');
  }

  async stop(): Promise<void> {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
    }
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }
    console.log('[TriggerEngine] Stopped');
  }

  // ---- Event Triggers ----

  private async evaluateEventTriggers(event: ForgeEvent): Promise<void> {
    const triggers = await query<TriggerRecord>(
      `SELECT * FROM forge_agent_triggers WHERE trigger_type = 'event' AND enabled = true`,
    );

    for (const trigger of triggers) {
      if (!this.matchesEventTrigger(trigger, event)) continue;
      if (!this.canFire(trigger)) continue;

      await this.fire(trigger, { event });
    }
  }

  private matchesEventTrigger(trigger: TriggerRecord, event: ForgeEvent): boolean {
    const cfg = trigger.config;

    // Match event type
    if (cfg.event_type && event.type !== cfg.event_type) return false;

    // Match event name
    if (cfg.event_name && event.event !== cfg.event_name) return false;

    // Match agent filter
    if (cfg.agent_filter) {
      const eventAgentId = 'agentId' in event ? (event as unknown as Record<string, unknown>)['agentId'] : null;
      if (eventAgentId !== cfg.agent_filter) return false;
    }

    return true;
  }

  // ---- Schedule Triggers ----

  private async evaluateScheduleTriggers(): Promise<void> {
    const triggers = await query<TriggerRecord>(
      `SELECT * FROM forge_agent_triggers WHERE trigger_type = 'schedule' AND enabled = true`,
    );

    const now = new Date();

    for (const trigger of triggers) {
      if (!trigger.config.cron) continue;
      if (!this.canFire(trigger)) continue;

      // Simple cron matching: check if we're within the 30s evaluation window
      if (this.cronMatches(trigger.config.cron, now)) {
        await this.fire(trigger, { scheduled: true, cron: trigger.config.cron });
      }
    }
  }

  /**
   * Simple cron matcher for common patterns.
   * Supports: minute, hour, dom, month, dow fields.
   * Returns true if current time matches the cron expression within the evaluation window.
   */
  private cronMatches(cron: string, now: Date): boolean {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const [minSpec, hourSpec, _dom, _month, _dow] = parts;
    const minute = now.getMinutes();
    const hour = now.getHours();
    const second = now.getSeconds();

    // Only evaluate at the start of matching minutes (first 30s window)
    if (second >= 30) return false;

    // Check minute field
    if (!this.fieldMatches(minSpec!, minute)) return false;
    // Check hour field
    if (!this.fieldMatches(hourSpec!, hour)) return false;

    return true;
  }

  private fieldMatches(spec: string, value: number): boolean {
    if (spec === '*') return true;

    // */N pattern
    const stepMatch = spec.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      return value % parseInt(stepMatch[1]!, 10) === 0;
    }

    // Exact value
    const num = parseInt(spec, 10);
    if (!isNaN(num)) return value === num;

    // Comma-separated values
    if (spec.includes(',')) {
      return spec.split(',').some((v) => parseInt(v, 10) === value);
    }

    return false;
  }

  // ---- Webhook Triggers ----

  async evaluateWebhookTrigger(triggerId: string, payload: Record<string, unknown>): Promise<boolean> {
    const triggers = await query<TriggerRecord>(
      `SELECT * FROM forge_agent_triggers WHERE id = $1 AND trigger_type = 'webhook' AND enabled = true`,
      [triggerId],
    );

    if (triggers.length === 0) return false;
    const trigger = triggers[0]!;
    if (!this.canFire(trigger)) return false;

    await this.fire(trigger, { webhook: true, payload });
    return true;
  }

  // ---- State Change Triggers ----

  async evaluateStateChangeTriggers(): Promise<void> {
    const triggers = await query<TriggerRecord>(
      `SELECT * FROM forge_agent_triggers WHERE trigger_type = 'state_change' AND enabled = true`,
    );

    for (const trigger of triggers) {
      if (!trigger.config.query_template) continue;
      if (!this.canFire(trigger)) continue;

      try {
        const result = await query<{ result: boolean }>(trigger.config.query_template);
        if (result.length > 0 && result[0]!.result) {
          await this.fire(trigger, { state_change: true });
        }
      } catch (err) {
        console.warn(`[TriggerEngine] State query failed for trigger ${trigger.id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // ---- Goal Progress Triggers ----

  async evaluateGoalProgressTriggers(goalId: string, progress: number): Promise<void> {
    const triggers = await query<TriggerRecord>(
      `SELECT * FROM forge_agent_triggers
       WHERE trigger_type = 'goal_progress' AND enabled = true
         AND (config->>'goal_id' = $1 OR config->>'goal_id' IS NULL)`,
      [goalId],
    );

    for (const trigger of triggers) {
      const threshold = trigger.config.progress_threshold ?? 100;
      if (progress < threshold) continue;
      if (!this.canFire(trigger)) continue;

      await this.fire(trigger, { goal_id: goalId, progress });
    }
  }

  // ---- Rate Limiting ----

  private canFire(trigger: TriggerRecord): boolean {
    // Cooldown check
    if (trigger.last_fired_at) {
      const lastFired = new Date(trigger.last_fired_at).getTime();
      const cooldownMs = trigger.cooldown_minutes * 60 * 1000;
      if (Date.now() - lastFired < cooldownMs) return false;
    }

    // Hourly rate check
    const hourReset = new Date(trigger.hour_reset_at).getTime();
    if (Date.now() < hourReset && trigger.fires_this_hour >= trigger.max_fires_per_hour) {
      return false;
    }

    return true;
  }

  // ---- Fire ----

  private async fire(trigger: TriggerRecord, context: Record<string, unknown>): Promise<void> {
    const manager = getDaemonManager();
    if (!manager) return;

    // Update fire counts
    const hourReset = new Date(trigger.hour_reset_at).getTime();
    const resetHour = Date.now() >= hourReset;

    await query(
      `UPDATE forge_agent_triggers SET
         last_fired_at = NOW(),
         fires_this_hour = CASE WHEN $1 THEN 1 ELSE fires_this_hour + 1 END,
         hour_reset_at = CASE WHEN $1 THEN NOW() + INTERVAL '1 hour' ELSE hour_reset_at END
       WHERE id = $2`,
      [resetHour, trigger.id],
    );

    // Wake the daemon
    const triggerContext = {
      trigger_id: trigger.id,
      trigger_type: trigger.trigger_type,
      prompt_template: trigger.prompt_template,
      ...context,
    };

    try {
      await manager.wakeDaemon(trigger.agent_id, triggerContext);
      console.log(`[TriggerEngine] Fired trigger ${trigger.id} (${trigger.trigger_type}) → agent ${trigger.agent_id}`);
    } catch (err) {
      console.warn(`[TriggerEngine] Failed to wake daemon for trigger ${trigger.id}:`, err instanceof Error ? err.message : err);
    }
  }
}
