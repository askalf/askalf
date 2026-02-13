/**
 * Platform Admin Routes
 * Ported from admin-hub.js — manages interventions, tickets, findings,
 * schedules, audit, and orchestration stats. Queries both Forge and Substrate DBs directly.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { substrateQuery, substrateQueryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/session-auth.js';
import { runDirectCliExecution } from '../runtime/worker.js';

// ============================================
// Helpers
// ============================================

function paginationResponse(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit) || 1;
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}

function mapAgentType(metadata: Record<string, unknown> | null): string {
  const typeMap: Record<string, string> = {
    development: 'dev', dev: 'dev', research: 'research',
    support: 'support', content: 'content', monitoring: 'monitor', monitor: 'monitor',
  };
  const raw = (metadata?.type as string) || '';
  return typeMap[raw.toLowerCase()] || 'custom';
}

// ============================================
// Routes
// ============================================

export async function platformAdminRoutes(app: FastifyInstance): Promise<void> {

  // ------------------------------------------
  // ORCHESTRATION OVERVIEW
  // ------------------------------------------

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

  // ------------------------------------------
  // INTERVENTIONS
  // ------------------------------------------

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

      const oldIntervention = await substrateQueryOne<{ id: string; status: string }>(
        `SELECT id, status FROM agent_interventions WHERE id = $1`,
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

      return { intervention: updated };
    },
  );

  // ------------------------------------------
  // TICKETS
  // ------------------------------------------

  app.get(
    '/api/v1/admin/tickets',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as {
        status?: string; source?: string; assigned_to?: string;
        filter?: string; page?: string; limit?: string;
      };
      const conditions: string[] = [];
      const params: unknown[] = [];
      const page = parseInt(qs.page ?? '1');
      const limit = parseInt(qs.limit ?? '20');
      const offset = (page - 1) * limit;

      if (qs.filter === 'open') {
        conditions.push(`status IN ('open', 'in_progress')`);
      }
      if (qs.status) {
        params.push(qs.status);
        conditions.push(`status = $${params.length}`);
      }
      if (qs.source && qs.source !== 'all') {
        params.push(qs.source);
        conditions.push(`source = $${params.length}`);
      }
      if (qs.assigned_to) {
        params.push(qs.assigned_to);
        conditions.push(`assigned_to = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [tickets, countResult] = await Promise.all([
        substrateQuery(
          `SELECT * FROM agent_tickets ${whereClause}
           ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
           created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        substrateQueryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM agent_tickets ${whereClause}`,
          params,
        ),
      ]);

      // Enrich tickets with linked execution info
      for (const ticket of tickets as Record<string, unknown>[]) {
        if (ticket['task_id']) {
          const exec = await queryOne<Record<string, unknown>>(
            `SELECT id, status, metadata, started_at, completed_at FROM forge_executions WHERE id = $1`,
            [ticket['task_id']],
          );
          if (exec) {
            ticket['task'] = {
              id: exec['id'],
              status: exec['status'],
              started_at: exec['started_at'],
              completed_at: exec['completed_at'],
            };
          }
        }
      }

      const total = parseInt(countResult?.count || '0');
      return { tickets, total, page, limit, pagination: paginationResponse(total, page, limit) };
    },
  );

  app.post(
    '/api/v1/admin/tickets',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const id = ulid();
      const createdBy = (body['created_by'] as string) || request.userId || 'admin';

      const ticket = await substrateQueryOne(
        `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to,
          agent_id, agent_name, is_agent_ticket, source, task_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          id,
          body['title'] || 'Untitled Ticket',
          body['description'] || null,
          body['status'] || 'open',
          body['priority'] || 'medium',
          body['category'] || null,
          createdBy,
          body['assigned_to'] || null,
          body['agent_id'] || null,
          body['agent_name'] || null,
          body['is_agent_ticket'] || false,
          body['source'] || 'human',
          body['task_id'] || null,
          JSON.stringify(body['metadata'] || {}),
        ],
      );

      void substrateQuery(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('ticket', $1, 'created', $2, $3, '{}', $4)`,
        [id, `human:${createdBy}`, createdBy, JSON.stringify({ title: body['title'], priority: body['priority'] })],
      ).catch(() => {});

      return reply.code(201).send({ ticket });
    },
  );

  app.patch(
    '/api/v1/admin/tickets/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const fields: string[] = [];
      const params: unknown[] = [];

      for (const key of ['status', 'priority', 'assigned_to', 'title', 'description', 'category', 'resolution']) {
        if (body[key] !== undefined) {
          params.push(body[key]);
          fields.push(`${key} = $${params.length}`);
        }
      }

      if (fields.length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      const oldTicket = await substrateQueryOne<Record<string, unknown>>(
        `SELECT id, status, priority, assigned_to, title FROM agent_tickets WHERE id = $1`,
        [id],
      );

      fields.push('updated_at = NOW()');
      params.push(id);

      const ticket = await substrateQueryOne(
        `UPDATE agent_tickets SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );

      if (!ticket) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }

      void substrateQuery(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('ticket', $1, $2, $3, $4, $5, $6)`,
        [
          id,
          body['status'] === 'resolved' ? 'resolved' : body['assigned_to'] ? 'assigned' : 'updated',
          `human:${request.userId || 'admin'}`,
          request.userId || null,
          JSON.stringify({ status: oldTicket?.['status'], priority: oldTicket?.['priority'] }),
          JSON.stringify(body),
        ],
      ).catch(() => {});

      return { ticket };
    },
  );

  app.delete(
    '/api/v1/admin/tickets/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const old = await substrateQueryOne<Record<string, unknown>>(
        `SELECT id, title, status, priority, assigned_to FROM agent_tickets WHERE id = $1`,
        [id],
      );
      if (!old) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }

      await substrateQuery(
        `UPDATE agent_tickets SET deleted_at = NOW(), status = 'closed', updated_at = NOW() WHERE id = $1`,
        [id],
      );

      void substrateQuery(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
         VALUES ('ticket', $1, 'deleted', $2, $3, '{"soft_deleted": true}')`,
        [id, `human:${request.userId || 'admin'}`, JSON.stringify({ status: old['status'], title: old['title'] })],
      ).catch(() => {});

      return { success: true, id, soft_deleted: true };
    },
  );

  // ------------------------------------------
  // FINDINGS
  // ------------------------------------------

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

  // ------------------------------------------
  // SCHEDULES
  // ------------------------------------------

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

  // ------------------------------------------
  // SCHEDULER CONTROL
  // ------------------------------------------

  app.get(
    '/api/v1/admin/reports/scheduler',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const [agents, continuous, scheduled] = await Promise.all([
        query<Record<string, unknown>>('SELECT id, name, status FROM forge_agents LIMIT 100'),
        substrateQuery<Record<string, unknown>>(
          `SELECT * FROM agent_schedules WHERE is_continuous = true`,
        ),
        substrateQuery<Record<string, unknown>>(
          `SELECT * FROM agent_schedules WHERE schedule_type = 'scheduled' AND next_run_at IS NOT NULL`,
        ),
      ]);

      const agentMap = new Map(agents.map((a) => [a['id'] as string, a]));

      return {
        running: schedulerRunning,
        continuousAgents: continuous.map((s) => {
          const agent = agentMap.get(s['agent_id'] as string);
          return { ...s, agent_name: agent?.['name'] || 'Unknown', agent_status: agent?.['status'] || 'unknown' };
        }),
        nextScheduledAgents: scheduled.map((s) => {
          const agent = agentMap.get(s['agent_id'] as string);
          return { ...s, agent_name: agent?.['name'] || 'Unknown', agent_status: agent?.['status'] || 'unknown' };
        }),
      };
    },
  );

  app.post(
    '/api/v1/admin/reports/scheduler',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const body = request.body as { action: 'start' | 'stop' };
      if (body.action === 'start') {
        schedulerRunning = true;
      } else if (body.action === 'stop') {
        schedulerRunning = false;
      }
      return { success: true, action: body.action, running: schedulerRunning };
    },
  );

  // ------------------------------------------
  // AUDIT LOG
  // ------------------------------------------

  app.get(
    '/api/v1/admin/audit',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as {
        entity_type?: string; entity_id?: string; actor?: string; action?: string;
        limit?: string; offset?: string;
      };
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (qs.entity_type) { params.push(qs.entity_type); conditions.push(`entity_type = $${params.length}`); }
      if (qs.entity_id) { params.push(qs.entity_id); conditions.push(`entity_id = $${params.length}`); }
      if (qs.actor) { params.push(qs.actor); conditions.push(`actor = $${params.length}`); }
      if (qs.action) { params.push(qs.action); conditions.push(`action = $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min(parseInt(qs.limit ?? '50'), 100);
      const offset = parseInt(qs.offset ?? '0') || 0;

      const [entries, countResult] = await Promise.all([
        substrateQuery(
          `SELECT id, entity_type, entity_id, action, actor, actor_id, old_value, new_value, execution_id, created_at
           FROM agent_audit_log ${where}
           ORDER BY created_at DESC
           LIMIT ${limit} OFFSET ${offset}`,
          params,
        ),
        substrateQueryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM agent_audit_log ${where}`, params),
      ]);

      return { audit_trail: entries, total: countResult?.total || 0, limit, offset };
    },
  );

  // ------------------------------------------
  // REPORTS / METRICS
  // ------------------------------------------

  app.get(
    '/api/v1/admin/reports/metrics',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const [
        agents, executions,
        userCount, activeUsers, newUsers,
        shardCount, highConfShards,
        chatSessions, chatMessages,
        ticketCount, openTickets,
      ] = await Promise.all([
        query<Record<string, unknown>>('SELECT id, status FROM forge_agents'),
        query<Record<string, unknown>>('SELECT id, status FROM forge_executions ORDER BY created_at DESC LIMIT 200'),
        substrateQueryOne<{ count: string }>('SELECT COUNT(*) as count FROM users'),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE last_login_at > NOW() - INTERVAL '24 hours'`),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`),
        substrateQueryOne<{ count: string }>('SELECT COUNT(*) as count FROM procedural_shards').catch(() => ({ count: '0' })),
        substrateQueryOne<{ count: string }>('SELECT COUNT(*) as count FROM procedural_shards WHERE confidence >= 0.8').catch(() => ({ count: '0' })),
        substrateQueryOne<{ count: string }>('SELECT COUNT(DISTINCT session_id) as count FROM chat_messages').catch(() => ({ count: '0' })),
        substrateQueryOne<{ count: string }>('SELECT COUNT(*) as count FROM chat_messages').catch(() => ({ count: '0' })),
        substrateQueryOne<{ count: string }>('SELECT COUNT(*) as count FROM agent_tickets'),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*) as count FROM agent_tickets WHERE status IN ('open', 'in_progress')`),
      ]);

      return {
        users: {
          total: parseInt(userCount?.count || '0'),
          active_24h: parseInt(activeUsers?.count || '0'),
          new_7d: parseInt(newUsers?.count || '0'),
        },
        shards: {
          total: parseInt(shardCount?.count || '0'),
          high_confidence: parseInt(highConfShards?.count || '0'),
        },
        chat: {
          sessions: parseInt(chatSessions?.count || '0'),
          messages: parseInt(chatMessages?.count || '0'),
        },
        agents: {
          total: agents.length,
          active: agents.filter((a) => a['status'] === 'active').length,
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

  // ------------------------------------------
  // TASKS (Execution enrichment)
  // ------------------------------------------

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

      const [tasks, countResult, agents] = await Promise.all([
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
        query<Record<string, unknown>>('SELECT id, name, metadata FROM forge_agents'),
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

  // ------------------------------------------
  // SCHEDULER DAEMON + INTERVENTION AUTO-HANDLER
  // ------------------------------------------

  startSchedulerDaemon();
}

// ============================================
// Scheduler daemon (runs inside Forge process)
// ============================================

let schedulerRunning = true;

const AUTO_APPROVE_PATTERNS = [
  /restart.*container/i,
  /install.*extension/i,
  /apply.*migration/i,
  /create.*index/i,
  /enable.*monitoring/i,
  /update.*schedule/i,
  /run.*backup/i,
];

async function processInterventions(): Promise<void> {
  try {
    const pending = await substrateQuery<Record<string, unknown>>(
      `SELECT id, agent_name, type, title, description, proposed_action, created_at
       FROM agent_interventions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`,
    );

    for (const intervention of pending) {
      const ageMinutes = (Date.now() - new Date(intervention['created_at'] as string).getTime()) / 60_000;

      // Auto-approve low-risk feedback/resource requests
      if (intervention['type'] === 'feedback' || intervention['type'] === 'resource') {
        const text = `${intervention['title']} ${intervention['description'] || ''} ${intervention['proposed_action'] || ''}`;
        if (AUTO_APPROVE_PATTERNS.some((p) => p.test(text))) {
          await substrateQuery(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved by system (low-risk operation)', responded_by = 'system:auto', responded_at = NOW() WHERE id = $1`,
            [intervention['id']],
          );
          console.log(`[Interventions] Auto-approved: ${intervention['title']} (${intervention['agent_name']})`);
          continue;
        }
      }

      // Auto-approve approval requests older than 30 minutes
      if (intervention['type'] === 'approval' && ageMinutes > 30) {
        await substrateQuery(
          `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
          [intervention['id']],
        );
        console.log(`[Interventions] Auto-approved (timeout): ${intervention['title']}`);
        continue;
      }

      // Escalate errors/escalations older than 60 min → create Overseer ticket
      if ((intervention['type'] === 'escalation' || intervention['type'] === 'error') && ageMinutes > 60) {
        try {
          await substrateQuery(
            `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, is_agent_ticket, source, metadata)
             VALUES ($1, $2, $3, 'open', 'urgent', 'escalation', 'system', 'Overseer', true, 'agent', $4)
             ON CONFLICT DO NOTHING`,
            [
              'INT-' + (intervention['id'] as string).substring(0, 20),
              `[ESCALATION] ${intervention['title']}`,
              `Agent ${intervention['agent_name']} requested intervention: ${intervention['description'] || intervention['title']}`,
              JSON.stringify({ intervention_id: intervention['id'], auto_escalated: true }),
            ],
          );
          await substrateQuery(
            `UPDATE agent_interventions SET status = 'resolved', human_response = 'Auto-escalated to Overseer ticket after 60min', responded_by = 'system:escalation', responded_at = NOW() WHERE id = $1`,
            [intervention['id']],
          );
        } catch { /* non-fatal */ }
        continue;
      }

      // Catch-all: auto-approve after 30 min
      if (ageMinutes > 30) {
        await substrateQuery(
          `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
          [intervention['id']],
        );
        console.log(`[Interventions] Auto-approved (catchall): ${intervention['title']}`);
      }
    }
  } catch (err) {
    console.error('[Interventions] Error processing interventions:', err);
  }
}

let tickCount = 0;

async function runSchedulerTick(): Promise<void> {
  if (!schedulerRunning) return;
  tickCount++;

  try {
    await processInterventions();

    const dueAgents = await substrateQuery<Record<string, unknown>>(
      `SELECT s.agent_id, s.schedule_type, s.schedule_interval_minutes, s.is_continuous
       FROM agent_schedules s WHERE s.next_run_at <= NOW()
       ORDER BY s.next_run_at ASC LIMIT 16`,
    );

    if (dueAgents.length === 0) {
      if (tickCount % 5 === 0) {
        const nextDue = await substrateQueryOne<{ next: string }>(`SELECT MIN(next_run_at) as next FROM agent_schedules`);
        console.log(`[Scheduler] Heartbeat #${tickCount} — next: ${nextDue?.next ? new Date(nextDue.next).toISOString() : 'none'}`);
      }
      return;
    }

    // Build batch of agents to execute
    interface ScheduledAgent {
      agentId: string;
      agentName: string;
      input: string;
      intervalMinutes: number;
      modelId?: string;
      systemPrompt?: string;
      maxBudget?: string;
    }
    const batchAgents: ScheduledAgent[] = [];

    for (const schedule of dueAgents) {
      const agentId = schedule['agent_id'] as string;
      const agent = await queryOne<Record<string, unknown>>(
        `SELECT id, name, status, model_id, system_prompt, max_cost_per_execution FROM forge_agents WHERE id = $1`,
        [agentId],
      );

      if (!agent || agent['status'] !== 'active') {
        continue;
      }

      const intervalMinutes = (schedule['schedule_interval_minutes'] as number) || 60;
      const input = `[SCHEDULED RUN - ${new Date().toISOString()}] You are running on a ${intervalMinutes}-minute schedule.

MANDATORY TICKET LIFECYCLE — Follow this exact order every run:

1. CHECK ASSIGNED TICKETS: Use ticket_ops action=list filter_assigned_to=YOUR_NAME filter_status=open to find work assigned to you. Also check filter_status=in_progress for your ongoing work.

2. PICK UP WORK: For each open ticket assigned to you, update it to in_progress with ticket_ops action=update ticket_id=ID status=in_progress BEFORE starting work.

3. DO THE WORK: Execute your core duties. Use your tools to investigate, fix, monitor, or build as needed.

4. RESOLVE WITH NOTES: When work is done, update the ticket with ticket_ops action=update ticket_id=ID status=resolved resolution="Detailed description of what you did and the outcome."

5. REPORT FINDINGS: Use finding_ops to report anything noteworthy (security issues, bugs, performance problems, optimization opportunities).

6. CREATE FOLLOW-UP TICKETS: If your work reveals new tasks needed, create tickets with ticket_ops action=create and assign them to the appropriate agent.

7. ROUTINE DUTIES: After ticket work, perform your standard monitoring/maintenance tasks.

Be efficient and concise. Every action you take must be tracked through a ticket.`;

      batchAgents.push({
        agentId,
        agentName: agent['name'] as string,
        input,
        intervalMinutes,
        modelId: (agent['model_id'] as string) ?? undefined,
        systemPrompt: (agent['system_prompt'] as string) ?? undefined,
        maxBudget: (agent['max_cost_per_execution'] as string) ?? undefined,
      });
    }

    if (batchAgents.length === 0) return;

    console.log(`[Scheduler] Dispatching ${batchAgents.length} agents: ${batchAgents.map((a) => a.agentName).join(', ')}`);

    // Dispatch each agent as individual CLI execution (batch API was removed)
    for (const agent of batchAgents) {
      const execId = ulid();
      const ownerId = 'system:scheduler';

      await queryOne(
        `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
         VALUES ($1, $2, $3, $4, 'pending', '{}', NOW()) RETURNING id`,
        [execId, agent.agentId, ownerId, agent.input],
      );

      void runDirectCliExecution(execId, agent.agentId, agent.input, ownerId, {
        modelId: agent.modelId,
        systemPrompt: agent.systemPrompt,
        maxBudgetUsd: agent.maxBudget,
      }).catch((err) => {
        console.error(`[Scheduler] CLI execution failed for ${agent.agentName}:`, err);
      });
    }

    // Update next_run_at for all dispatched agents
    for (const agent of batchAgents) {
      await substrateQuery(
        `UPDATE agent_schedules SET last_run_at = NOW(), next_run_at = NOW() + ($1 || ' minutes')::INTERVAL WHERE agent_id = $2`,
        [String(agent.intervalMinutes), agent.agentId],
      );
    }
  } catch (err) {
    console.error('[Scheduler] Tick error:', err);
  }
}

function startSchedulerDaemon(): void {
  console.log('[Scheduler] Agent scheduler daemon started (60s interval)');
  setInterval(runSchedulerTick, 60_000);
  setTimeout(runSchedulerTick, 10_000);
}
