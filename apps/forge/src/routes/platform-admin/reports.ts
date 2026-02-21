/**
 * Platform Admin — Reports, metrics, findings, schedules, activity, feed, analytics
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';
import { mapAgentType, paginationResponse } from './utils.js';

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {

  // Findings
  app.get(
    '/api/v1/admin/reports/findings',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      try {
        const findings = await substrateQuery(
          `SELECT * FROM agent_findings
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 END,
           created_at DESC LIMIT 50`,
        );
        return { findings };
      } catch {
        return { findings: [] };
      }
    },
  );

  // Schedules list
  app.get(
    '/api/v1/admin/reports/schedules',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const [agents, schedules] = await Promise.all([
        query<Record<string, unknown>>('SELECT id, name, status, metadata FROM forge_agents LIMIT 100'),
        substrateQuery<Record<string, unknown>>('SELECT * FROM agent_schedules'),
      ]);

      const agentMap = new Map(agents.map((a) => [a['id'] as string, a]));

      return {
        schedules: schedules.map((s) => {
          const agent = agentMap.get(s['agent_id'] as string);
          return {
            ...s,
            agent_name: agent?.['name'] || 'Unknown',
            agent_status: agent?.['status'] || 'unknown',
            agent_type: mapAgentType(agent?.['metadata'] as Record<string, unknown> | null),
          };
        }),
      };
    },
  );

  // Set agent schedule
  app.post(
    '/api/v1/admin/agents/:id/schedule',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        schedule_type?: string;
        schedule_interval_minutes?: number;
        is_continuous?: boolean;
      };

      let nextRunAt: string | null = null;
      if (body.schedule_type === 'scheduled' && body.schedule_interval_minutes) {
        nextRunAt = new Date(Date.now() + body.schedule_interval_minutes * 60000).toISOString();
      }

      const result = await substrateQueryOne(
        `INSERT INTO agent_schedules (agent_id, schedule_type, schedule_interval_minutes, next_run_at, is_continuous)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_id) DO UPDATE SET
           schedule_type = EXCLUDED.schedule_type,
           schedule_interval_minutes = EXCLUDED.schedule_interval_minutes,
           next_run_at = EXCLUDED.next_run_at,
           is_continuous = EXCLUDED.is_continuous
         RETURNING *`,
        [id, body.schedule_type || 'manual', body.schedule_interval_minutes || null, nextRunAt, body.is_continuous || false],
      );

      return { schedule: result };
    },
  );

  // Reports metrics
  app.get(
    '/api/v1/admin/reports/metrics',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const [
        agents, executions,
        userCount, activeUsers, newUsers,
        ticketCount, openTickets,
      ] = await Promise.all([
        query<Record<string, unknown>>('SELECT id, status FROM forge_agents'),
        query<Record<string, unknown>>('SELECT id, status FROM forge_executions ORDER BY created_at DESC LIMIT 200'),
        substrateQueryOne<{ count: string }>('SELECT COUNT(*) as count FROM users'),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE last_login_at > NOW() - INTERVAL '24 hours'`),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`),
        substrateQueryOne<{ count: string }>('SELECT COUNT(*) as count FROM agent_tickets'),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*) as count FROM agent_tickets WHERE status IN ('open', 'in_progress')`),
      ]);

      return {
        users: {
          total: parseInt(userCount?.count || '0'),
          active_24h: parseInt(activeUsers?.count || '0'),
          new_7d: parseInt(newUsers?.count || '0'),
        },
        agents: {
          total: agents.length,
          active: agents.filter((a) => a['status'] === 'active').length,
          tasks_today: executions.filter((e) => {
            const d = new Date(e['created_at'] as string);
            return d.toDateString() === new Date().toDateString();
          }).length,
        },
        executions: {
          total: executions.length,
          completed: executions.filter((e) => e['status'] === 'completed').length,
          failed: executions.filter((e) => e['status'] === 'failed').length,
          running: executions.filter((e) => e['status'] === 'running' || e['status'] === 'pending').length,
        },
        tickets: {
          total: parseInt(ticketCount?.count || '0'),
          open: parseInt(openTickets?.count || '0'),
        },
      };
    },
  );

  // Reports feed — unified view of findings + executions
  app.get(
    '/api/v1/admin/reports/feed',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const qs = request.query as Record<string, string>;
      const page = parseInt(qs['page'] ?? '1');
      const limit = parseInt(qs['limit'] ?? '20');
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (qs['agent']) { params.push(qs['agent']); conditions.push(`agent_name = $${params.length}`); }
      if (qs['severity']) { params.push(qs['severity']); conditions.push(`severity = $${params.length}`); }
      if (qs['category']) { params.push(qs['category']); conditions.push(`category = $${params.length}`); }
      if (qs['search']) { params.push(`%${qs['search']}%`); conditions.push(`(finding ILIKE $${params.length} OR details ILIKE $${params.length})`); }
      if (qs['dateFrom']) { params.push(qs['dateFrom']); conditions.push(`created_at >= $${params.length}`); }
      if (qs['dateTo']) { params.push(qs['dateTo']); conditions.push(`created_at <= $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [items, countResult] = await Promise.all([
        substrateQuery<Record<string, unknown>>(
          `SELECT * FROM agent_findings ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_findings ${where}`, params),
      ]);

      const total = parseInt(countResult?.count || '0');
      return { items, total, page, limit, pagination: paginationResponse(total, page, limit) };
    },
  );

  // Feed agents list
  app.get(
    '/api/v1/admin/reports/feed/agents',
    { preHandler: [authMiddleware] },
    async () => {
      const rows = await substrateQuery<{ agent_name: string }>(
        `SELECT DISTINCT agent_name FROM agent_findings WHERE agent_name IS NOT NULL ORDER BY agent_name`,
      );
      return { agents: rows.map((r) => r.agent_name) };
    },
  );

  // Feed categories list
  app.get(
    '/api/v1/admin/reports/feed/categories',
    { preHandler: [authMiddleware] },
    async () => {
      const rows = await substrateQuery<{ category: string }>(
        `SELECT DISTINCT category FROM agent_findings WHERE category IS NOT NULL ORDER BY category`,
      );
      return { categories: rows.map((r) => r.category) };
    },
  );

  // Single finding detail
  app.get(
    '/api/v1/admin/reports/findings/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const finding = await substrateQueryOne<Record<string, unknown>>(
        `SELECT * FROM agent_findings WHERE id = $1`, [id],
      );
      if (!finding) return reply.code(404).send({ error: 'Finding not found' });
      return { finding };
    },
  );

  // Reports activity — recent executions as activity feed
  app.get(
    '/api/v1/admin/reports/activity',
    { preHandler: [authMiddleware] },
    async () => {
      const executions = await query<Record<string, unknown>>(
        `SELECT e.id, e.agent_id, e.status, e.started_at, e.completed_at, e.created_at, e.duration_ms, e.metadata,
                a.name as agent_name, a.metadata as agent_metadata
         FROM forge_executions e
         LEFT JOIN forge_agents a ON a.id = e.agent_id
         ORDER BY e.created_at DESC LIMIT 50`,
      );
      const activity = executions.map((e) => ({
        id: e['id'],
        agent_name: e['agent_name'] || 'Unknown',
        agent_type: mapAgentType(e['agent_metadata'] as Record<string, unknown> | null),
        task_type: (e['metadata'] as Record<string, unknown>)?.['task_type'] || 'execution',
        status: e['status'],
        started_at: e['started_at'] || e['created_at'],
        completed_at: e['completed_at'],
        duration_seconds: e['duration_ms'] ? Math.round((e['duration_ms'] as number) / 1000) : null,
        has_interventions: false,
      }));
      return { activity };
    },
  );

  // Analytics / convergence metrics
  app.get(
    '/api/v1/admin/metrics',
    { preHandler: [authMiddleware] },
    async () => {
      const [userCount, agentCount] = await Promise.all([
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM users`).catch(() => ({ count: '0' })),
        queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_agents WHERE status = 'active'`).catch(() => ({ count: '0' })),
      ]);
      return {
        users: { total: parseInt(userCount?.count || '0') },
        agents: { active: parseInt(agentCount?.count || '0') },
      };
    },
  );

  // Execution timeline — last 24 hours of executions for timeline visualization
  app.get(
    '/api/v1/admin/executions/timeline',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { hours = '24' } = request.query as { hours?: string };
      const hoursNum = Math.min(Math.max(parseInt(hours) || 24, 1), 72);

      const executions = await query<Record<string, unknown>>(
        `SELECT
          e.id, e.agent_id, e.status, e.started_at, e.completed_at,
          e.created_at, e.duration_ms, e.cost, e.input_tokens, e.output_tokens,
          a.name as agent_name,
          COALESCE((a.metadata->>'model_id')::text, m.name, 'unknown') as model_name
         FROM forge_executions e
         LEFT JOIN forge_agents a ON a.id = e.agent_id
         LEFT JOIN forge_models m ON m.id = a.model_id
         WHERE e.created_at > NOW() - make_interval(hours => $1)
         ORDER BY e.created_at ASC`,
        [hoursNum],
      );

      // Derive model tier from model name for color coding
      const items = executions.map((e) => {
        const modelName = String(e['model_name'] || 'unknown').toLowerCase();
        let modelTier: 'opus' | 'sonnet' | 'haiku' | 'unknown' = 'unknown';
        if (modelName.includes('opus')) modelTier = 'opus';
        else if (modelName.includes('sonnet')) modelTier = 'sonnet';
        else if (modelName.includes('haiku')) modelTier = 'haiku';

        return {
          id: e['id'],
          agent_id: e['agent_id'],
          agent_name: e['agent_name'] || 'Unknown',
          status: e['status'],
          model_tier: modelTier,
          started_at: e['started_at'] || e['created_at'],
          completed_at: e['completed_at'],
          created_at: e['created_at'],
          duration_ms: e['duration_ms'] ? Number(e['duration_ms']) : null,
          cost: e['cost'] ? Number(e['cost']) : 0,
          tokens: (Number(e['input_tokens']) || 0) + (Number(e['output_tokens']) || 0),
        };
      });

      return { executions: items, hours: hoursNum };
    },
  );
}
