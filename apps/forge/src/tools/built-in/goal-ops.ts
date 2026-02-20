/**
 * Built-in Tool: Goal Ops (Level 11 — Vibe Autonomy)
 * Autonomous goal management: propose improvement goals from execution history,
 * list/filter goals, self-approve at high autonomy, and mark goals complete.
 */

import { query } from '../../database.js';
import { proposeGoals, approveGoal, rejectGoal, getAgentGoals } from '../../orchestration/goal-proposer.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface GoalOpsInput {
  action: 'propose' | 'list' | 'approve' | 'reject' | 'complete';
  // For list:
  status?: string;
  // For approve / complete:
  goal_id?: string;
  // For complete:
  result_summary?: string;
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function goalOps(input: GoalOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'propose':
        return await handlePropose(input, startTime);
      case 'list':
        return await handleList(input, startTime);
      case 'approve':
        return await handleApprove(input, startTime);
      case 'reject':
        return await handleReject(input, startTime);
      case 'complete':
        return await handleComplete(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: propose, list, approve, reject, complete`,
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
// Propose Action
// ============================================

async function handlePropose(input: GoalOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }

  const goals = await proposeGoals(agentId);

  if (goals.length === 0) {
    return {
      output: {
        proposed: false,
        message: 'No goals proposed — either not enough execution history (need >= 3 recent), too many pending goals (max 5), or performance is already excellent (>90% success, no corrections).',
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  return {
    output: {
      proposed: true,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        rationale: g.rationale,
        priority: g.priority,
        status: g.status,
      })),
      count: goals.length,
      message: `${goals.length} goal(s) proposed. Use approve to self-approve (autonomy >= 4) or wait for human approval.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// List Action
// ============================================

async function handleList(input: GoalOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  const goals = await getAgentGoals(agentId, input.status);

  const byStatus: Record<string, number> = {};
  for (const g of goals) {
    byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
  }

  return {
    output: {
      agent_id: agentId,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        rationale: g.rationale,
        priority: g.priority,
        status: g.status,
        source: g.source,
      })),
      total: goals.length,
      by_status: byStatus,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Approve Action
// ============================================

async function handleApprove(input: GoalOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.goal_id) {
    return { output: null, error: 'goal_id is required for approve', durationMs: 0 };
  }

  const ctx = getExecutionContext();
  const agentId = ctx?.agentId ?? 'unknown';

  // Check autonomy level — must be >= 4 to self-approve
  const agents = await query<{ autonomy_level: number; name: string }>(
    `SELECT autonomy_level, name FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 4) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 4 to self-approve goals.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const approvedBy = agentId !== 'unknown' ? `agent:${agents[0]?.name ?? agentId}` : 'system:goal-ops';
  const approved = await approveGoal(input.goal_id, approvedBy);

  return {
    output: {
      approved,
      goal_id: input.goal_id,
      message: approved
        ? 'Goal approved. It will be picked up by the orchestration system if complex, or available for direct execution.'
        : 'Failed to approve goal. It may not exist, or it may not be in "proposed" status.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Reject Action
// ============================================

async function handleReject(input: GoalOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.goal_id) {
    return { output: null, error: 'goal_id is required for reject', durationMs: 0 };
  }

  const rejected = await rejectGoal(input.goal_id);

  return {
    output: {
      rejected,
      goal_id: input.goal_id,
      message: rejected
        ? 'Goal rejected successfully.'
        : 'Failed to reject goal. It may not exist, or it may not be in "proposed" status.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Complete Action
// ============================================

async function handleComplete(input: GoalOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.goal_id) {
    return { output: null, error: 'goal_id is required for complete', durationMs: 0 };
  }

  // Verify goal exists and is in a completable status
  const goals = await query<{ id: string; status: string; title: string }>(
    `SELECT id, status, title FROM forge_agent_goals WHERE id = $1`,
    [input.goal_id],
  );
  if (goals.length === 0) {
    return { output: null, error: `Goal not found: ${input.goal_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  const goal = goals[0]!;
  if (goal.status !== 'approved' && goal.status !== 'in_progress') {
    return {
      output: null,
      error: `Goal status is '${goal.status}', must be 'approved' or 'in_progress' to complete`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  await query(
    `UPDATE forge_agent_goals
     SET status = 'completed',
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('result_summary', $1::text, 'completed_at', NOW()::text),
         updated_at = NOW()
     WHERE id = $2`,
    [input.result_summary ?? 'Completed by agent', input.goal_id],
  );

  return {
    output: {
      completed: true,
      goal_id: input.goal_id,
      title: goal.title,
      message: `Goal "${goal.title}" marked as completed.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
