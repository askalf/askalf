/**
 * Platform Admin — Agent CRUD, run, stop, decommission, batch, model update
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/auth.js';
import { runDirectCliExecution } from '../../runtime/worker.js';
import { type ForgeAgent, type ForgeExecution, transformAgent, mapAgentType } from './utils.js';

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {

  // List all agents with stats (optimized — SQL aggregation, no full execution rows)
  // In-memory cache to avoid hammering DB on 15s dashboard polls
  let agentsCache: { data: unknown; ts: number } | null = null;
  const AGENTS_CACHE_TTL = 10_000; // 10s — dashboard polls every 15s

  app.get(
    '/api/v1/admin/agents',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const qs = request.query as { status?: string; include_decommissioned?: string; limit?: string; offset?: string };
      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);
      const isPaginated = qs.limit !== undefined || qs.offset !== undefined;

      // Only use cache for the default (no-filter, no-pagination) request
      if (!qs.status && qs.include_decommissioned !== 'true' && !isPaginated && agentsCache && Date.now() - agentsCache.ts < AGENTS_CACHE_TTL) {
        return agentsCache.data;
      }

      let whereClause = '';
      const params: unknown[] = [];
      // Always exclude soft-deleted agents unless include_deleted is explicitly true
      const includeDeleted = (qs as { include_deleted?: string }).include_deleted === 'true';
      if (qs.status) {
        params.push(qs.status);
        whereClause = `WHERE status = $${params.length}`;
      }
      if (qs.include_decommissioned !== 'true' && !whereClause) {
        whereClause = `WHERE (is_decommissioned IS NULL OR is_decommissioned = false)`;
      } else if (qs.include_decommissioned !== 'true' && whereClause) {
        whereClause += ` AND (is_decommissioned IS NULL OR is_decommissioned = false)`;
      }
      if (!includeDeleted) {
        whereClause = whereClause ? `${whereClause} AND deleted_at IS NULL` : `WHERE deleted_at IS NULL`;
      }

      const countParams = [...params];
      params.push(limit, offset);

      // Single query: agents + aggregated execution stats + running exec + interventions + schedules
      const [agents, agentTotal, execStats, runningExecs, interventionCounts, schedules] = await Promise.all([
        query<ForgeAgent>(`SELECT * FROM forge_agents ${whereClause} ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
        query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM forge_agents ${whereClause}`, countParams),
        query<{ agent_id: string; completed: string; failed: string; last_completed_at: string | null }>(
          `SELECT agent_id,
                  COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
                  COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
                  MAX(CASE WHEN status = 'completed' THEN COALESCE(completed_at, created_at) END)::text AS last_completed_at
           FROM forge_executions
           WHERE created_at > NOW() - INTERVAL '7 days'
           GROUP BY agent_id`
        ),
        query<{ agent_id: string; id: string }>(
          `SELECT agent_id, id FROM forge_executions WHERE status IN ('running', 'pending') ORDER BY created_at DESC`
        ),
        substrateQuery<{ agent_id: string; count: string }>(
          `SELECT agent_id, COUNT(*)::text as count FROM agent_interventions WHERE status = 'pending' GROUP BY agent_id`
        ),
        substrateQuery<{ agent_id: string; schedule_type: string; schedule_interval_minutes: number | null }>(
          `SELECT agent_id, schedule_type, schedule_interval_minutes FROM agent_schedules`
        ),
      ]);

      const total = parseInt(agentTotal[0]?.count ?? '0', 10);
      const statsMap = new Map(execStats.map(r => [r.agent_id, r]));
      const runningMap = new Map<string, string>();
      for (const r of runningExecs) {
        if (!runningMap.has(r.agent_id)) runningMap.set(r.agent_id, r.id);
      }
      const iMap = new Map(interventionCounts.map(r => [r.agent_id, parseInt(r.count)]));
      const schedMap = new Map(schedules.map(r => [r.agent_id, r]));

      const result = {
        agents: agents.map(a => {
          const stats = statsMap.get(a.id);
          const running = runningMap.get(a.id);
          const sched = schedMap.get(a.id);
          const scheduleLabel = sched
            ? (sched.schedule_type === 'scheduled' && sched.schedule_interval_minutes
              ? `every ${sched.schedule_interval_minutes}m`
              : sched.schedule_type)
            : null;
          return {
            id: a.id,
            name: a.name,
            type: a.type || mapAgentType(a.metadata),
            status: running ? 'running' : (a.status === 'paused' ? 'paused' : 'idle'),
            description: a.description || '',
            system_prompt: a.system_prompt || '',
            schedule: scheduleLabel,
            config: a.provider_config || {},
            enabled_tools: a.enabled_tools || [],
            autonomy_level: a.autonomy_level ?? 2,
            is_decommissioned: a.status === 'archived',
            decommissioned_at: a.status === 'archived' ? a.updated_at : null,
            tasks_completed: parseInt(stats?.completed || '0'),
            tasks_failed: parseInt(stats?.failed || '0'),
            current_task: running || null,
            last_run_at: stats?.last_completed_at || null,
            pending_interventions: iMap.get(a.id) || 0,
            created_at: a.created_at,
            updated_at: a.updated_at,
            metadata: a.metadata || {},
            model_id: a.model_id || null,
            raw_status: a.status,
          };
        }),
        total,
        limit,
        offset,
      };

      // Cache the default (no-filter, no-pagination) result
      if (!qs.status && qs.include_decommissioned !== 'true' && !isPaginated) {
        agentsCache = { data: result, ts: Date.now() };
      }

      return result;
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

  // Create agent (admin — sets owner_id to system:forge for admin-created agents)
  app.post(
    '/api/v1/admin/agents',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> || {};
      if (!body['name'] || typeof body['name'] !== 'string' || !(body['name'] as string).trim()) {
        return reply.code(400).send({ error: 'Validation Error', message: 'name is required' });
      }
      const id = ulid();
      const slug = ((body['name'] as string) || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const agent = await queryOne<ForgeAgent>(
        `INSERT INTO forge_agents (id, owner_id, name, slug, description, system_prompt, autonomy_level, model_id,
          enabled_tools, max_iterations, max_cost_per_execution, metadata, status, type)
         VALUES ($1, 'system:forge', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12) RETURNING *`,
        [
          id,
          body['name'] || 'New Agent',
          slug,
          body['description'] || '',
          body['systemPrompt'] || body['system_prompt'] || '',
          body['autonomyLevel'] ?? body['autonomy_level'] ?? 2,
          body['modelId'] || body['model_id'] || null,
          body['enabledTools'] || body['enabled_tools'] || [],
          body['maxIterations'] ?? body['max_iterations'] ?? 15,
          body['maxCostPerExecution'] ?? body['max_cost_per_execution'] ?? 1.0,
          JSON.stringify(body['metadata'] || {}),
          (body['metadata'] as Record<string, unknown>)?.['type'] || body['type'] || 'custom',
        ]
      );
      if (!agent) return reply.code(500).send({ error: 'Failed to create agent' });
      return reply.code(201).send({ agent: transformAgent(agent) });
    }
  );

  // Create execution (admin — no owner_id check)
  app.post(
    '/api/v1/admin/executions',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> || {};
      const agentId = body['agentId'] as string;
      const input = body['input'] as string;
      if (!agentId || !input) return reply.code(400).send({ error: 'agentId and input required' });

      const agent = await queryOne<{ id: string; name: string }>('SELECT id, name FROM forge_agents WHERE id = $1', [agentId]);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const execId = ulid();
      await query(
        `INSERT INTO forge_executions (id, agent_id, owner_id, status, input, metadata, started_at) VALUES ($1, $2, $3, 'pending', $4, $5, NOW())`,
        [execId, agentId, request.userId || 'admin', input, JSON.stringify(body['metadata'] || {})]
      );
      void runDirectCliExecution(execId, agentId, input, request.userId || 'admin');
      return { execution: { id: execId, agent_id: agentId, status: 'pending' } };
    }
  );

  // Create batch executions (admin — no owner_id check)
  app.post(
    '/api/v1/admin/executions/batch',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { executions?: Array<{ agentId: string; input: string; metadata?: Record<string, unknown> }> } || {};
      const executions = body.executions || [];

      if (!Array.isArray(executions) || executions.length === 0) {
        return reply.code(400).send({ error: 'executions array required and must not be empty' });
      }

      if (executions.length > 100) {
        return reply.code(400).send({ error: 'Maximum 100 executions per batch' });
      }

      // Validate all executions have required fields
      for (let i = 0; i < executions.length; i++) {
        const exec = executions[i];
        if (!exec?.agentId || !exec?.input) {
          return reply.code(400).send({ error: `Execution at index ${i} missing agentId or input` });
        }
        if (exec.input.length > 100_000) {
          return reply.code(400).send({ error: `Execution at index ${i} input exceeds maximum length of 100000 characters` });
        }
      }

      // Verify all agents exist
      const agentIds = [...new Set(executions.map(e => e.agentId))];
      const agents = await query<{ id: string; name: string }>(
        `SELECT id, name FROM forge_agents WHERE id = ANY($1)`,
        [agentIds]
      );
      const agentMap = new Map(agents.map(a => [a.id, a.name]));

      for (const exec of executions) {
        if (!agentMap.has(exec.agentId)) {
          return reply.code(404).send({ error: `Agent ${exec.agentId} not found` });
        }
      }

      // Create all executions and launch them
      const results: { id: string; agent_id: string; agent_name: string; status: string }[] = [];
      const userId = request.userId || 'admin';

      for (const exec of executions) {
        const execId = ulid();
        await query(
          `INSERT INTO forge_executions (id, agent_id, owner_id, status, input, metadata, started_at) VALUES ($1, $2, $3, 'pending', $4, $5, NOW())`,
          [execId, exec.agentId, userId, exec.input, JSON.stringify(exec.metadata || {})]
        );
        void runDirectCliExecution(execId, exec.agentId, exec.input, userId);
        results.push({
          id: execId,
          agent_id: exec.agentId,
          agent_name: agentMap.get(exec.agentId) || 'unknown',
          status: 'pending'
        });
      }

      return { executions: results, count: results.length };
    }
  );

  // List executions (admin — no owner_id filter)
  app.get(
    '/api/v1/admin/executions',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const qs = request.query as { agentId?: string; limit?: string };
      const limit = Math.max(1, Math.min(parseInt(qs.limit || '100') || 100, 500));
      let sql = `SELECT * FROM forge_executions`;
      const params: unknown[] = [];
      if (qs.agentId) {
        params.push(qs.agentId);
        sql += ` WHERE agent_id = $1`;
      }
      params.push(limit);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const executions = await query<ForgeExecution>(sql, params);
      return { executions };
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
        `INSERT INTO forge_executions (id, agent_id, status, input, started_at) VALUES ($1, $2, 'pending', $3, NOW())`,
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
      const result = await queryOne<{ id: string }>(`UPDATE forge_agents SET status = 'active', dispatch_enabled = true, updated_at = NOW() WHERE id = $1 RETURNING id`, [id]);
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true };
    }
  );

  // Generic update agent (admin — no owner_id filter)
  app.put(
    '/api/v1/admin/agents/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown> || {};
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      for (const field of ['name', 'description', 'system_prompt', 'model_id', 'status', 'autonomy_level', 'dispatch_enabled', 'dispatch_mode', 'schedule_interval_minutes'] as const) {
        if (body[field] !== undefined) {
          sets.push(`${field} = $${idx}`);
          params.push(body[field]);
          idx++;
        }
      }
      if (body['metadata'] !== undefined) {
        sets.push(`metadata = metadata || $${idx}::jsonb`);
        params.push(JSON.stringify(body['metadata']));
        idx++;
      }
      if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      sets.push(`updated_at = NOW()`);
      params.push(id);
      const agent = await queryOne<ForgeAgent>(
        `UPDATE forge_agents SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params
      );
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      return { agent: transformAgent(agent) };
    }
  );

  // Soft delete agent (preserves execution history)
  app.delete(
    '/api/v1/admin/agents/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await queryOne<{ id: string }>(
        `UPDATE forge_agents SET deleted_at = NOW(), status = 'archived', updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id],
      );
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return reply.code(204).send();
    }
  );

  // Restore soft-deleted agent
  app.post(
    '/api/v1/admin/agents/:id/restore',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await queryOne<{ id: string }>(
        `UPDATE forge_agents SET deleted_at = NULL, status = 'active', updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`,
        [id],
      );
      if (!result) return reply.code(404).send({ error: 'Deleted agent not found' });
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
            `INSERT INTO forge_executions (id, agent_id, status, input, started_at) VALUES ($1, $2, 'pending', 'Scheduled batch execution', NOW())`,
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
        `INSERT INTO forge_executions (id, agent_id, status, input, started_at) VALUES ($1, $2, 'pending', $3, NOW())`,
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
        `UPDATE forge_agents SET model_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [model_id || null, id]
      );
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true };
    }
  );

  // Update agent settings (cost limit, max iterations, description)
  app.patch(
    '/api/v1/admin/agents/:id/settings',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (body['max_cost_per_execution'] !== undefined) {
        const val = Number(body['max_cost_per_execution']);
        if (isNaN(val) || val < 0) return reply.code(400).send({ error: 'Invalid cost limit' });
        updates.push(`max_cost_per_execution = $${paramIdx++}`);
        values.push(val);
      }
      if (body['max_iterations'] !== undefined) {
        const val = Number(body['max_iterations']);
        if (isNaN(val) || val < 1) return reply.code(400).send({ error: 'Invalid max iterations' });
        updates.push(`max_iterations = $${paramIdx++}`);
        values.push(val);
      }
      if (body['description'] !== undefined) {
        updates.push(`description = $${paramIdx++}`);
        values.push(String(body['description']));
      }
      if (body['name'] !== undefined) {
        const name = String(body['name']).trim();
        if (!name) return reply.code(400).send({ error: 'Name cannot be empty' });
        updates.push(`name = $${paramIdx++}`);
        values.push(name);
      }
      if (body['system_prompt'] !== undefined) {
        const sp = String(body['system_prompt']);
        if (sp.length > 10240) return reply.code(400).send({ error: 'system_prompt exceeds 10240 chars' });
        updates.push(`system_prompt = $${paramIdx++}`);
        values.push(sp);
      }
      if (body['enabled_tools'] !== undefined) {
        if (!Array.isArray(body['enabled_tools'])) return reply.code(400).send({ error: 'enabled_tools must be an array' });
        updates.push(`enabled_tools = $${paramIdx++}`);
        values.push(JSON.stringify(body['enabled_tools']));
      }
      if (body['autonomy_level'] !== undefined) {
        const val = Number(body['autonomy_level']);
        if (isNaN(val) || val < 0 || val > 5) return reply.code(400).send({ error: 'autonomy_level must be 0–5' });
        updates.push(`autonomy_level = $${paramIdx++}`);
        values.push(Math.round(val));
      }

      if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      updates.push(`updated_at = NOW()`);
      values.push(id);

      const result = await queryOne<{ id: string }>(
        `UPDATE forge_agents SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id`,
        values,
      );
      if (!result) return reply.code(404).send({ error: 'Agent not found' });
      return { success: true };
    }
  );
}
