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
      const [statusCounts, agentStats, agents, handoffCount] = await Promise.all([
        query<{ status: string; count: string }>(
          `SELECT status, COUNT(*) as count FROM forge_executions GROUP BY status`,
        ),
        query<{ agent_id: string; status: string; count: string }>(
          `SELECT agent_id, status, COUNT(*) as count FROM forge_executions GROUP BY agent_id, status`,
        ),
        query<Record<string, unknown>>('SELECT id, name FROM forge_agents'),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM forge_executions WHERE parent_execution_id IS NOT NULL OR metadata->>'source' = 'fleet-dispatch'`,
        ),
      ]);

      const agentMap = new Map(agents.map((a) => [a['id'] as string, a['name'] as string]));

      // Aggregate status counts
      let total = 0, pending = 0, running = 0, completed = 0, failed = 0;
      for (const row of statusCounts) {
        const c = parseInt(row.count, 10);
        total += c;
        if (row.status === 'pending') pending = c;
        else if (row.status === 'running') running = c;
        else if (row.status === 'completed') completed = c;
        else if (row.status === 'failed') failed = c;
      }

      // Per-agent stats
      const byAgent = new Map<string, { completed: number; failed: number; total: number }>();
      for (const row of agentStats) {
        const c = parseInt(row.count, 10);
        if (!byAgent.has(row.agent_id)) byAgent.set(row.agent_id, { completed: 0, failed: 0, total: 0 });
        const stats = byAgent.get(row.agent_id)!;
        stats.total += c;
        if (row.status === 'completed') stats.completed += c;
        if (row.status === 'failed') stats.failed += c;
      }

      const recentByAgent = Array.from(byAgent.entries()).map(([agentId, stats]) => ({
        agentId,
        agentName: agentMap.get(agentId) || 'Unknown',
        ...stats,
        successRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
      }));

      return {
        totals: { total, pending, in_progress: running, completed, failed, handoffs: parseInt(handoffCount?.count ?? '0', 10) },
        recentByAgent,
      };
    },
  );
}
