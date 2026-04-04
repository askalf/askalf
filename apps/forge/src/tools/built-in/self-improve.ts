/**
 * Built-in Tool: Self Improve (Level 9 — Vibe Evolution)
 * Agents can propose prompt revisions, review their revision history,
 * apply approved revisions, and analyze their own capabilities.
 */

import { query } from '../../database.js';
import { proposePromptRevision, applyPromptRevision, rejectPromptRevision, getPromptRevisions } from '../../learning/prompt-rewriter.js';
import { detectCapabilities, getAgentCapabilities } from '../../orchestration/capability-registry.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface SelfImproveInput {
  action: 'propose_revision' | 'list_revisions' | 'apply_revision' | 'reject_revision' | 'analyze_capabilities';
  revision_id?: string;
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function selfImprove(input: SelfImproveInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'propose_revision':
        return await handleProposeRevision(input, startTime);
      case 'list_revisions':
        return await handleListRevisions(input, startTime);
      case 'apply_revision':
        return await handleApplyRevision(input, startTime);
      case 'reject_revision':
        return await handleRejectRevision(input, startTime);
      case 'analyze_capabilities':
        return await handleAnalyzeCapabilities(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: propose_revision, list_revisions, apply_revision, reject_revision, analyze_capabilities`,
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
// Propose Revision Action
// ============================================

async function handleProposeRevision(input: SelfImproveInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }

  const revision = await proposePromptRevision(agentId);

  if (!revision) {
    return {
      output: {
        proposed: false,
        message: 'No revision proposed — insufficient correction patterns (need frequency >= 3 and confidence >= 0.6).',
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  return {
    output: {
      proposed: true,
      revision_id: revision.id,
      status: revision.status,
      reasoning: revision.reasoning,
      correction_patterns_used: revision.correction_patterns_used,
      prompt_length_before: revision.current_prompt.length,
      prompt_length_after: revision.proposed_prompt.length,
      message: 'Revision proposed. Use apply_revision to apply it, or wait for metabolic cycle auto-approval.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// List Revisions Action
// ============================================

async function handleListRevisions(input: SelfImproveInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  const revisions = await getPromptRevisions(agentId);

  return {
    output: {
      agent_id: agentId,
      revisions: revisions.map((r) => ({
        id: r.id,
        status: r.status,
        reasoning: r.reasoning,
        correction_patterns_used: r.correction_patterns_used,
      })),
      total: revisions.length,
      pending: revisions.filter((r) => r.status === 'pending').length,
      applied: revisions.filter((r) => r.status === 'applied').length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Apply Revision Action
// ============================================

async function handleApplyRevision(input: SelfImproveInput, startTime: number): Promise<ToolResult> {
  if (!input.revision_id) {
    return { output: null, error: 'revision_id is required for apply_revision', durationMs: 0 };
  }

  const ctx = getExecutionContext();
  const agentId = ctx?.agentId ?? 'unknown';

  // Check agent's autonomy level — must be >= 3 to self-apply
  const agents = await query<{ autonomy_level: number; name: string }>(
    `SELECT autonomy_level, name FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 3) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 3 to self-apply revisions.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const approvedBy = agentId !== 'unknown' ? `agent:${agents[0]?.name ?? agentId}` : 'system:self-improve';
  const applied = await applyPromptRevision(input.revision_id, approvedBy);

  return {
    output: {
      applied,
      revision_id: input.revision_id,
      message: applied
        ? 'Revision applied successfully. Your system prompt has been updated.'
        : 'Failed to apply revision. It may already be applied, rejected, or not found.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Reject Revision Action
// ============================================

async function handleRejectRevision(input: SelfImproveInput, startTime: number): Promise<ToolResult> {
  if (!input.revision_id) {
    return { output: null, error: 'revision_id is required for reject_revision', durationMs: 0 };
  }

  const ctx = getExecutionContext();
  const agentId = ctx?.agentId ?? 'unknown';

  const agents = await query<{ name: string }>(
    `SELECT name FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  const rejectedBy = agentId !== 'unknown' ? `agent:${agents[0]?.name ?? agentId}` : 'system:self-improve';
  const rejected = await rejectPromptRevision(input.revision_id, rejectedBy);

  return {
    output: {
      rejected,
      revision_id: input.revision_id,
      message: rejected
        ? 'Revision rejected successfully.'
        : 'Failed to reject revision. It may not exist, or it may not be in "pending" status.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Analyze Capabilities Action
// ============================================

async function handleAnalyzeCapabilities(input: SelfImproveInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  // Refresh capabilities via detection
  await detectCapabilities(agentId);

  // Get updated capabilities
  const capabilities = await getAgentCapabilities(agentId);

  // Get fleet averages for comparison
  const fleetAvg = await query<{ capability: string; avg_proficiency: string; agent_count: string }>(
    `SELECT capability,
            AVG(proficiency)::text AS avg_proficiency,
            COUNT(DISTINCT agent_id)::text AS agent_count
     FROM forge_agent_capabilities
     GROUP BY capability`,
  );
  const avgMap = new Map(fleetAvg.map((f) => [f.capability, {
    avg: parseFloat(f.avg_proficiency),
    agents: parseInt(f.agent_count, 10),
  }]));

  return {
    output: {
      agent_id: agentId,
      capabilities: capabilities.map((c) => {
        const fleet = avgMap.get(c.capability);
        return {
          capability: c.capability,
          proficiency: c.proficiency,
          success_count: c.success_count,
          failure_count: c.failure_count,
          fleet_avg_proficiency: fleet ? Math.round(fleet.avg) : null,
          fleet_agent_count: fleet?.agents ?? 0,
          vs_fleet: fleet ? (c.proficiency > fleet.avg + 10 ? 'above_average' : c.proficiency < fleet.avg - 10 ? 'below_average' : 'average') : 'no_comparison',
        };
      }),
      total_capabilities: capabilities.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
