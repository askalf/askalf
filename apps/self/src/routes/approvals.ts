/**
 * Approval Routes
 * Human-in-the-loop approval queue for SELF actions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireSelf } from '../middleware/self-auth.js';
import { logActivity } from '../services/activity-logger.js';

interface ApprovalRow {
  id: string;
  self_id: string;
  user_id: string;
  type: string;
  title: string;
  description: string | null;
  context: Record<string, unknown>;
  proposed_action: Record<string, unknown>;
  estimated_cost: string;
  status: string;
  response: Record<string, unknown> | null;
  responded_at: string | null;
  timeout_at: string | null;
  urgency: string;
  created_at: string;
}

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /api/v1/self/approvals ----
  app.get('/api/v1/self/approvals', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const qs = request.query as { status?: string; limit?: string; offset?: string };
    const status = qs.status ?? 'pending';
    const limit = parseInt(qs.limit ?? '20', 10);
    const offset = parseInt(qs.offset ?? '0', 10);

    const [approvals, countResult, pendingResult] = await Promise.all([
      query<ApprovalRow>(
        `SELECT * FROM self_approvals
         WHERE self_id = $1 AND status = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [selfId, status, limit, offset],
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM self_approvals WHERE self_id = $1 AND status = $2`,
        [selfId, status],
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM self_approvals WHERE self_id = $1 AND status = 'pending'`,
        [selfId],
      ),
    ]);

    return reply.send({
      approvals: approvals.map(a => ({
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.description,
        status: a.status,
        estimatedCost: parseFloat(a.estimated_cost) || 0,
        risk: a.urgency === 'high' ? 'high' : a.urgency === 'medium' ? 'medium' : 'low',
        createdAt: a.created_at,
        resolvedAt: a.responded_at,
        metadata: a.context,
      })),
      total: parseInt(countResult?.count ?? '0', 10),
      pendingCount: parseInt(pendingResult?.count ?? '0', 10),
    });
  });

  // ---- GET /api/v1/self/approvals/count ----
  app.get('/api/v1/self/approvals/count', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM self_approvals
       WHERE self_id = $1 AND status = 'pending'`,
      [request.selfId],
    );

    return reply.send({ count: parseInt(result?.count ?? '0', 10) });
  });

  // ---- POST /api/v1/self/approvals/:id/approve ----
  app.post('/api/v1/self/approvals/:id/approve', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    return handleApprovalResponse(request, reply, id, 'approved');
  });

  // ---- POST /api/v1/self/approvals/:id/reject ----
  app.post('/api/v1/self/approvals/:id/reject', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    return handleApprovalResponse(request, reply, id, 'rejected');
  });

  // ---- POST /api/v1/self/approvals/:id/respond ----
  app.post('/api/v1/self/approvals/:id/respond', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { action: 'approve' | 'reject'; response?: Record<string, unknown> } | undefined;

    if (!body?.action || !['approve', 'reject'].includes(body.action)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'action must be "approve" or "reject"',
      });
    }

    const status = body.action === 'approve' ? 'approved' : 'rejected';
    return handleApprovalResponse(request, reply, id, status, body.response);
  });
}

async function handleApprovalResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  approvalId: string,
  status: 'approved' | 'rejected',
  responseData?: Record<string, unknown>,
): Promise<void> {
  const selfId = request.selfId!;
  const userId = request.userId!;

  const approval = await queryOne<ApprovalRow>(
    `SELECT * FROM self_approvals WHERE id = $1 AND self_id = $2 AND status = 'pending'`,
    [approvalId, selfId],
  );

  if (!approval) {
    reply.status(404).send({ error: 'Approval not found or already resolved' });
    return;
  }

  await query(
    `UPDATE self_approvals
     SET status = $1, response = $2, responded_at = NOW()
     WHERE id = $3`,
    [status, JSON.stringify(responseData ?? {}), approvalId],
  );

  await logActivity({
    selfId,
    userId,
    type: 'approval_response',
    title: `${status === 'approved' ? 'Approved' : 'Rejected'}: ${approval.title}`,
    approvalId,
    importance: 6,
  });

  reply.send({ status, approval_id: approvalId });
}
