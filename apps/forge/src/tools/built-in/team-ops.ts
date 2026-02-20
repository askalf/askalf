/**
 * Built-in Tool: Team Ops (Level 15 — Vibe Completeness)
 * Fleet team management: start coordinated teams, monitor sessions,
 * list sessions, cancel sessions, and synthesize results.
 */

import { Redis } from 'ioredis';
import { query } from '../../database.js';
import { loadConfig } from '../../config.js';
import { TeamManager, type TeamSession } from '../../runtime/team-manager.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Lazy TeamManager singleton
// ============================================

let manager: TeamManager | null = null;

function getTeamManager(): TeamManager {
  if (!manager) {
    const config = loadConfig();
    const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    manager = new TeamManager(redis);
  }
  return manager;
}

// ============================================
// Types
// ============================================

export interface TeamOpsInput {
  action: 'start' | 'status' | 'list' | 'cancel' | 'synthesize';
  // For start:
  title?: string;
  pattern?: 'pipeline' | 'fan-out' | 'consensus';
  tasks?: Array<{
    title: string;
    description: string;
    agent_name: string;
    dependencies?: string[];
  }>;
  // For status / cancel:
  session_id?: string;
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function teamOps(input: TeamOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'start':
        return await handleStart(input, startTime);
      case 'status':
        return await handleStatus(input, startTime);
      case 'list':
        return await handleList(startTime);
      case 'cancel':
        return await handleCancel(input, startTime);
      case 'synthesize':
        return await handleSynthesize(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: start, status, list, cancel, synthesize`,
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
// Start Action
// ============================================

async function handleStart(input: TeamOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }
  if (!input.title) {
    return { output: null, error: 'title is required for start', durationMs: 0 };
  }
  if (!input.tasks || input.tasks.length === 0) {
    return { output: null, error: 'tasks array is required for start (at least 1 task)', durationMs: 0 };
  }

  // Guard: autonomy >= 3
  const agents = await query<{ autonomy_level: number; name: string }>(
    `SELECT autonomy_level, name FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 3) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 3 to start teams.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const agentName = agents[0]?.name ?? agentId;
  const tm = getTeamManager();

  const session = await tm.startTeam(
    agentId,
    agentName,
    input.title,
    input.pattern ?? 'pipeline',
    input.tasks.map((t) => ({
      title: t.title,
      description: t.description,
      agentName: t.agent_name,
      dependencies: t.dependencies,
    })),
  );

  return {
    output: {
      session_id: session.id,
      plan_id: session.planId,
      lead_agent_id: session.leadAgentId,
      status: session.status,
      task_count: input.tasks.length,
      pattern: input.pattern ?? 'pipeline',
      message: `Team session started: "${input.title}" with ${input.tasks.length} tasks (${input.pattern ?? 'pipeline'}).`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Status Action
// ============================================

async function handleStatus(input: TeamOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for status', durationMs: 0 };
  }

  const tm = getTeamManager();
  const session = await tm.getSession(input.session_id);

  if (!session) {
    return { output: null, error: `Session not found: ${input.session_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  return {
    output: {
      session_id: session.id,
      plan_id: session.planId,
      lead_agent_id: session.leadAgentId,
      status: session.status,
      started_at: session.startedAt,
      completed_at: session.completedAt ?? null,
      plan: session.plan ? {
        title: session.plan.title,
        pattern: session.plan.pattern,
        status: session.plan.status,
        tasks: session.plan.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          assigned_agent: t.assignedAgent,
        })),
      } : null,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// List Action
// ============================================

async function handleList(startTime: number): Promise<ToolResult> {
  const tm = getTeamManager();
  const sessions = await tm.listSessions();

  return {
    output: {
      sessions: sessions.map((s) => ({
        session_id: s.id,
        plan_id: s.planId,
        lead_agent_id: s.leadAgentId,
        status: s.status,
        started_at: s.startedAt,
        completed_at: s.completedAt ?? null,
      })),
      total: sessions.length,
      active: sessions.filter((s) => s.status === 'active').length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Cancel Action
// ============================================

async function handleCancel(input: TeamOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for cancel', durationMs: 0 };
  }

  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  // Guard: autonomy >= 3
  const agents = await query<{ autonomy_level: number }>(
    `SELECT autonomy_level FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 3) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 3 to cancel teams.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const tm = getTeamManager();
  await tm.cancelSession(input.session_id);

  return {
    output: {
      session_id: input.session_id,
      status: 'cancelled',
      message: `Team session ${input.session_id} cancelled.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Synthesize Action
// ============================================

async function handleSynthesize(input: TeamOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for synthesize', durationMs: 0 };
  }

  const tm = getTeamManager();
  const session = await tm.getSession(input.session_id);

  if (!session) {
    return { output: null, error: `Session not found: ${input.session_id}`, durationMs: Math.round(performance.now() - startTime) };
  }
  if (!session.plan) {
    return { output: null, error: `No plan found for session: ${input.session_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  const summary = await tm.synthesizeResults(session.plan);

  return {
    output: {
      session_id: input.session_id,
      summary,
      message: 'Results synthesized successfully.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
