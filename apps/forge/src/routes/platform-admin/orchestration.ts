/**
 * Platform Admin — Orchestration overview + Interventions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';
import { processFeedback } from '../../learning/feedback-processor.js';
import { paginationResponse } from './utils.js';

export async function registerOrchestrationRoutes(app: FastifyInstance): Promise<void> {

  // Orchestration overview
  app.get(
    '/api/v1/admin/orchestration',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const [agents, executions, pendingCount] = await Promise.all([
        query<Record<string, unknown>>('SELECT * FROM forge_agents LIMIT 100'),
        query<Record<string, unknown>>('SELECT * FROM forge_executions ORDER BY created_at DESC LIMIT 100'),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*) as count FROM agent_interventions WHERE status = 'pending'`),
      ]);

      const activeAgents = agents.filter((a) => a['status'] === 'active').length;
      const archivedAgents = agents.filter((a) => a['status'] === 'archived').length;
      const runningExecs = executions.filter((e) => e['status'] === 'running' || e['status'] === 'pending').length;
      const totalAutonomy = agents.reduce((sum, a) => sum + ((a['autonomy_level'] as number) ?? 2), 0);
      const avgAutonomy = agents.length > 0 ? Math.round(totalAutonomy / agents.length) : 0;

      return {
        agents: {
          total: agents.length,
          active: activeAgents,
          running: runningExecs,
          decommissioned: archivedAgents,
          avgAutonomy,
        },
        pendingInterventions: parseInt(pendingCount?.count || '0'),
      };
    },
  );

  // List interventions
  app.get(
    '/api/v1/admin/interventions',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as { status?: string; page?: string; limit?: string };
      const page = parseInt(qs.page ?? '1');
      const limit = parseInt(qs.limit ?? '20');
      const offset = (page - 1) * limit;

      let whereClause = '';
      const params: unknown[] = [];
      if (qs.status) {
        params.push(qs.status);
        whereClause = `WHERE status = $${params.length}`;
      }

      const [interventions, countResult] = await Promise.all([
        substrateQuery(
          `SELECT * FROM agent_interventions ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        substrateQueryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM agent_interventions ${whereClause}`,
          params,
        ),
      ]);

      const total = parseInt(countResult?.count || '0');
      return { interventions, total, page, limit, pagination: paginationResponse(total, page, limit) };
    },
  );

  // Respond to intervention
  app.post(
    '/api/v1/admin/interventions/:id/respond',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { action: string; feedback?: string; autonomy_delta?: number };

      if (!body.action || !['approve', 'deny', 'feedback'].includes(body.action)) {
        return reply.code(400).send({ error: 'Invalid action. Must be approve, deny, or feedback' });
      }

      const statusMap: Record<string, string> = { approve: 'approved', deny: 'denied', feedback: 'resolved' };
      const responderId = request.userId || 'admin';

      const oldIntervention = await substrateQueryOne<{
        id: string; status: string; agent_id: string; execution_id: string | null; context: string | null;
      }>(
        `SELECT id, status, agent_id, execution_id, context FROM agent_interventions WHERE id = $1`,
        [id],
      );

      const updated = await substrateQueryOne(
        `UPDATE agent_interventions
         SET status = $1, human_response = $2, responded_by = $3, responded_at = NOW(), autonomy_delta = COALESCE($4, autonomy_delta)
         WHERE id = $5 RETURNING *`,
        [statusMap[body.action], body.feedback || body.action, responderId, body.autonomy_delta ?? 0, id],
      );

      if (!updated) {
        return reply.code(404).send({ error: 'Intervention not found' });
      }

      // Audit log
      void substrateQuery(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('intervention', $1, 'responded', $2, $3, $4, $5)`,
        [
          id,
          `human:${responderId}`,
          responderId,
          JSON.stringify({ status: oldIntervention?.status || 'pending' }),
          JSON.stringify({ status: statusMap[body.action], action: body.action, feedback: body.feedback || null }),
        ],
      ).catch(() => {});

      // Phase 4: Close the learning loop — feed human response into memory
      if (oldIntervention && body.feedback) {
        const feedbackType = body.action === 'deny' ? 'rejection' as const
          : body.action === 'feedback' ? 'correction' as const
          : 'clarification' as const;

        void processFeedback({
          executionId: oldIntervention.execution_id ?? undefined,
          interventionId: id,
          agentId: oldIntervention.agent_id,
          ownerId: responderId,
          feedbackType,
          humanResponse: body.feedback,
          agentOutput: oldIntervention.context ?? undefined,
          autonomyDelta: body.autonomy_delta,
        }).catch((err) => {
          console.warn('[Feedback] Processing failed:', err instanceof Error ? err.message : err);
        });
      }

      return { intervention: updated };
    },
  );
}
