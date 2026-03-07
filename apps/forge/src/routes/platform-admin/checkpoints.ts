/**
 * Platform Admin — Checkpoint routes
 * Allows humans to list, view, and respond to agent checkpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../../database.js';
import { respondToCheckpoint, type CheckpointRow } from '../../orchestration/checkpoint.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/auth.js';
import { ListCheckpointsQuery, RespondCheckpointBody, IdParam } from '../schemas.js';

export async function registerCheckpointRoutes(app: FastifyInstance): Promise<void> {

  // List checkpoints (default: pending only, optionally all)
  app.get(
    '/api/v1/admin/checkpoints',
    {
      schema: {
        tags: ['Checkpoints'],
        summary: 'List checkpoints (default: pending)',
        querystring: ListCheckpointsQuery,
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest) => {
      const { owner_id, status, limit = '50' } = request.query as {
        owner_id?: string;
        status?: string;
        limit?: string;
      };

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (owner_id) {
        conditions.push(`owner_id = $${paramIdx++}`);
        params.push(owner_id);
      }
      if (status) {
        conditions.push(`status = $${paramIdx++}`);
        params.push(status);
      } else {
        // Default to pending if no status filter
        conditions.push(`status = $${paramIdx++}`);
        params.push('pending');
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limitNum = Math.min(parseInt(limit, 10) || 50, 200);

      const checkpoints = await query<CheckpointRow>(
        `SELECT * FROM forge_checkpoints ${where} ORDER BY created_at DESC LIMIT ${limitNum}`,
        params,
      );

      return {
        checkpoints: checkpoints.map(formatCheckpoint),
        total: checkpoints.length,
      };
    },
  );

  // Get single checkpoint
  app.get(
    '/api/v1/admin/checkpoints/:id',
    {
      schema: {
        tags: ['Checkpoints'],
        summary: 'Get a single checkpoint',
        params: IdParam,
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const checkpoint = await queryOne<CheckpointRow>(
        `SELECT * FROM forge_checkpoints WHERE id = $1`,
        [id],
      );

      if (!checkpoint) {
        return reply.code(404).send({ error: 'Checkpoint not found' });
      }

      return { checkpoint: formatCheckpoint(checkpoint) };
    },
  );

  // Respond to a checkpoint
  app.post(
    '/api/v1/admin/checkpoints/:id/respond',
    {
      schema: {
        tags: ['Checkpoints'],
        summary: 'Respond to a checkpoint (approve/reject)',
        params: IdParam,
        body: RespondCheckpointBody,
      },
      preHandler: [authMiddleware, requireAdmin],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        response?: Record<string, unknown>;
        status?: 'approved' | 'rejected';
      };

      // Build response object
      const response: Record<string, unknown> = {
        ...(body.response ?? {}),
        respondedBy: 'admin',
        respondedVia: 'dashboard',
      };

      if (body.status === 'approved' || body.status === 'rejected') {
        response['decision'] = body.status;
      }

      try {
        await respondToCheckpoint(id, response);

        // If caller specified approved/rejected, update status accordingly
        if (body.status === 'approved' || body.status === 'rejected') {
          await query(
            `UPDATE forge_checkpoints SET status = $1 WHERE id = $2`,
            [body.status, id],
          );
        }

        const updated = await queryOne<CheckpointRow>(
          `SELECT * FROM forge_checkpoints WHERE id = $1`,
          [id],
        );

        return {
          success: true,
          checkpoint: updated ? formatCheckpoint(updated) : null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );
}

function formatCheckpoint(row: CheckpointRow) {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    executionId: row.execution_id,
    ownerId: row.owner_id,
    type: row.type,
    title: row.title,
    description: row.description,
    context: row.context,
    response: row.response,
    status: row.status,
    timeoutAt: row.timeout_at,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
  };
}
