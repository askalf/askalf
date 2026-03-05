/**
 * Unified Dispatcher — Single system for all agent scheduling and dispatch.
 * Replaces: Scheduler Daemon (scheduling.ts) + Daemon Manager (daemon-manager.ts)
 * Kept separate: Autonomy Loop (CI/CD, not dispatch)
 *
 * Single 30s tick loop. Reads config from forge_agents table.
 * Kill switch: DISPATCHER_ENABLED env var + forge_dispatcher_config DB table.
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { substrateQuery } from '../database.js';
import { runDirectCliExecution } from './worker.js';

// ============================================
// Types
// ============================================

interface DispatchableAgent {
  id: string;
  name: string;
  status: string;
  model_id: string | null;
  system_prompt: string | null;
  max_cost_per_execution: string | null;
  max_iterations: number | null;
  schedule_interval_minutes: number;
  next_run_at: string | null;
  dispatch_enabled: boolean;
  dispatch_mode: string;
  is_internal: boolean;
  type: string | null;
}

interface QueuedWork {
  agentId: string;
  context: Record<string, unknown>;
  queuedAt: number;
}

export interface DispatcherStatus {
  enabled: boolean;
  running: boolean;
  tickCount: number;
  lastTickAt: string | null;
  reactiveQueueSize: number;
}

// ============================================
// Constants
// ============================================

const TICK_INTERVAL_MS = 30_000;
const MAX_CONCURRENT_PER_AGENT = 3;
const MAX_CONCURRENT_TOTAL = 8;
const STAGGER_DELAY_MS = 1_000;
const MONITOR_AGENTS = ['QA', 'Watchdog', 'Infra'];

// ============================================
// Singleton
// ============================================

let instance: UnifiedDispatcher | null = null;

export function getDispatcher(): UnifiedDispatcher | null {
  return instance;
}

export function initDispatcher(): UnifiedDispatcher {
  instance = new UnifiedDispatcher();
  return instance;
}

// ============================================
// Unified Dispatcher
// ============================================

export class UnifiedDispatcher {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private tickRunning = false;
  private tickCount = 0;
  private lastTickAt: string | null = null;
  private reactiveQueue: QueuedWork[] = [];
  private enabled = true;

  async initialize(): Promise<void> {
    // Check env kill switch
    if (process.env['DISPATCHER_ENABLED'] === 'false') {
      this.enabled = false;
      console.log('[Dispatcher] Disabled via DISPATCHER_ENABLED=false');
      return;
    }

    // Check DB kill switch
    try {
      const config = await queryOne<{ value: string }>(
        `SELECT value::text FROM forge_dispatcher_config WHERE key = 'enabled'`,
      );
      if (config && config.value === 'false') {
        this.enabled = false;
        console.log('[Dispatcher] Disabled via DB config');
        return;
      }
    } catch {
      // Table may not exist yet — default to enabled
    }

    // Clean up orphaned pending executions from previous process
    await this.markOrphanedPendingExecutions();

    // Start tick loop
    console.log(`[Dispatcher] Started (${TICK_INTERVAL_MS / 1000}s interval)`);
    setTimeout(() => void this.tick().catch(console.error), 10_000);
    this.tickInterval = setInterval(() => void this.tick().catch(console.error), TICK_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    console.log('[Dispatcher] Shut down');
  }

  /**
   * Queue reactive work for an agent (called by TriggerEngine).
   */
  queueWork(agentId: string, context: Record<string, unknown>): void {
    this.reactiveQueue.push({ agentId, context, queuedAt: Date.now() });
  }

  getStatus(): DispatcherStatus {
    return {
      enabled: this.enabled,
      running: this.tickInterval !== null,
      tickCount: this.tickCount,
      lastTickAt: this.lastTickAt,
      reactiveQueueSize: this.reactiveQueue.length,
    };
  }

  // ============================================
  // Main Tick
  // ============================================

  private async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.tickRunning) return;
    this.tickRunning = true;
    this.tickCount++;
    this.lastTickAt = new Date().toISOString();

    try {
      // Process interventions (ported from scheduling.ts)
      await this.processInterventions();

      // Process coordination tasks (pipeline/fan-out sessions)
      try {
        const { processCoordinationTasks } = await import('../routes/platform-admin/scheduling.js');
        await processCoordinationTasks();
      } catch (err) {
        console.warn(`[Dispatcher] Coordination tasks error: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Get all active internal agents with dispatch enabled
      const agents = await query<DispatchableAgent>(
        `SELECT id, name, status, model_id, system_prompt, max_cost_per_execution, max_iterations,
                schedule_interval_minutes, next_run_at, dispatch_enabled, dispatch_mode, is_internal, type
         FROM forge_agents
         WHERE status = 'active' AND dispatch_enabled = true AND is_internal = true
         ORDER BY next_run_at ASC NULLS LAST`,
      );

      if (agents.length === 0) {
        if (this.tickCount % 10 === 0) {
          console.log(`[Dispatcher] Heartbeat #${this.tickCount} — no dispatchable agents`);
        }
        return;
      }

      // Count in-flight executions
      const inFlightCounts = await query<{ agent_id: string; cnt: string }>(
        `SELECT agent_id, COUNT(*)::text as cnt FROM forge_executions WHERE status IN ('running', 'pending') GROUP BY agent_id`,
      ).catch(() => [] as { agent_id: string; cnt: string }[]);
      const inFlightMap = new Map(inFlightCounts.map((r) => [r.agent_id, parseInt(r.cnt, 10)]));

      const totalInFlight = [...inFlightMap.values()].reduce((a, b) => a + b, 0);
      if (totalInFlight >= MAX_CONCURRENT_TOTAL) {
        if (this.tickCount % 5 === 0) {
          console.log(`[Dispatcher] Heartbeat #${this.tickCount} — at concurrency limit (${totalInFlight}/${MAX_CONCURRENT_TOTAL})`);
        }
        return;
      }

      // Build fleet awareness context
      const fleetContext = await this.buildFleetContext();

      // Process reactive queue first
      await this.processReactiveQueue(inFlightMap, fleetContext);

      // Process scheduled agents
      await this.processScheduledAgents(agents, inFlightMap, fleetContext);

    } catch (err) {
      console.error('[Dispatcher] Tick error:', err);
    } finally {
      this.tickRunning = false;
    }
  }

  // ============================================
  // Reactive Queue (replaces daemon trigger/message/goal handlers)
  // ============================================

  private async processReactiveQueue(
    inFlightMap: Map<string, number>,
    fleetContext: string,
  ): Promise<void> {
    if (this.reactiveQueue.length === 0) return;

    // Drain queue (take all items, clear)
    const items = [...this.reactiveQueue];
    this.reactiveQueue = [];

    for (const item of items) {
      const inFlight = inFlightMap.get(item.agentId) ?? 0;
      if (inFlight >= MAX_CONCURRENT_PER_AGENT) continue;

      const agent = await queryOne<DispatchableAgent>(
        `SELECT id, name, status, model_id, system_prompt, max_cost_per_execution, max_iterations,
                schedule_interval_minutes, next_run_at, dispatch_enabled, dispatch_mode, is_internal, type
         FROM forge_agents WHERE id = $1 AND status = 'active'`,
        [item.agentId],
      );
      if (!agent) continue;

      const input = `[TRIGGERED — ${new Date().toISOString()}] You are ${agent.name}.

A trigger fired for you with context:
${JSON.stringify(item.context, null, 2)}

Investigate and take appropriate action based on your system prompt.${fleetContext}`;

      await this.dispatchExecution(agent, input, 'system:trigger');
      inFlightMap.set(item.agentId, inFlight + 1);
    }
  }

  // ============================================
  // Scheduled Agents (ported from scheduling.ts scheduler tick)
  // ============================================

  private async processScheduledAgents(
    agents: DispatchableAgent[],
    inFlightMap: Map<string, number>,
    fleetContext: string,
  ): Promise<void> {
    const now = new Date();
    const queuedThisTick = new Map<string, number>();
    const dispatched: { name: string; ticketId?: string }[] = [];

    for (const agent of agents) {
      if (agent.dispatch_mode !== 'scheduled' && agent.dispatch_mode !== 'both') continue;

      // Check if due
      if (agent.next_run_at && new Date(agent.next_run_at) > now) continue;

      const inFlight = (inFlightMap.get(agent.id) ?? 0) + (queuedThisTick.get(agent.id) ?? 0);
      const isMonitor = MONITOR_AGENTS.includes(agent.name);

      // Monitor agents: single instance
      if (isMonitor && inFlight >= 1) {
        await this.advanceSchedule(agent);
        continue;
      }

      // Non-monitor: concurrency limit
      if (inFlight >= MAX_CONCURRENT_PER_AGENT) {
        await this.advanceSchedule(agent);
        continue;
      }

      // Load assigned tickets
      const assignedTickets = await substrateQuery<{ id: string; title: string; priority: string; description: string }>(
        `SELECT id, title, priority, substring(description from 1 for 1000) as description
         FROM agent_tickets
         WHERE assigned_to = $1 AND status IN ('open', 'in_progress')
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at
         LIMIT 5`,
        [agent.name],
      ).catch(() => [] as { id: string; title: string; priority: string; description: string }[]);

      // Ticket-gate: skip non-monitor agents with no tickets
      if (assignedTickets.length === 0 && !isMonitor) {
        await this.advanceSchedule(agent);
        console.log(`[Dispatcher] Skipping ${agent.name} — no tickets`);
        continue;
      }

      // Find tickets already being worked
      const inFlightTickets = await query<{ ticket_id: string }>(
        `SELECT metadata->>'ticket_id' as ticket_id FROM forge_executions
         WHERE agent_id = $1 AND status IN ('running', 'pending') AND metadata->>'ticket_id' IS NOT NULL`,
        [agent.id],
      ).catch(() => [] as { ticket_id: string }[]);
      const inFlightTicketSet = new Set(inFlightTickets.map(r => r.ticket_id));

      if (isMonitor) {
        // Monitor: patrol prompt
        const ownTicketBlock = assignedTickets.length > 0
          ? `\n\nYOU ALSO HAVE ${assignedTickets.length} TICKET(S) ASSIGNED TO YOU:\n${assignedTickets.map((t, i) => `${i + 1}. [${t.priority.toUpperCase()}] ${t.id}: ${t.title}\n   ${t.description}`).join('\n')}\n\nWork these first before doing your patrol.`
          : '';

        const input = `[PATROL CYCLE — ${new Date().toISOString()}] You are ${agent.name}.

You are a MONITOR agent. Your job is to patrol the system, detect issues, and create tickets/findings for other agents to act on.${ownTicketBlock}

PATROL PROTOCOL:
1. CHECK: Run your standard checks as defined in your system prompt.
2. FINDINGS: Create findings (finding_ops) for any issues detected.
3. TICKETS: For actionable issues, create tickets assigned to the correct agent:
   - Security issues → Security
   - Infrastructure/container issues → Infra
   - Code bugs → Backend Dev
   - UI/dashboard issues → Frontend Dev
4. DEDUP: Before creating any ticket, check for existing open tickets with similar title.
5. SUMMARY: Create one summary finding with what you checked and found.

RULES:
- Do NOT fix issues yourself — create tickets for the right agent.
- Do NOT create duplicate tickets. Check existing tickets first.
- BEFORE starting: search memory (memory_search) for your last patrol results.
- AFTER completing: store what you found (memory_store).

PATROL. Detect. Report. Stop.${fleetContext}`;

        await this.dispatchExecution(agent, input, 'system:dispatcher');
        queuedThisTick.set(agent.id, (queuedThisTick.get(agent.id) ?? 0) + 1);
        dispatched.push({ name: agent.name });
      } else {
        // Worker: one execution per unworked ticket
        const unworkedTickets = assignedTickets.filter(t => !inFlightTicketSet.has(t.id));
        if (unworkedTickets.length === 0) {
          await this.advanceSchedule(agent);
          continue;
        }

        const currentInFlight = (inFlightMap.get(agent.id) ?? 0) + (queuedThisTick.get(agent.id) ?? 0);
        const slotsAvailable = MAX_CONCURRENT_PER_AGENT - currentInFlight;
        const ticketsToDispatch = unworkedTickets.slice(0, slotsAvailable);

        for (const ticket of ticketsToDispatch) {
          const otherTickets = assignedTickets.filter(t => t.id !== ticket.id);
          const otherBlock = otherTickets.length > 0
            ? `\n\nOTHER TICKETS IN YOUR QUEUE (do NOT work these):\n${otherTickets.map(t => `- [${t.priority.toUpperCase()}] ${t.id}: ${t.title}`).join('\n')}`
            : '';

          const input = `[WORK CYCLE — ${new Date().toISOString()}] You are ${agent.name}.

YOUR TICKET:
[${ticket.priority.toUpperCase()}] ${ticket.id}: ${ticket.title}
${ticket.description}${otherBlock}

TICKET LIFECYCLE:
1. CLAIM: Update ticket status to in_progress (ticket_ops action=update).
2. NOTE: Add a progress note describing what you're about to do.
3. WORK: Do the actual work — write code, fix bugs, run commands.
4. COMMIT: Stage and commit your changes.
5. NOTE: Add a completion note with what was done.
6. RESOLVE: Update ticket status to resolved.

RULES:
- FOCUS on this ONE ticket only.
- BEFORE starting: search memory (memory_search) for context.
- AFTER completing: store what you learned (memory_store).
- EVERY execution must leave at least one progress note.

FOCUS. Work the ticket. Ship code. Stop.${fleetContext}`;

          await this.dispatchExecution(agent, input, 'system:dispatcher', { ticket_id: ticket.id });
          queuedThisTick.set(agent.id, (queuedThisTick.get(agent.id) ?? 0) + 1);
          dispatched.push({ name: agent.name, ticketId: ticket.id });

          // Stagger
          if (ticketsToDispatch.indexOf(ticket) < ticketsToDispatch.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, STAGGER_DELAY_MS));
          }
        }
      }

      await this.advanceSchedule(agent);
    }

    if (dispatched.length > 0) {
      console.log(`[Dispatcher] Dispatched ${dispatched.length}: ${dispatched.map(d => d.ticketId ? `${d.name}[${d.ticketId}]` : d.name).join(', ')}`);
    } else if (this.tickCount % 10 === 0) {
      console.log(`[Dispatcher] Heartbeat #${this.tickCount} — no work to dispatch`);
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private async dispatchExecution(
    agent: DispatchableAgent,
    input: string,
    ownerId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const execId = ulid();

    await queryOne(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW()) RETURNING id`,
      [execId, agent.id, ownerId, input, JSON.stringify(metadata)],
    );

    void runDirectCliExecution(execId, agent.id, input, ownerId, {
      modelId: agent.model_id ?? undefined,
      systemPrompt: agent.system_prompt ?? undefined,
      maxBudgetUsd: agent.max_cost_per_execution ?? undefined,
      maxTurns: agent.max_iterations ?? undefined,
      scheduleIntervalMinutes: agent.schedule_interval_minutes,
    }).catch((err) => {
      console.error(`[Dispatcher] Execution failed for ${agent.name}:`, err);
    });
  }

  private async advanceSchedule(agent: DispatchableAgent): Promise<void> {
    await query(
      `UPDATE forge_agents SET next_run_at = NOW() + ($1 || ' minutes')::INTERVAL, last_run_at = NOW() WHERE id = $2`,
      [String(agent.schedule_interval_minutes), agent.id],
    );
  }

  private async buildFleetContext(): Promise<string> {
    const [runningExecs, recentCompletions] = await Promise.all([
      query<{ agent_name: string }>(
        `SELECT a.name as agent_name FROM forge_executions e JOIN forge_agents a ON e.agent_id = a.id
         WHERE e.status IN ('running', 'pending') ORDER BY e.started_at DESC LIMIT 10`,
      ).catch(() => [] as { agent_name: string }[]),
      query<{ agent_name: string; input: string }>(
        `SELECT a.name as agent_name, substring(e.input from 1 for 100) as input
         FROM forge_executions e JOIN forge_agents a ON e.agent_id = a.id
         WHERE e.status = 'completed' AND e.completed_at > NOW() - INTERVAL '2 hours'
         ORDER BY e.completed_at DESC LIMIT 8`,
      ).catch(() => [] as { agent_name: string; input: string }[]),
    ]);

    return [
      '\n\nFLEET AWARENESS (avoid duplicate work):',
      runningExecs.length > 0
        ? `Currently running: ${runningExecs.map((e) => e.agent_name).join(', ')}`
        : 'No agents currently running.',
      recentCompletions.length > 0
        ? `Recent completions (last 2h): ${recentCompletions.map((e) => `${e.agent_name}: ${e.input}`).join(' | ')}`
        : '',
    ].filter(Boolean).join('\n');
  }

  private async markOrphanedPendingExecutions(): Promise<void> {
    try {
      const orphaned = await query<{ id: string }>(
        `UPDATE forge_executions
         SET status = 'failed', error = 'Execution orphaned: forge process restarted', completed_at = NOW()
         WHERE status = 'pending'
         RETURNING id`,
      );
      if (orphaned.length > 0) {
        console.log(`[Dispatcher] Startup: marked ${orphaned.length} orphaned pending execution(s) as failed`);
      }
    } catch (err) {
      console.error('[Dispatcher] Startup orphan sweep failed:', err);
    }
  }

  // ============================================
  // Intervention Auto-Processing (ported from scheduling.ts)
  // ============================================

  private async processInterventions(): Promise<void> {
    // Only run every 2nd tick (60s effective interval)
    if (this.tickCount % 2 !== 0) return;

    try {
      const pending = await substrateQuery<{
        id: string; agent_id: string; agent_name: string; type: string;
        title: string; description: string; proposed_action: string;
        risk_level: string; created_at: string;
      }>(
        `SELECT id, agent_id, agent_name, type, title, description, proposed_action, risk_level, created_at
         FROM agent_interventions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20`,
      );

      if (pending.length === 0) return;

      for (const intervention of pending) {
        const ageMinutes = (Date.now() - new Date(intervention.created_at).getTime()) / 60_000;

        // Auto-approve low-risk interventions older than 10 min
        if (intervention.risk_level === 'low' && ageMinutes > 10) {
          await substrateQuery(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved (low risk, 10min timeout)', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
            [intervention.id],
          );
          continue;
        }

        // Auto-approve resource requests older than 15 min
        if (intervention.type === 'resource_request' && ageMinutes > 15) {
          await substrateQuery(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved (resource request, 15min timeout)', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
            [intervention.id],
          );
          continue;
        }

        // Auto-approve confirmation/info interventions older than 30 min
        if ((intervention.type === 'confirmation' || intervention.type === 'info') && ageMinutes > 30) {
          await substrateQuery(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved (timeout 30min)', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
            [intervention.id],
          );
          continue;
        }

        // Escalation/error interventions older than 60 min — create a ticket for Infra
        if ((intervention.type === 'escalation' || intervention.type === 'error') && ageMinutes > 60) {
          try {
            await substrateQuery(
              `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, is_agent_ticket, source, metadata)
               VALUES ($1, $2, $3, 'open', 'urgent', 'escalation', 'system', 'Infra', true, 'agent', $4)
               ON CONFLICT DO NOTHING`,
              [
                'INT-' + intervention.id.substring(0, 20),
                `[ESCALATION] ${intervention.title}`,
                `Agent ${intervention.agent_name} requested intervention: ${intervention.description || intervention.title}\n\nProposed action: ${intervention.proposed_action || 'None'}`,
                JSON.stringify({ intervention_id: intervention.id, auto_escalated: true }),
              ],
            );
            await substrateQuery(
              `UPDATE agent_interventions SET status = 'resolved', human_response = 'Auto-escalated to Infra ticket after 60min', responded_by = 'system:escalation', responded_at = NOW() WHERE id = $1`,
              [intervention.id],
            );
          } catch { /* non-fatal */ }
          continue;
        }
      }
    } catch (err) {
      console.error('[Dispatcher] Intervention processing error:', err);
    }
  }
}
