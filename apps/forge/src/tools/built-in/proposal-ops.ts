/**
 * Built-in Tool: Proposal Operations (ADR-001 Phase 1)
 * Manages change proposals for agent code review pipeline.
 * Agents create proposals for prompt revisions, code changes, config changes,
 * or schema changes. Proposals go through review workflow before being applied.
 * Status flow: draft → pending_review → approved → applied (or rejected/revision_requested)
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../../database.js';
import { syncProposalStatusToRevision } from '../../learning/prompt-rewriter.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface ProposalOpsInput {
  action: 'create' | 'submit' | 'review' | 'list' | 'get' | 'apply' | 'revise';
  // create fields
  agent_id?: string;
  agent_name?: string;
  proposal_type?: 'prompt_revision' | 'code_change' | 'config_change' | 'schema_change';
  title?: string;
  description?: string;
  target_agent_id?: string;
  prompt_revision_id?: string;
  file_changes?: Array<{ path: string; action: string; content?: string; diff?: string }>;
  config_changes?: Record<string, unknown>;
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
  execution_id?: string;
  // submit/get/apply/revise fields
  proposal_id?: string;
  // review fields
  reviewer_agent_id?: string;
  verdict?: 'approve' | 'reject' | 'request_changes' | 'comment';
  comment?: string;
  suggestions?: Array<{ field: string; suggestion: string }>;
  analysis?: Record<string, unknown>;
  // list filters
  filter_status?: string;
  filter_type?: string;
  filter_author?: string;
  limit?: number;
}

// ============================================
// Implementation
// ============================================

export async function proposalOps(input: ProposalOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'create': {
        if (!input.title) {
          return { output: null, error: 'title is required to create a proposal', durationMs: 0 };
        }
        if (!input.proposal_type) {
          return { output: null, error: 'proposal_type is required (prompt_revision, code_change, config_change, schema_change)', durationMs: 0 };
        }
        if (!input.agent_id) {
          return { output: null, error: 'agent_id is required (the author agent)', durationMs: 0 };
        }

        const id = ulid();
        const proposal = await queryOne<Record<string, unknown>>(
          `INSERT INTO forge_change_proposals
           (id, proposal_type, title, description, author_agent_id, target_agent_id,
            prompt_revision_id, file_changes, config_changes, risk_level, execution_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
           RETURNING id, proposal_type, title, status, risk_level, created_at`,
          [
            id,
            input.proposal_type,
            input.title,
            input.description ?? null,
            input.agent_id,
            input.target_agent_id ?? null,
            input.prompt_revision_id ?? null,
            JSON.stringify(input.file_changes ?? []),
            JSON.stringify(input.config_changes ?? {}),
            input.risk_level ?? 'low',
            input.execution_id ?? null,
          ],
        );

        // Audit trail
        void query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ulid(), input.agent_id, 'proposal.created', 'proposal', id,
           JSON.stringify({ title: input.title, type: input.proposal_type, risk: input.risk_level ?? 'low' })],
        ).catch(() => {});

        return {
          output: { created: true, proposal },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'submit': {
        if (!input.proposal_id) {
          return { output: null, error: 'proposal_id is required for submit', durationMs: 0 };
        }

        const existing = await queryOne<{ status: string }>(
          `SELECT status FROM forge_change_proposals WHERE id = $1`,
          [input.proposal_id],
        );
        if (!existing) {
          return { output: null, error: `Proposal not found: ${input.proposal_id}`, durationMs: Math.round(performance.now() - startTime) };
        }
        if (existing.status !== 'draft' && existing.status !== 'revision_requested') {
          return { output: null, error: `Cannot submit proposal in status '${existing.status}'. Must be 'draft' or 'revision_requested'.`, durationMs: Math.round(performance.now() - startTime) };
        }

        const proposal = await queryOne<Record<string, unknown>>(
          `UPDATE forge_change_proposals SET status = 'pending_review', updated_at = now()
           WHERE id = $1 RETURNING id, title, status, updated_at`,
          [input.proposal_id],
        );

        void query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ulid(), input.agent_id ?? 'system', 'proposal.submitted', 'proposal', input.proposal_id,
           JSON.stringify({ previous_status: existing.status })],
        ).catch(() => {});

        return {
          output: { submitted: true, proposal },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'review': {
        if (!input.proposal_id) {
          return { output: null, error: 'proposal_id is required for review', durationMs: 0 };
        }
        if (!input.reviewer_agent_id) {
          return { output: null, error: 'reviewer_agent_id is required', durationMs: 0 };
        }
        if (!input.verdict) {
          return { output: null, error: 'verdict is required (approve, reject, request_changes, comment)', durationMs: 0 };
        }

        const proposal = await queryOne<{ status: string; required_reviews: number; author_agent_id: string }>(
          `SELECT status, required_reviews, author_agent_id FROM forge_change_proposals WHERE id = $1`,
          [input.proposal_id],
        );
        if (!proposal) {
          return { output: null, error: `Proposal not found: ${input.proposal_id}`, durationMs: Math.round(performance.now() - startTime) };
        }
        if (proposal.status !== 'pending_review') {
          return { output: null, error: `Cannot review proposal in status '${proposal.status}'. Must be 'pending_review'.`, durationMs: Math.round(performance.now() - startTime) };
        }
        if (input.reviewer_agent_id === proposal.author_agent_id) {
          return { output: null, error: 'Authors cannot review their own proposals', durationMs: Math.round(performance.now() - startTime) };
        }

        const reviewId = ulid();
        const review = await queryOne<Record<string, unknown>>(
          `INSERT INTO forge_proposal_reviews (id, proposal_id, reviewer_agent_id, verdict, comment, suggestions, analysis)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, verdict, comment, created_at`,
          [
            reviewId,
            input.proposal_id,
            input.reviewer_agent_id,
            input.verdict,
            input.comment ?? null,
            JSON.stringify(input.suggestions ?? []),
            JSON.stringify(input.analysis ?? {}),
          ],
        );

        // Auto-transition status based on verdict and required reviews
        let newStatus: string | null = null;
        if (input.verdict === 'reject') {
          newStatus = 'rejected';
        } else if (input.verdict === 'request_changes') {
          newStatus = 'revision_requested';
        } else if (input.verdict === 'approve') {
          const approvals = await queryOne<{ count: string }>(
            `SELECT COUNT(*)::text as count FROM forge_proposal_reviews
             WHERE proposal_id = $1 AND verdict = 'approve'`,
            [input.proposal_id],
          );
          if (parseInt(approvals?.count ?? '0', 10) >= proposal.required_reviews) {
            newStatus = 'approved';
          }
        }

        if (newStatus) {
          await query(
            `UPDATE forge_change_proposals SET status = $1, updated_at = now() WHERE id = $2`,
            [newStatus, input.proposal_id],
          );

          // Sync status to linked prompt revision (if any)
          void syncProposalStatusToRevision(input.proposal_id, newStatus).catch((err) => {
            console.warn(`[ProposalOps] Failed to sync proposal status to revision:`, err instanceof Error ? err.message : err);
          });
        }

        void query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ulid(), input.reviewer_agent_id, 'proposal.reviewed', 'proposal', input.proposal_id,
           JSON.stringify({ verdict: input.verdict, new_status: newStatus })],
        ).catch(() => {});

        return {
          output: { reviewed: true, review, status_changed: newStatus },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'list': {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (input.filter_status) {
          params.push(input.filter_status);
          conditions.push(`p.status = $${params.length}`);
        }
        if (input.filter_type) {
          params.push(input.filter_type);
          conditions.push(`p.proposal_type = $${params.length}`);
        }
        if (input.filter_author) {
          params.push(input.filter_author);
          conditions.push(`p.author_agent_id = $${params.length}`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(input.limit ?? 20, 50);

        const proposals = await query<Record<string, unknown>>(
          `SELECT p.id, p.proposal_type, p.title, p.status, p.risk_level,
                  p.author_agent_id, a.name as author_name,
                  p.target_agent_id, p.required_reviews,
                  p.created_at, p.updated_at,
                  (SELECT COUNT(*) FROM forge_proposal_reviews r WHERE r.proposal_id = p.id)::int as review_count,
                  (SELECT COUNT(*) FROM forge_proposal_reviews r WHERE r.proposal_id = p.id AND r.verdict = 'approve')::int as approval_count
           FROM forge_change_proposals p
           LEFT JOIN forge_agents a ON a.id = p.author_agent_id
           ${where}
           ORDER BY p.created_at DESC
           LIMIT ${limit}`,
          params,
        );

        return {
          output: { proposals, count: proposals.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'get': {
        if (!input.proposal_id) {
          return { output: null, error: 'proposal_id is required for get', durationMs: 0 };
        }

        const proposal = await queryOne<Record<string, unknown>>(
          `SELECT p.*, a.name as author_name, ta.name as target_agent_name
           FROM forge_change_proposals p
           LEFT JOIN forge_agents a ON a.id = p.author_agent_id
           LEFT JOIN forge_agents ta ON ta.id = p.target_agent_id
           WHERE p.id = $1`,
          [input.proposal_id],
        );

        if (!proposal) {
          return { output: null, error: `Proposal not found: ${input.proposal_id}`, durationMs: Math.round(performance.now() - startTime) };
        }

        const reviews = await query<Record<string, unknown>>(
          `SELECT r.*, a.name as reviewer_name
           FROM forge_proposal_reviews r
           LEFT JOIN forge_agents a ON a.id = r.reviewer_agent_id
           WHERE r.proposal_id = $1
           ORDER BY r.created_at ASC`,
          [input.proposal_id],
        );

        return {
          output: { proposal, reviews },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'apply': {
        if (!input.proposal_id) {
          return { output: null, error: 'proposal_id is required for apply', durationMs: 0 };
        }

        const proposal = await queryOne<{ status: string; title: string }>(
          `SELECT status, title FROM forge_change_proposals WHERE id = $1`,
          [input.proposal_id],
        );
        if (!proposal) {
          return { output: null, error: `Proposal not found: ${input.proposal_id}`, durationMs: Math.round(performance.now() - startTime) };
        }
        if (proposal.status !== 'approved') {
          return { output: null, error: `Cannot apply proposal in status '${proposal.status}'. Must be 'approved'.`, durationMs: Math.round(performance.now() - startTime) };
        }

        const updated = await queryOne<Record<string, unknown>>(
          `UPDATE forge_change_proposals SET status = 'applied', applied_at = now(), updated_at = now()
           WHERE id = $1 RETURNING id, title, status, applied_at`,
          [input.proposal_id],
        );

        // Sync applied status to linked prompt revision (triggers actual prompt update)
        void syncProposalStatusToRevision(input.proposal_id, 'applied').catch((err) => {
          console.warn(`[ProposalOps] Failed to sync apply to revision:`, err instanceof Error ? err.message : err);
        });

        void query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ulid(), input.agent_id ?? 'system', 'proposal.applied', 'proposal', input.proposal_id,
           JSON.stringify({ title: proposal.title })],
        ).catch(() => {});

        return {
          output: { applied: true, proposal: updated },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'revise': {
        if (!input.proposal_id) {
          return { output: null, error: 'proposal_id is required for revise', durationMs: 0 };
        }

        const proposal = await queryOne<{ status: string }>(
          `SELECT status FROM forge_change_proposals WHERE id = $1`,
          [input.proposal_id],
        );
        if (!proposal) {
          return { output: null, error: `Proposal not found: ${input.proposal_id}`, durationMs: Math.round(performance.now() - startTime) };
        }
        if (proposal.status !== 'revision_requested' && proposal.status !== 'draft') {
          return { output: null, error: `Cannot revise proposal in status '${proposal.status}'. Must be 'draft' or 'revision_requested'.`, durationMs: Math.round(performance.now() - startTime) };
        }

        // Build SET clause dynamically for provided fields
        const setClauses: string[] = ['updated_at = now()'];
        const params: unknown[] = [];

        if (input.title !== undefined) {
          params.push(input.title);
          setClauses.push(`title = $${params.length}`);
        }
        if (input.description !== undefined) {
          params.push(input.description);
          setClauses.push(`description = $${params.length}`);
        }
        if (input.file_changes !== undefined) {
          params.push(JSON.stringify(input.file_changes));
          setClauses.push(`file_changes = $${params.length}`);
        }
        if (input.config_changes !== undefined) {
          params.push(JSON.stringify(input.config_changes));
          setClauses.push(`config_changes = $${params.length}`);
        }
        if (input.risk_level !== undefined) {
          params.push(input.risk_level);
          setClauses.push(`risk_level = $${params.length}`);
        }

        // Reset to draft so it can be resubmitted
        setClauses.push(`status = 'draft'`);

        params.push(input.proposal_id);
        const updated = await queryOne<Record<string, unknown>>(
          `UPDATE forge_change_proposals SET ${setClauses.join(', ')}
           WHERE id = $${params.length}
           RETURNING id, title, status, updated_at`,
          params,
        );

        void query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ulid(), input.agent_id ?? 'system', 'proposal.revised', 'proposal', input.proposal_id,
           JSON.stringify({ fields_updated: setClauses.length - 2 })],
        ).catch(() => {});

        return {
          output: { revised: true, proposal: updated },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: create, submit, review, list, get, apply, revise`,
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
