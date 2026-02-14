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
  const raw = (metadata?.['type'] as string) || '';
  return typeMap[raw.toLowerCase()] || 'custom';
}

// ============================================
// Routes
// ============================================

// Transform forge_agents row → dashboard Agent shape
interface ForgeAgent {
  id: string; name: string; description: string | null; system_prompt: string | null;
  status: string; autonomy_level: number; metadata: Record<string, unknown> | null;
  provider_config: Record<string, unknown> | null; created_at: string; updated_at: string;
}
interface ForgeExecution {
  id: string; agent_id: string; status: string; input: string | null; output: string | null;
  error: string | null; started_at: string | null; completed_at: string | null;
  created_at: string; total_tokens: number | null; cost: string | null;
  duration_ms: number | null; metadata: Record<string, unknown> | null;
}

function mapAgentStatus(status: string): string {
  if (status === 'paused') return 'paused';
  if (status === 'archived') return 'idle';
  return 'idle';
}

function transformAgent(a: ForgeAgent, executions: ForgeExecution[] = [], pendingInterventions = 0) {
  const agentExecs = executions.filter(e => e.agent_id === a.id);
  const completed = agentExecs.filter(e => e.status === 'completed');
  const failed = agentExecs.filter(e => e.status === 'failed');
  const running = agentExecs.find(e => e.status === 'running' || e.status === 'pending');
  const lastCompleted = completed.sort((x, y) =>
    new Date(y.completed_at || y.created_at).getTime() - new Date(x.completed_at || x.created_at).getTime()
  )[0];

  return {
    id: a.id,
    name: a.name,
    type: mapAgentType(a.metadata),
    status: running ? 'running' : mapAgentStatus(a.status),
    description: a.description || '',
    system_prompt: a.system_prompt || '',
    schedule: null,
    config: a.provider_config || {},
    autonomy_level: a.autonomy_level ?? 2,
    is_decommissioned: a.status === 'archived',
    decommissioned_at: a.status === 'archived' ? a.updated_at : null,
    tasks_completed: completed.length,
    tasks_failed: failed.length,
    current_task: running ? running.id : null,
    last_run_at: lastCompleted?.completed_at || lastCompleted?.created_at || null,
    pending_interventions: pendingInterventions,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export async function platformAdminRoutes(app: FastifyInstance): Promise<void> {

  // ------------------------------------------
  // AGENTS
  // ------------------------------------------

  // List all agents with stats
  app.get(
    '/api/v1/admin/agents',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const agents = await query<ForgeAgent>('SELECT * FROM forge_agents ORDER BY name');
      const executions = await query<ForgeExecution>(
        `SELECT * FROM forge_executions WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 500`
      );
      const interventionCounts = await substrateQuery<{ agent_id: string; count: string }>(
        `SELECT agent_id, COUNT(*)::text as count FROM agent_interventions WHERE status = 'pending' GROUP BY agent_id`
      );
      const iMap = new Map(interventionCounts.map(r => [r.agent_id, parseInt(r.count)]));
      return { agents: agents.map(a => transformAgent(a, executions, iMap.get(a.id) || 0)) };
    }
  );

  // Agent detail
  app.get(
    '/api/v1/admin/agents/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const agent = await queryOne<ForgeAgent>('SELECT * FROM forge_agents WHERE id = $1', [id]);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const executions = await query<ForgeExecution>(
        'SELECT * FROM forge_executions WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50', [id]
      );
      const pendingCount = await substrateQueryOne<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM agent_interventions WHERE agent_id = $1 AND status = 'pending'`, [id]
      );
      const transformed = transformAgent(agent, executions, parseInt(pendingCount?.count || '0'));

      const logs = executions.map(exec => ({
        id: exec.id,
        created_at: exec.started_at || exec.created_at,
        level: exec.status === 'failed' ? 'error' : 'info',
        message: exec.status === 'failed'
          ? `Execution failed: ${exec.error || 'Unknown error'}`
          : `Execution ${exec.status}: ${(exec.input || '').substring(0, 100)}`,
        metadata: { execution_id: exec.id, status: exec.status, tokens: exec.total_tokens, cost: exec.cost, duration_ms: exec.duration_ms },
      })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const tasks = executions.map(exec => ({
        id: exec.id, agent_id: exec.agent_id, agent_name: agent.name,
        agent_type: mapAgentType(agent.metadata), type: (exec.metadata?.['task_type'] as string) || 'execution',
        status: exec.status, input: { prompt: exec.input || '' },
        output: exec.output ? { response: exec.output } : null,
        error: exec.error || null, started_at: exec.started_at || exec.created_at,
        completed_at: exec.completed_at || null,
        duration_seconds: exec.duration_ms ? Math.round(exec.duration_ms / 1000) : null,
        tokens_used: exec.total_tokens || 0, cost: parseFloat(exec.cost || '0'),
        metadata: exec.metadata || {}, created_at: exec.created_at,
      }));

      return { agent: transformed, logs, tasks };
    }
  );

  // Run agent
  app.post(
    '/api/v1/admin/agents/:id/run',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown> || {};
      const agent = await queryOne<{ id: string; name: string }>('SELECT id, name FROM forge_agents WHERE id = $1', [id]);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const prompt = (body['prompt'] as string) || ((typeof body['input'] === 'object' ? (body['input'] as Record<string, unknown>)?.['prompt'] : body['input']) as string) || 'Execute default task';
      const execId = ulid();
      await query(
        `INSERT INTO forge_executions (id, agent_id, status, input, created_at) VALUES ($1, $2, 'pending', $3, NOW())`,
        [execId, id, prompt]
      );
      void runDirectCliExecution(execId, id, prompt, request.userId || 'admin');
      return { execution: { id: execId, agent_id: id, status: 'pending' } };
    }
  );

  // Stop agent (pause)
  app.post(
    '/api/v1/admin/agents/:id/stop',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const agent = await queryOne<ForgeAgent>(`UPDATE forge_agents SET status = 'paused', updated_at = NOW() WHERE id = $1 RETURNING *`, [id]);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true, agent: transformAgent(agent) };
    }
  );

  // Decommission (archive)
  app.post(
    '/api/v1/admin/agents/:id/decommission',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await queryOne<{ id: string }>(`UPDATE forge_agents SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`, [id]);
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true };
    }
  );

  // Recommission (reactivate)
  app.post(
    '/api/v1/admin/agents/:id/recommission',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await queryOne<{ id: string }>(`UPDATE forge_agents SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING id`, [id]);
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true };
    }
  );

  // Delete agent
  app.delete(
    '/api/v1/admin/agents/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await queryOne<{ id: string }>('DELETE FROM forge_agents WHERE id = $1 RETURNING id', [id]);
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true };
    }
  );

  // Batch process all active agents
  app.post(
    '/api/v1/admin/agents/batch/process',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const agents = await query<{ id: string; name: string }>(`SELECT id, name FROM forge_agents WHERE status = 'active' ORDER BY name`);
      const results: { agent_id: string; agent_name: string; success: boolean; execution_id: string | null }[] = [];
      for (const agent of agents) {
        try {
          const execId = ulid();
          await query(
            `INSERT INTO forge_executions (id, agent_id, status, input, created_at) VALUES ($1, $2, 'pending', 'Scheduled batch execution', NOW())`,
            [execId, agent.id]
          );
          void runDirectCliExecution(execId, agent.id, 'Scheduled batch execution', request.userId || 'admin');
          results.push({ agent_id: agent.id, agent_name: agent.name, success: true, execution_id: execId });
        } catch {
          results.push({ agent_id: agent.id, agent_name: agent.name, success: false, execution_id: null });
        }
      }
      const succeeded = results.filter(r => r.success);
      return { results, processed: results.length, started: succeeded.length, agents: succeeded.map(r => r.agent_name) };
    }
  );

  // Process single agent
  app.post(
    '/api/v1/admin/agents/:id/process',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown> || {};
      const agent = await queryOne<{ id: string; name: string }>('SELECT id, name FROM forge_agents WHERE id = $1', [id]);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const execId = ulid();
      const input = (body['input'] as string) || 'Process task';
      await query(
        `INSERT INTO forge_executions (id, agent_id, status, input, created_at) VALUES ($1, $2, 'pending', $3, NOW())`,
        [execId, id, input]
      );
      void runDirectCliExecution(execId, id, input, request.userId || 'admin');
      return { success: true, execution: { id: execId, agent_id: id, status: 'pending' } };
    }
  );

  // Update agent model
  app.patch(
    '/api/v1/admin/agents/:id/model',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { model_id } = request.body as { model_id: string };
      const result = await queryOne<{ id: string }>(
        `UPDATE forge_agents SET model_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [model_id, id]
      );
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true };
    }
  );

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
  // FLEET MEMORY (proxy to /api/v1/forge/fleet/*)
  // ------------------------------------------

  app.get(
    '/api/v1/admin/memory/stats',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/forge/fleet/stats', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).headers(Object.fromEntries(Object.entries(res.headers).filter(([k]) => k.startsWith('content')))).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/memory/search',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as Record<string, string>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(qs)) { if (v) params.set(k, v); }
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/fleet/search?${params.toString()}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/memory/recent',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as Record<string, string>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(qs)) { if (v) params.set(k, v); }
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/fleet/recent?${params.toString()}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/memory/recalls',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as Record<string, string>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(qs)) { if (v) params.set(k, v); }
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/fleet/recalls?${params.toString()}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/memory/store',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/fleet/store', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  // ------------------------------------------
  // GIT SPACE (proxy to /api/v1/forge/git/*)
  // ------------------------------------------

  app.get(
    '/api/v1/admin/git-space/branches',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/forge/git/branches', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/git-space/diff/:branch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch } = request.params as { branch: string };
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/git/diff/${encodeURIComponent(branch)}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/git-space/health/:service',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { service } = request.params as { service: string };
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/git/health/${encodeURIComponent(service)}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/git-space/merge',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/git/merge', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/git-space/deploy',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/git/deploy', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/git-space/rebuild',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/git/rebuild', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/git-space/rebuild/:builderId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { builderId } = request.params as { builderId: string };
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/git/rebuild/${encodeURIComponent(builderId)}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.delete(
    '/api/v1/admin/git-space/rebuild/:taskId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as { taskId: string };
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/forge/git/rebuild/${encodeURIComponent(taskId)}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/git-space/rebuild/tasks',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/forge/git/rebuild/tasks', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/git-space/ai-review',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return { review_id: ulid(), status: 'pending', message: 'AI review initiated' };
    },
  );

  app.get(
    '/api/v1/admin/git-space/review-result/:id',
    { preHandler: [authMiddleware] },
    async () => {
      return { status: 'completed', summary: 'No AI review service configured yet.', issues: [], suggestions: [] };
    },
  );

  app.post(
    '/api/v1/admin/git-space/ai-review/chat',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return { response: 'AI review chat not yet configured.' };
    },
  );

  // ------------------------------------------
  // COORDINATION (stubs — source code lost from container rebuilds)
  // ------------------------------------------

  app.get(
    '/api/v1/admin/coordination/sessions',
    { preHandler: [authMiddleware] },
    async () => ({ sessions: [] }),
  );

  app.get(
    '/api/v1/admin/coordination/sessions/:id',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(404).send({ error: 'Coordination sessions not available' });
    },
  );

  app.post(
    '/api/v1/admin/coordination/sessions',
    { preHandler: [authMiddleware, requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(501).send({ error: 'Coordination sessions not yet re-implemented' });
    },
  );

  app.post(
    '/api/v1/admin/coordination/sessions/:id/cancel',
    { preHandler: [authMiddleware, requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(501).send({ error: 'Coordination sessions not yet re-implemented' });
    },
  );

  app.get(
    '/api/v1/admin/coordination/plans',
    { preHandler: [authMiddleware] },
    async () => ({ plans: [] }),
  );

  app.get(
    '/api/v1/admin/coordination/stats',
    { preHandler: [authMiddleware] },
    async () => ({
      activeSessions: 0,
      completedSessions: 0,
      totalPlans: 0,
      patterns: { pipeline: 0, 'fan-out': 0, consensus: 0 },
    }),
  );

  // ------------------------------------------
  // CONTENT & REPORTS FEED
  // ------------------------------------------

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

  // Promote finding to fact
  app.post(
    '/api/v1/admin/reports/findings/:id/promote',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const finding = await substrateQueryOne<Record<string, unknown>>(
        `SELECT * FROM agent_findings WHERE id = $1`, [id],
      );
      if (!finding) return reply.code(404).send({ error: 'Finding not found' });

      const factId = ulid();
      try {
        await substrateQuery(
          `INSERT INTO facts (id, content, source, confidence, metadata, created_at)
           VALUES ($1, $2, $3, 0.9, $4, NOW())
           ON CONFLICT DO NOTHING`,
          [factId, finding['finding'] || finding['details'], `finding:${id}`, JSON.stringify({ promoted_from: 'finding', finding_id: id, severity: finding['severity'], agent: finding['agent_name'] })],
        );
        return { success: true, factId };
      } catch {
        return { success: true, factId, alreadyExists: true };
      }
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

  // Content feed — same as reports feed (unified in Phase 5)
  app.get(
    '/api/v1/admin/content/feed',
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

  app.get(
    '/api/v1/admin/content/feed/agents',
    { preHandler: [authMiddleware] },
    async () => {
      const rows = await substrateQuery<{ agent_name: string }>(
        `SELECT DISTINCT agent_name FROM agent_findings WHERE agent_name IS NOT NULL ORDER BY agent_name`,
      );
      return { agents: rows.map((r) => r.agent_name) };
    },
  );

  app.get(
    '/api/v1/admin/content/feed/categories',
    { preHandler: [authMiddleware] },
    async () => {
      const rows = await substrateQuery<{ category: string }>(
        `SELECT DISTINCT category FROM agent_findings WHERE category IS NOT NULL ORDER BY category`,
      );
      return { categories: rows.map((r) => r.category) };
    },
  );

  // ------------------------------------------
  // TICKET NOTES
  // ------------------------------------------

  app.get(
    '/api/v1/admin/tickets/:id/notes',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const notes = await substrateQuery<Record<string, unknown>>(
        `SELECT * FROM agent_ticket_notes WHERE ticket_id = $1 ORDER BY created_at ASC`, [id],
      ).catch(() => [] as Record<string, unknown>[]);
      return { notes };
    },
  );

  app.post(
    '/api/v1/admin/tickets/:id/notes',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const { content } = request.body as { content: string };
      const noteId = ulid();
      const note = await substrateQueryOne<Record<string, unknown>>(
        `INSERT INTO agent_ticket_notes (id, ticket_id, content, author, created_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [noteId, id, content, request.userId || 'admin'],
      ).catch(() => ({ id: noteId, ticket_id: id, content, created_at: new Date().toISOString() }));
      return { note };
    },
  );

  // ------------------------------------------
  // ANALYTICS & CONVERGENCE
  // ------------------------------------------

  app.get(
    '/api/v1/admin/metrics',
    { preHandler: [authMiddleware] },
    async () => {
      const [userCount, shardCount, chatCount, agentCount] = await Promise.all([
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM users`).catch(() => ({ count: '0' })),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM shards`).catch(() => ({ count: '0' })),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM chat_messages`).catch(() => ({ count: '0' })),
        queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_agents WHERE status = 'active'`).catch(() => ({ count: '0' })),
      ]);
      return {
        users: { total: parseInt(userCount?.count || '0') },
        shards: { total: parseInt(shardCount?.count || '0') },
        chat: { messages: parseInt(chatCount?.count || '0') },
        agents: { active: parseInt(agentCount?.count || '0') },
      };
    },
  );

  app.get(
    '/api/v1/admin/waitlist',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const entries = await substrateQuery<Record<string, unknown>>(
        `SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 100`,
      ).catch(() => [] as Record<string, unknown>[]);
      return { entries };
    },
  );

  app.post(
    '/api/v1/admin/waitlist/:entryId/send-invite',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { entryId } = request.params as { entryId: string };
      await substrateQuery(`UPDATE waitlist SET invited_at = NOW() WHERE id = $1`, [entryId]).catch(() => {});
      return { success: true };
    },
  );

  app.post(
    '/api/v1/admin/waitlist/:entryId/send-rejection',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { entryId } = request.params as { entryId: string };
      await substrateQuery(`UPDATE waitlist SET rejected_at = NOW() WHERE id = $1`, [entryId]).catch(() => {});
      return { success: true };
    },
  );

  app.get(
    '/api/v1/admin/cycle-history',
    { preHandler: [authMiddleware] },
    async () => {
      const runs = await substrateQuery<Record<string, unknown>>(
        `SELECT * FROM convergence_runs ORDER BY created_at DESC LIMIT 20`,
      ).catch(() => [] as Record<string, unknown>[]);
      return { runs };
    },
  );

  app.get(
    '/api/v1/admin/worker-health',
    { preHandler: [authMiddleware] },
    async () => {
      // Check BullMQ worker health by querying Redis or just return basic status
      return {
        status: 'healthy',
        workers: {
          crystallize: { status: 'active', lastRun: null },
          promote: { status: 'active', lastRun: null },
          decay: { status: 'active', lastRun: null },
        },
      };
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
