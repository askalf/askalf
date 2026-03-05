/**
 * Daemon Tick Handlers — Bridge between daemon tick loop and the execution engine.
 *
 * Each handler follows: check autonomy gate → load context → execute → record cost → update state.
 * These are registered on daemon startup via DaemonManager.startDaemon().
 */

import type { DaemonTickContext, TickHandler } from './daemon.js';
import { checkAction } from './autonomy-gate.js';
import { getNextGoalAction, recordGoalExecution } from './goal-manager.js';
import { getAgentCommunication } from '../orchestration/communication.js';
import { getDaemonManager } from './daemon-manager.js';
import { runDirectCliExecution } from './worker.js';
import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';

// ============================================
// Types
// ============================================

export interface HandlerDeps {
  agentId: string;
  agentName: string;
}

interface AgentRow {
  model_id: string | null;
  system_prompt: string | null;
  max_cost_per_execution: string | null;
  max_iterations: number | null;
  owner_id: string | null;
}

// ============================================
// Shared Helpers
// ============================================

async function loadAgent(agentId: string): Promise<AgentRow | null> {
  return queryOne<AgentRow>(
    `SELECT model_id, system_prompt, max_cost_per_execution, max_iterations, owner_id
     FROM forge_agents WHERE id = $1 AND status = 'active'`,
    [agentId],
  );
}

// ============================================
// Trigger Handler
// ============================================

export function createTriggerHandler(deps: HandlerDeps): TickHandler {
  return async (ctx: DaemonTickContext) => {
    // Read wake_context from daemon metadata
    const meta = await queryOne<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM forge_agent_daemons WHERE id = $1`,
      [ctx.daemonId],
    );
    const wakeCtx = meta?.metadata?.['wake_context'] as Record<string, unknown> | undefined;
    if (!wakeCtx) return;

    // Gate check
    const gate = await checkAction(deps.agentId, 'trigger_respond', wakeCtx);
    if (!gate.allowed) {
      if (!gate.requiresApproval) {
        // Clear wake_context if action is outright denied (autonomy too low)
        await query(
          `UPDATE forge_agent_daemons SET metadata = metadata - 'wake_context', updated_at = NOW() WHERE id = $1`,
          [ctx.daemonId],
        );
      }
      return;
    }

    const daemon = getDaemonManager()?.getDaemon(deps.agentId);
    if (!daemon) return;

    const agent = await loadAgent(deps.agentId);
    if (!agent) { return; }

    // Build prompt from trigger context
    const promptTemplate = wakeCtx['prompt_template'] as string | undefined;
    const triggerType = (wakeCtx['trigger_type'] as string) || 'unknown';
    const prompt = promptTemplate
      || `[DAEMON TRIGGER: ${triggerType}] You were triggered autonomously. Context: ${JSON.stringify(wakeCtx).slice(0, 2000)}. Take appropriate action.`;

    await daemon.setThinking();

    const execId = ulid();
    // INSERT execution row BEFORE setActing to prevent FK violation on forge_cost_events
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, runtime_mode, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', 'cli', '{"source":"daemon","handler":"trigger"}'::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [execId, deps.agentId, agent.owner_id || 'system:daemon', prompt],
    );
    await daemon.setActing(execId);

    // Insert execution row BEFORE calling runDirectCliExecution so FK constraints
    // on forge_cost_events and forge_episodic_memories are satisfied at completion.
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', '{"runtime_mode":"daemon"}', NOW())`,
      [execId, deps.agentId, agent.owner_id || 'system:daemon', prompt],
    );

    try {
      await runDirectCliExecution(execId, deps.agentId, prompt, agent.owner_id || 'system:daemon', {
        modelId: agent.model_id ?? undefined,
        systemPrompt: agent.system_prompt ?? undefined,
        maxBudgetUsd: agent.max_cost_per_execution ?? undefined,
        maxTurns: Math.min(agent.max_iterations ?? 10, 10),
      });

      // Record cost
      const exec = await queryOne<{ cost: string }>(
        `SELECT cost FROM forge_executions WHERE id = $1`,
        [execId],
      );
      if (exec) daemon.recordCost(parseFloat(exec.cost || '0'));

      console.log(`[DaemonHandler:${deps.agentName}] Trigger execution ${execId} completed`);
    } catch (err) {
      await daemon.setError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Clear wake_context
    await query(
      `UPDATE forge_agent_daemons SET metadata = metadata - 'wake_context', updated_at = NOW() WHERE id = $1`,
      [ctx.daemonId],
    );
    await daemon.setIdle();
  };
}

// ============================================
// Message Handler
// ============================================

