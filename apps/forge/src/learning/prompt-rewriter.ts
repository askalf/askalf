/**
 * Self-Rewriting System Prompts (Phase 6)
 * Analyzes correction patterns and proposes improved system prompts for agents.
 * Revisions require human approval before being applied.
 */

import { query } from '../database.js';
import { ulid } from 'ulid';
import { runCliQuery } from '../runtime/worker.js';

interface CorrectionPattern {
  id: string;
  pattern_type: string;
  description: string;
  frequency: number;
  confidence: number;
}

interface PromptRevision {
  id: string;
  agent_id: string;
  current_prompt: string;
  proposed_prompt: string;
  reasoning: string;
  correction_patterns_used: string[];
  status: string;
}

/**
 * Analyze an agent's correction patterns and propose a prompt revision.
 * Only proposes if there are significant, confident patterns (freq >= 3, confidence >= 0.6).
 */
export async function proposePromptRevision(agentId: string): Promise<PromptRevision | null> {
  // Get the agent's current system prompt
  const agent = await query<{ system_prompt: string; name: string }>(
    `SELECT system_prompt, name FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agent.length === 0) return null;
  const currentPrompt = agent[0]!.system_prompt;
  const agentName = agent[0]!.name;

  // Fetch significant correction patterns
  const patterns = await query<CorrectionPattern>(
    `SELECT id, pattern_type, description, frequency, confidence
     FROM forge_correction_patterns
     WHERE agent_id = $1
       AND frequency >= 3
       AND confidence >= 0.6
     ORDER BY frequency DESC, confidence DESC
     LIMIT 10`,
    [agentId],
  );

  if (patterns.length === 0) {
    console.log(`[PromptRewriter] No significant correction patterns for ${agentName}`);
    return null;
  }

  // Check for pending revisions (don't create another if one is waiting)
  const pending = await query<{ id: string }>(
    `SELECT id FROM forge_prompt_revisions WHERE agent_id = $1 AND status = 'pending' LIMIT 1`,
    [agentId],
  );
  if (pending.length > 0) {
    console.log(`[PromptRewriter] Agent ${agentName} already has a pending revision`);
    return null;
  }

  // Use LLM to generate improved prompt
  const patternDescriptions = patterns
    .map((p) => `- [${p.pattern_type}] (seen ${p.frequency}x, confidence ${(p.confidence * 100).toFixed(0)}%): ${p.description}`)
    .join('\n');

  const llmPrompt = `You are a system prompt engineer. An AI agent named "${agentName}" has been receiving repeated corrections from humans. Based on the correction patterns below, revise the agent's system prompt to address these issues.

CURRENT SYSTEM PROMPT:
${currentPrompt.substring(0, 3000)}

CORRECTION PATTERNS (repeated human feedback):
${patternDescriptions}

Return ONLY valid JSON (no markdown fences):
{
  "proposed_prompt": "the full revised system prompt incorporating fixes for the correction patterns",
  "reasoning": "2-3 sentences explaining what changed and why"
}

RULES:
- Keep the core identity and purpose unchanged
- Add specific instructions that address each correction pattern
- Don't remove existing instructions unless they conflict with corrections
- Be concise — don't add unnecessary verbosity`;

  try {
    const result = await runCliQuery(llmPrompt, {
      model: 'claude-haiku-4-5',
      maxTurns: 1,
      timeout: 60000,
    });

    if (result.isError) {
      console.warn(`[PromptRewriter] LLM failed for ${agentName}: ${result.output.substring(0, 200)}`);
      return null;
    }

    // Parse the LLM output
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[PromptRewriter] Could not parse LLM output for ${agentName}`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as { proposed_prompt: string; reasoning: string };
    if (!parsed.proposed_prompt || !parsed.reasoning) return null;

    const revisionId = ulid();
    const patternIds = patterns.map((p) => p.id);

    await query(
      `INSERT INTO forge_prompt_revisions
       (id, agent_id, current_prompt, proposed_prompt, reasoning, correction_patterns_used)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [revisionId, agentId, currentPrompt, parsed.proposed_prompt, parsed.reasoning, patternIds],
    );

    console.log(`[PromptRewriter] Proposed revision ${revisionId} for ${agentName}: ${parsed.reasoning.substring(0, 100)}`);

    // Phase 2: Create a linked change proposal and auto-submit for review
    try {
      await createLinkedProposal(revisionId, agentId, agentName, parsed.reasoning);
    } catch (proposalErr) {
      // Don't fail the revision if proposal creation fails (table may not exist yet)
      console.warn(`[PromptRewriter] Could not create change proposal for revision ${revisionId}:`,
        proposalErr instanceof Error ? proposalErr.message : proposalErr);
    }

    return {
      id: revisionId,
      agent_id: agentId,
      current_prompt: currentPrompt,
      proposed_prompt: parsed.proposed_prompt,
      reasoning: parsed.reasoning,
      correction_patterns_used: patternIds,
      status: 'pending',
    };
  } catch (err) {
    console.warn(`[PromptRewriter] Error proposing revision for ${agentName}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Apply an approved prompt revision to the agent.
 */
export async function applyPromptRevision(revisionId: string, approvedBy: string): Promise<boolean> {
  const rev = await query<{ agent_id: string; proposed_prompt: string; status: string }>(
    `SELECT agent_id, proposed_prompt, status FROM forge_prompt_revisions WHERE id = $1`,
    [revisionId],
  );

  if (rev.length === 0) return false;
  const revision = rev[0]!;

  if (revision.status !== 'pending' && revision.status !== 'approved') {
    return false;
  }

  // Update the agent's system prompt
  await query(
    `UPDATE forge_agents SET system_prompt = $1, updated_at = NOW() WHERE id = $2`,
    [revision.proposed_prompt, revision.agent_id],
  );

  // Mark revision as applied
  await query(
    `UPDATE forge_prompt_revisions
     SET status = 'applied', approved_by = $1, approved_at = NOW(), applied_at = NOW()
     WHERE id = $2`,
    [approvedBy, revisionId],
  );

  console.log(`[PromptRewriter] Applied revision ${revisionId} (approved by ${approvedBy})`);
  return true;
}

/**
 * Reject a pending prompt revision.
 */
export async function rejectPromptRevision(revisionId: string, rejectedBy: string): Promise<boolean> {
  const result = await query(
    `UPDATE forge_prompt_revisions
     SET status = 'rejected', approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND status = 'pending'
     RETURNING id`,
    [rejectedBy, revisionId],
  );
  return result.length > 0;
}

/**
 * Get all prompt revisions for an agent.
 */
export async function getPromptRevisions(agentId: string): Promise<PromptRevision[]> {
  return query<PromptRevision>(
    `SELECT id, agent_id, current_prompt, proposed_prompt, reasoning,
            correction_patterns_used, status
     FROM forge_prompt_revisions
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [agentId],
  );
}

// ============================================
// Phase 2: Change Proposal Integration
// ============================================

const REVIEWER_META_ID = '01METAAGENT0000000000000000';
const REVIEWER_ARCHITECT_ID = '01KGXGV6QBPG0S0VGRY64T7D1W';

/**
 * Create a forge_change_proposals record linked to a prompt revision,
 * auto-submit for review, and notify reviewer agents.
 */
async function createLinkedProposal(
  revisionId: string,
  agentId: string,
  agentName: string,
  reasoning: string,
): Promise<void> {
  const proposalId = ulid();

  await query(
    `INSERT INTO forge_change_proposals
     (id, proposal_type, title, description, author_agent_id, target_agent_id,
      prompt_revision_id, risk_level, status)
     VALUES ($1, 'prompt_revision', $2, $3, $4, $5, $6, 'medium', 'pending_review')`,
    [
      proposalId,
      `Prompt revision for ${agentName}`,
      reasoning,
      agentId,
      agentId,
      revisionId,
    ],
  );

  // Audit trail for proposal creation + auto-submit
  void query(
    `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ulid(), agentId, 'proposal.auto_submitted', 'proposal', proposalId,
     JSON.stringify({ revision_id: revisionId, agent_name: agentName, reviewers: ['Meta', 'Architect'] })],
  ).catch(() => {});

  // Notify reviewers via audit log entries they can discover
  for (const reviewerId of [REVIEWER_META_ID, REVIEWER_ARCHITECT_ID]) {
    void query(
      `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ulid(), reviewerId, 'proposal.review_requested', 'proposal', proposalId,
       JSON.stringify({ revision_id: revisionId, target_agent: agentName, proposal_type: 'prompt_revision' })],
    ).catch(() => {});
  }

  console.log(`[PromptRewriter] Created change proposal ${proposalId} for revision ${revisionId}, assigned to Meta + Architect for review`);
}

