/**
 * Platform Admin — Task management (execution enrichment)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../../database.js';
import { substrateQuery } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';
import { mapAgentType, paginationResponse } from './utils.js';

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {

  // List tasks
  app.get(
    '/api/v1/admin/tasks',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as { status?: string; agentId?: string; page?: string; limit?: string };
      const conditions: string[] = [];
      const params: unknown[] = [];
      const page = parseInt(qs.page ?? '1');
      const limit = Math.min(parseInt(qs.limit ?? '20'), 100);
      const offset = (page - 1) * limit;

      if (qs.status) { params.push(qs.status); conditions.push(`e.status = $${params.length}`); }
      if (qs.agentId) { params.push(qs.agentId); conditions.push(`e.agent_id = $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [tasks, countResult] = await Promise.all([
        query<Record<string, unknown>>(
          `SELECT e.*, a.name as agent_name, a.metadata as agent_metadata
           FROM forge_executions e
           LEFT JOIN forge_agents a ON e.agent_id = a.id
           ${where}
           ORDER BY e.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM forge_executions e ${where}`, params),
      ]);

      const total = parseInt(countResult?.count || '0');

      return {
        tasks: tasks.map((t) => ({
          ...t,
          agent_type: mapAgentType(t['agent_metadata'] as Record<string, unknown> | null),
        })),
        total,
        page,
        limit,
        pagination: paginationResponse(total, page, limit),
      };
    },
  );

  // Task detail
  app.get(
    '/api/v1/admin/tasks/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const [execution, interventions] = await Promise.all([
        queryOne<Record<string, unknown>>(
          `SELECT e.*, a.name as agent_name, a.metadata as agent_metadata
           FROM forge_executions e
           LEFT JOIN forge_agents a ON e.agent_id = a.id
           WHERE e.id = $1`,
          [id],
        ),
        substrateQuery(
          `SELECT * FROM agent_interventions WHERE task_id = $1 ORDER BY created_at DESC`,
          [id],
        ).catch(() => []),
      ]);

      if (!execution) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      // Check for child executions
      const childExecs = await query<Record<string, unknown>>(
        `SELECT id, status, agent_id, created_at, completed_at FROM forge_executions WHERE parent_execution_id = $1`,
        [id],
      ).catch(() => []);

      return {
        task: {
          ...execution,
          agent_type: mapAgentType(execution['agent_metadata'] as Record<string, unknown> | null),
        },
        interventions,
        childTasks: childExecs,
      };
    },
  );

  // Task stats
  app.get(
    '/api/v1/admin/tasks/stats',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const [executions, agents] = await Promise.all([
        query<Record<string, unknown>>('SELECT id, agent_id, status FROM forge_executions ORDER BY created_at DESC LIMIT 200'),
        query<Record<string, unknown>>('SELECT id, name FROM forge_agents'),
      ]);

      const agentMap = new Map(agents.map((a) => [a['id'] as string, a['name'] as string]));
      const total = executions.length;
      const pending = executions.filter((e) => e['status'] === 'pending').length;
      const running = executions.filter((e) => e['status'] === 'running').length;
      const completed = executions.filter((e) => e['status'] === 'completed').length;
      const failed = executions.filter((e) => e['status'] === 'failed').length;

      // Per-agent stats
      const byAgent = new Map<string, { completed: number; failed: number; total: number }>();
      for (const e of executions) {
        const agentId = e['agent_id'] as string;
        if (!byAgent.has(agentId)) byAgent.set(agentId, { completed: 0, failed: 0, total: 0 });
        const stats = byAgent.get(agentId)!;
        stats.total++;
        if (e['status'] === 'completed') stats.completed++;
        if (e['status'] === 'failed') stats.failed++;
      }

      const recentByAgent = Array.from(byAgent.entries()).map(([agentId, stats]) => ({
        agentId,
        agentName: agentMap.get(agentId) || 'Unknown',
        ...stats,
        successRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
      }));

      return { total, pending, running, completed, failed, recentByAgent };
    },
  );
}