export function createMessageHandler(deps: HandlerDeps): TickHandler {
  return async (_ctx: DaemonTickContext) => {
    const comms = getAgentCommunication();
    if (!comms) return;

    const messages = await comms.getUnreadMessages(deps.agentId, 5);
    if (messages.length === 0) return;

    const gate = await checkAction(deps.agentId, 'message_respond');
    if (!gate.allowed) return;

    const daemon = getDaemonManager()?.getDaemon(deps.agentId);
    if (!daemon) return;

    const agent = await loadAgent(deps.agentId);
    if (!agent) return;

    // Build prompt from messages
    const msgSummary = messages.map(m =>
      `From ${m.from_agent_id} (${m.message_type}): ${m.content}`,
    ).join('\n\n');
    const prompt = `[DAEMON: UNREAD MESSAGES]\n\nYou have ${messages.length} unread message(s):\n\n${msgSummary}\n\nRead and respond to these messages appropriately.`;

    await daemon.setThinking();

    const execId = ulid();
    // INSERT execution row BEFORE setActing to prevent FK violation on forge_cost_events
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, runtime_mode, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', 'cli', '{"source":"daemon","handler":"message"}'::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [execId, deps.agentId, agent.owner_id || 'system:daemon', prompt],
    );
    await daemon.setActing(execId);

    // Insert execution row BEFORE calling runDirectCliExecution (same fix as trigger handler).
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', '{"runtime_mode":"daemon"}', NOW())`,
      [execId, deps.agentId, agent.owner_id || 'system:daemon', prompt],
    );

    try {
      await runDirectCliExecution(execId, deps.agentId, prompt, agent.owner_id || 'system:daemon', {
        modelId: agent.model_id ?? undefined,
        systemPrompt: agent.system_prompt ?? undefined,
        maxBudgetUsd: agent.max_cost_per_execution ?? undefined,
        maxTurns: Math.min(agent.max_iterations ?? 10, 10),
      });

      const exec = await queryOne<{ cost: string }>(
        `SELECT cost FROM forge_executions WHERE id = $1`,
        [execId],
      );
      if (exec) daemon.recordCost(parseFloat(exec.cost || '0'));

      console.log(`[DaemonHandler:${deps.agentName}] Message execution ${execId} completed (${messages.length} messages)`);
    } catch (err) {
      await daemon.setError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Mark messages read
    await comms.markRead(messages.map(m => m.id));
    await daemon.setIdle();
  };
}

// ============================================
// Goal Handler
// ============================================

export function createGoalHandler(deps: HandlerDeps): TickHandler {
  return async (ctx: DaemonTickContext) => {
    const action = await getNextGoalAction(deps.agentId);
    if (!action) return;

    const gate = await checkAction(deps.agentId, 'goal_execute', { goalId: action.goalId });
    if (!gate.allowed) return;

    const daemon = getDaemonManager()?.getDaemon(deps.agentId);
    if (!daemon) return;

    const agent = await loadAgent(deps.agentId);
    if (!agent) return;

    await daemon.setThinking();

    // Update daemon's current_goal_id
    await query(
      `UPDATE forge_agent_daemons SET current_goal_id = $1, updated_at = NOW() WHERE id = $2`,
      [action.goalId, ctx.daemonId],
    );

    const execId = ulid();
    // INSERT execution row BEFORE setActing to prevent FK violation on forge_cost_events
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, runtime_mode, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', 'cli', $5, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [execId, deps.agentId, agent.owner_id || 'system:daemon', action.prompt, JSON.stringify({ source: 'daemon', handler: 'goal', goalId: action.goalId })],
    );
    await daemon.setActing(execId);

    // Insert execution row BEFORE calling runDirectCliExecution (same fix as trigger handler).
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', '{"runtime_mode":"daemon"}', NOW())`,
      [execId, deps.agentId, agent.owner_id || 'system:daemon', action.prompt],
    );

    try {
      await runDirectCliExecution(execId, deps.agentId, action.prompt, agent.owner_id || 'system:daemon', {
        modelId: agent.model_id ?? undefined,
        systemPrompt: agent.system_prompt ?? undefined,
        maxBudgetUsd: agent.max_cost_per_execution ?? undefined,
        maxTurns: Math.min(agent.max_iterations ?? 10, 10),
      });

      const exec = await queryOne<{ cost: string; status: string }>(
        `SELECT cost, status FROM forge_executions WHERE id = $1`,
        [execId],
      );
      const cost = parseFloat(exec?.cost || '0');
      daemon.recordCost(cost);

      // Record goal execution (estimate 10% progress per execution)
      await recordGoalExecution(
        action.goalId, execId, action.actionType, 10, cost,
        `Daemon execution ${execId}`,
      );

      console.log(`[DaemonHandler:${deps.agentName}] Goal execution ${execId} for "${action.title}" completed`);
    } catch (err) {
      await daemon.setError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Clear current goal
    await query(
      `UPDATE forge_agent_daemons SET current_goal_id = NULL, updated_at = NOW() WHERE id = $1`,
      [ctx.daemonId],
    );
    await daemon.setIdle();
  };
}
