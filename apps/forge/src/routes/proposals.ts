/**
 * Forge Proposal Routes (ADR-001 Phase 1)
 * Admin endpoints for the change proposal / code review pipeline.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';
import { syncProposalStatusToRevision } from '../learning/prompt-rewriter.js';

interface ProposalRow {
  id: string;
  proposal_type: string;
  title: string;
  description: string | null;
  author_agent_id: string;
  status: string;
  risk_level: string;
  required_reviews: number;
  file_changes: unknown;
  config_changes: unknown;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

interface ReviewRow {
  id: string;
  proposal_id: string;
  reviewer_agent_id: string;
  verdict: string;
  comment: string | null;
  suggestions: unknown;
  analysis: unknown;
  created_at: string;
}

export async function proposalRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/admin/proposals — List proposals with filters
   */
  app.get(
    '/api/v1/forge/admin/proposals',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as {
        status?: string;
        proposalType?: string;
        authorAgentId?: string;
        limit?: string;
        offset?: string;
      };

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (qs.status) {
        conditions.push(`p.status = $${paramIndex}`);
        params.push(qs.status);
        paramIndex++;
      }
      if (qs.proposalType) {
        conditions.push(`p.proposal_type = $${paramIndex}`);
        params.push(qs.proposalType);
        paramIndex++;
      }
      if (qs.authorAgentId) {
        conditions.push(`p.author_agent_id = $${paramIndex}`);
        params.push(qs.authorAgentId);
        paramIndex++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
      const offset = parseInt(qs.offset ?? '0', 10) || 0;

      const [proposals, countResult] = await Promise.all([
        query<ProposalRow & { author_name: string; review_count: string; approval_count: string }>(
          `SELECT p.id, p.proposal_type, p.title, p.description, p.status, p.risk_level,
                  p.author_agent_id, a.name as author_name,
                  p.required_reviews, p.created_at, p.updated_at, p.applied_at,
                  (SELECT COUNT(*) FROM forge_proposal_reviews r WHERE r.proposal_id = p.id)::text as review_count,
                  (SELECT COUNT(*) FROM forge_proposal_reviews r WHERE r.proposal_id = p.id AND r.verdict = 'approve')::text as approval_count
           FROM forge_change_proposals p
           LEFT JOIN forge_agents a ON a.id = p.author_agent_id
           ${where}
           ORDER BY p.created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset],
        ),
        queryOne<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM forge_change_proposals p ${where}`,
          params,
        ),
      ]);

      return reply.send({
        proposals,
        total: countResult ? parseInt(countResult.total, 10) : 0,
        limit,
        offset,
      });
    },
  );

  /**
   * GET /api/v1/forge/admin/proposals/:id — Proposal detail with reviews
   */
  app.get(
    '/api/v1/forge/admin/proposals/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const proposal = await queryOne<ProposalRow & { author_name: string; target_agent_name: string | null }>(
        `SELECT p.*, a.name as author_name, ta.name as target_agent_name
         FROM forge_change_proposals p
         LEFT JOIN forge_agents a ON a.id = p.author_agent_id
         LEFT JOIN forge_agents ta ON ta.id = p.target_agent_id
         WHERE p.id = $1`,
        [id],
      );

      if (!proposal) {
        return reply.status(404).send({ error: 'Not Found', message: 'Proposal not found' });
      }

      const reviews = await query<ReviewRow & { reviewer_name: string }>(
        `SELECT r.*, a.name as reviewer_name
         FROM forge_proposal_reviews r
         LEFT JOIN forge_agents a ON a.id = r.reviewer_agent_id
         WHERE r.proposal_id = $1
         ORDER BY r.created_at ASC`,
        [id],
      );

      return reply.send({ proposal, reviews });
    },
  );

  /**
   * POST /api/v1/forge/admin/proposals/:id/respond — Human approve/reject
   */
  app.post(
    '/api/v1/forge/admin/proposals/:id/respond',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const body = request.body as { action: 'approve' | 'reject'; comment?: string };

      if (!body.action || !['approve', 'reject'].includes(body.action)) {
        return reply.status(400).send({ error: 'Validation Error', message: 'action must be "approve" or "reject"' });
      }

      const proposal = await queryOne<ProposalRow>(
        `SELECT * FROM forge_change_proposals WHERE id = $1`,
        [id],
      );

      if (!proposal) {
        return reply.status(404).send({ error: 'Not Found', message: 'Proposal not found' });
      }

      if (proposal.status !== 'pending_review' && proposal.status !== 'approved') {
        return reply.status(400).send({
          error: 'Invalid State',
          message: `Cannot respond to proposal in status '${proposal.status}'`,
        });
      }

      const newStatus = body.action === 'approve' ? 'approved' : 'rejected';
      const updated = await queryOne<ProposalRow>(
        `UPDATE forge_change_proposals SET status = $1, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [newStatus, id],
      );

      // Sync status to linked prompt revision (if any)
      void syncProposalStatusToRevision(id, newStatus).catch((err) => {
        console.warn(`[Proposals] Failed to sync proposal status to revision:`, err instanceof Error ? err.message : err);
      });

      void logAudit({
        ownerId: userId,
        action: `proposal.${body.action}d`,
        resourceType: 'proposal',
        resourceId: id,
        details: { title: proposal.title, comment: body.comment, previous_status: proposal.status },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      return reply.send({ responded: true, proposal: updated });
    },
  );
}