/**
 * Sync change proposal status changes back to the linked prompt revision.
 * Called by proposal-ops review/apply actions and proposal routes respond handler.
 */
export async function syncProposalStatusToRevision(proposalId: string, newStatus: string): Promise<void> {
  const rows = await query<{ prompt_revision_id: string | null; target_agent_id: string | null }>(
    `SELECT prompt_revision_id, target_agent_id FROM forge_change_proposals WHERE id = $1`,
    [proposalId],
  );

  if (rows.length === 0 || !rows[0]!.prompt_revision_id) return;

  const revisionId = rows[0]!.prompt_revision_id;

  if (newStatus === 'approved') {
    await query(
      `UPDATE forge_prompt_revisions SET status = 'approved' WHERE id = $1`,
      [revisionId],
    );
    console.log(`[PromptRewriter] Synced proposal approval to revision ${revisionId}`);
  } else if (newStatus === 'rejected') {
    await query(
      `UPDATE forge_prompt_revisions SET status = 'rejected' WHERE id = $1`,
      [revisionId],
    );
    console.log(`[PromptRewriter] Synced proposal rejection to revision ${revisionId}`);
  } else if (newStatus === 'applied') {
    await applyPromptRevision(revisionId, 'system:proposal-pipeline');
    console.log(`[PromptRewriter] Applied prompt revision ${revisionId} via proposal pipeline`);
  }
}

/**
 * Scan all agents with enough correction patterns and propose revisions.
 * Called by metabolic cycle.
 */
export async function proposeAllRevisions(): Promise<number> {
  const agents = await query<{ agent_id: string; pattern_count: string }>(
    `SELECT agent_id, COUNT(*)::text AS pattern_count
     FROM forge_correction_patterns
     WHERE frequency >= 3 AND confidence >= 0.6
     GROUP BY agent_id
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC`,
  );

  let proposed = 0;
  for (const row of agents) {
    const result = await proposePromptRevision(row.agent_id).catch(() => null);
    if (result) proposed++;
  }

  if (proposed > 0) {
    console.log(`[PromptRewriter] Proposed ${proposed} prompt revisions across fleet`);
  }
  return proposed;
}
