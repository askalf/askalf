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
import { runDirectCliExecution, runCliQuery } from '../runtime/worker.js';
import { detectCapabilities, getAgentCapabilities, findAgentsWithCapability, detectAllCapabilities } from '../orchestration/capability-registry.js';
import { processFeedback, getAgentFeedbackStats } from '../learning/feedback-processor.js';
import { getEventBus, type ForgeEvent } from '../orchestration/event-bus.js';
import { setContext, getContext, getContextList, appendContext, listContextKeys, createHandoff, getHandoff } from '../orchestration/shared-context.js';
import { proposePromptRevision, applyPromptRevision, rejectPromptRevision, getPromptRevisions } from '../learning/prompt-rewriter.js';
import { orchestrateFromNL, getOrchestrationStatus } from '../orchestration/nl-orchestrator.js';
import { createChatSession, getChatSession, listChatSessions, addModeratorMessage, getAgentResponse, runChatRound, endChatSession } from '../orchestration/multi-agent-chat.js';
import { proposeGoals, approveGoal, rejectGoal, getAgentGoals } from '../orchestration/goal-proposer.js';
import { selectOptimalModel, getCostDashboard, getModelRecommendations, recordCostSample } from '../orchestration/cost-router.js';
import { searchNodes, getNodeNeighborhood, getGraphStats } from '../orchestration/knowledge-graph.js';
import { runHealthCheck, getLastHealthReport } from '../orchestration/monitoring-agent.js';
import { cloneAgent, runExperiment, getExperiments, promoteVariant } from '../orchestration/evolution.js';
import { getExecutionEvents, getSessionEvents, getRecentEvents, getFleetLeaderboard, getEventLogStats } from '../orchestration/event-log.js';

// In-memory store for AI code reviews (transient — single instance, client polls max 10 min)
const reviewStore = new Map<string, {
  status: 'pending' | 'completed' | 'failed';
  branch?: string;
  diff?: string;
  result?: { summary: string; issues: Array<{ severity: string; file: string; line: number | null; message: string }>; suggestions: Array<{ file: string; message: string }>; approved: boolean };
  rawOutput?: string;
  error?: string;
}>();

const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the git diff below and return ONLY valid JSON (no markdown fences, no extra text):
{
  "summary": "1-2 sentence overview of changes",
  "issues": [{ "severity": "error|warning|info", "file": "path/to/file", "line": null, "message": "description of the issue" }],
  "suggestions": [{ "file": "path/to/file", "message": "improvement suggestion" }],
  "approved": true
}
Focus on: bugs, security vulnerabilities, performance problems, code style issues, and correctness. Set approved to false if there are any error-severity issues. Return an empty issues/suggestions array if the code looks good.`;

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
        `UPDATE forge_agents SET model_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [model_id || null, id]
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
  // DATA RETENTION CLEANUP
  // ------------------------------------------

  app.post(
    '/api/v1/admin/retention-cleanup',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const RETENTION_DAYS = 90;
      const EVENT_RETENTION_DAYS = 30;
      const results: Record<string, number> = {};

      const forgeTables = [
        { name: 'forge_audit_log', days: RETENTION_DAYS },
        { name: 'forge_event_log', days: EVENT_RETENTION_DAYS },
        { name: 'forge_cost_events', days: RETENTION_DAYS },
      ];

      for (const t of forgeTables) {
        try {
          const deleted = await query(
            `DELETE FROM ${t.name} WHERE created_at < NOW() - INTERVAL '${t.days} days' RETURNING id`
          );
          results[t.name] = deleted?.length ?? 0;
        } catch {
          results[t.name] = -1; // table may not exist
        }
      }

      return { success: true, pruned: results, retention_days: RETENTION_DAYS };
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
      const headers = { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' };
      const encoded = encodeURIComponent(branch);
      // Dashboard expects diff + commits + files in one response
      const [diffRes, logRes, filesRes] = await Promise.all([
        app.inject({ method: 'GET', url: `/api/v1/forge/git/diff/${encoded}`, headers }),
        app.inject({ method: 'GET', url: `/api/v1/forge/git/log/${encoded}`, headers }),
        app.inject({ method: 'GET', url: `/api/v1/forge/git/files/${encoded}`, headers }),
      ]);
      if (diffRes.statusCode !== 200) {
        return reply.code(diffRes.statusCode).send(diffRes.json());
      }
      const diff = diffRes.json() as Record<string, unknown>;
      const log = logRes.statusCode === 200 ? (logRes.json() as Record<string, unknown>) : {};
      const files = filesRes.statusCode === 200 ? (filesRes.json() as Record<string, unknown>) : {};
      return reply.send({
        ...diff,
        commits: log['commits'] || [],
        files: files['files'] || [],
      });
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch, diff } = request.body as { branch?: string; diff?: string };
      if (!diff) {
        return reply.status(400).send({ error: 'diff is required' });
      }

      const reviewId = ulid();
      reviewStore.set(reviewId, { status: 'pending', branch: branch || 'unknown', diff });

      // Fire async via CLI (uses OAuth — no API key cost)
      void (async () => {
        try {
          const prompt = `${REVIEW_SYSTEM_PROMPT}\n\nBranch: ${branch || 'unknown'}\n\n${diff}`;
          const result = await runCliQuery(prompt, {
            maxTurns: 1,
            timeout: 120_000,
            systemPrompt: 'You are an expert code reviewer. Return only valid JSON, no markdown fences.',
          });

          if (result.isError) {
            throw new Error(result.output || 'CLI execution failed');
          }

          // Parse JSON from response (strip markdown fences if present)
          let jsonText = result.output.trim();
          if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          }
          // Extract JSON if surrounded by other text
          const firstBrace = jsonText.indexOf('{');
          const lastBrace = jsonText.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            jsonText = jsonText.substring(firstBrace, lastBrace + 1);
          }
          const parsed = JSON.parse(jsonText);

          const entry = reviewStore.get(reviewId);
          if (entry) {
            entry.status = 'completed';
            entry.result = {
              summary: parsed.summary || 'Review complete.',
              issues: Array.isArray(parsed.issues) ? parsed.issues : [],
              suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
              approved: Boolean(parsed.approved),
            };
            entry.rawOutput = result.output;
          }
        } catch (err) {
          console.error(`[AI Review] Failed for ${reviewId}:`, err);
          const entry = reviewStore.get(reviewId);
          if (entry) {
            entry.status = 'failed';
            entry.error = err instanceof Error ? err.message : String(err);
          }
        }
      })();

      return reply.status(202).send({ review_id: reviewId, status: 'pending', message: 'AI review initiated' });
    },
  );

  app.get(
    '/api/v1/admin/git-space/review-result/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const entry = reviewStore.get(id);

      if (!entry) {
        return reply.status(404).send({ error: 'Review not found' });
      }

      if (entry.status === 'pending') {
        return reply.send({ status: 'pending' });
      }

      if (entry.status === 'failed') {
        return reply.send({ status: 'failed', error: entry.error || 'Unknown error' });
      }

      return reply.send({
        status: 'completed',
        summary: entry.result?.summary || '',
        issues: entry.result?.issues || [],
        suggestions: entry.result?.suggestions || [],
        approved: entry.result?.approved ?? true,
      });
    },
  );

  app.post(
    '/api/v1/admin/git-space/ai-review/chat',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { review_id, message } = request.body as { review_id?: string; message?: string };
      if (!review_id || !message) {
        return reply.status(400).send({ error: 'review_id and message are required' });
      }

      const entry = reviewStore.get(review_id);
      if (!entry) {
        return reply.status(404).send({ error: 'Review not found' });
      }

      try {
        // Build context: original diff + review result + user follow-up
        let context = '';
        if (entry.diff) {
          context += `Original diff for branch ${entry.branch || 'unknown'}:\n\n${entry.diff}\n\n`;
        }
        if (entry.result) {
          context += `Previous review result:\n${JSON.stringify(entry.result, null, 2)}\n\n`;
        }
        if (entry.rawOutput) {
          context += `Raw review output:\n${entry.rawOutput}\n\n`;
        }

        const prompt = `${context}User follow-up question: ${message}\n\nRespond helpfully about the code review.`;

        const result = await runCliQuery(prompt, {
          maxTurns: 1,
          timeout: 60_000,
          systemPrompt: 'You are an expert code reviewer discussing a previous review. Be concise and helpful.',
        });

        if (result.isError) {
          throw new Error(result.output || 'CLI execution failed');
        }

        return reply.send({ response: result.output });
      } catch (err) {
        console.error(`[AI Review Chat] Failed:`, err);
        return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ------------------------------------------
  // COORDINATION (multi-agent orchestration)
  // ------------------------------------------

  // List all coordination sessions
  app.get(
    '/api/v1/admin/coordination/sessions',
    { preHandler: [authMiddleware] },
    async () => {
      const sessions = await query<{
        id: string; title: string; pattern: string; lead_agent_id: string;
        lead_agent_name: string; status: string; summary: string | null;
        started_at: string; completed_at: string | null; created_at: string;
      }>(`SELECT * FROM coordination_sessions ORDER BY created_at DESC LIMIT 100`);

      // Attach tasks to each session
      const sessionIds = sessions.map(s => s.id);
      const tasks = sessionIds.length > 0
        ? await query<{
            id: string; session_id: string; title: string; description: string | null;
            assigned_agent: string; assigned_agent_id: string | null; dependencies: string[];
            status: string; result: string | null; error: string | null;
          }>(`SELECT * FROM coordination_tasks WHERE session_id = ANY($1) ORDER BY created_at`, [sessionIds])
        : [];

      const tasksBySession = new Map<string, typeof tasks>();
      for (const t of tasks) {
        const arr = tasksBySession.get(t.session_id) || [];
        arr.push(t);
        tasksBySession.set(t.session_id, arr);
      }

      return {
        sessions: sessions.map(s => ({
          id: s.id,
          planId: s.id,
          leadAgentId: s.lead_agent_id,
          leadAgentName: s.lead_agent_name,
          status: s.status,
          startedAt: s.started_at,
          completedAt: s.completed_at,
          summary: s.summary,
          plan: {
            id: s.id,
            title: s.title,
            pattern: s.pattern,
            leadAgentId: s.lead_agent_id,
            leadAgentName: s.lead_agent_name,
            tasks: (tasksBySession.get(s.id) || []).map(t => ({
              id: t.id,
              title: t.title,
              description: t.description || '',
              assignedAgent: t.assigned_agent,
              assignedAgentId: t.assigned_agent_id || '',
              dependencies: t.dependencies || [],
              status: t.status,
              result: t.result,
              error: t.error,
            })),
            status: s.status === 'active' ? 'executing' : s.status,
            createdAt: s.created_at,
          },
        })),
      };
    },
  );

  // Get single session detail
  app.get(
    '/api/v1/admin/coordination/sessions/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const session = await queryOne<{
        id: string; title: string; pattern: string; lead_agent_id: string;
        lead_agent_name: string; status: string; summary: string | null;
        started_at: string; completed_at: string | null; created_at: string;
      }>(`SELECT * FROM coordination_sessions WHERE id = $1`, [id]);

      if (!session) return reply.code(404).send({ error: 'Session not found' });

      const tasks = await query<{
        id: string; session_id: string; title: string; description: string | null;
        assigned_agent: string; assigned_agent_id: string | null; dependencies: string[];
        status: string; result: string | null; error: string | null;
      }>(`SELECT * FROM coordination_tasks WHERE session_id = $1 ORDER BY created_at`, [id]);

      return {
        session: {
          id: session.id,
          planId: session.id,
          leadAgentId: session.lead_agent_id,
          leadAgentName: session.lead_agent_name,
          status: session.status,
          startedAt: session.started_at,
          completedAt: session.completed_at,
          summary: session.summary,
          plan: {
            id: session.id,
            title: session.title,
            pattern: session.pattern,
            leadAgentId: session.lead_agent_id,
            leadAgentName: session.lead_agent_name,
            tasks: tasks.map(t => ({
              id: t.id,
              title: t.title,
              description: t.description || '',
              assignedAgent: t.assigned_agent,
              assignedAgentId: t.assigned_agent_id || '',
              dependencies: t.dependencies || [],
              status: t.status,
              result: t.result,
              error: t.error,
            })),
            status: session.status === 'active' ? 'executing' : session.status,
            createdAt: session.created_at,
          },
        },
      };
    },
  );

  // Create coordination session (start team)
  app.post(
    '/api/v1/admin/coordination/sessions',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        leadAgentId: string; leadAgentName: string; title: string;
        pattern: 'pipeline' | 'fan-out' | 'consensus';
        tasks: Array<{ title: string; description: string; agentName: string; dependencies?: string[] }>;
      };

      if (!body.title || !body.leadAgentId || !body.pattern || !body.tasks?.length) {
        return reply.code(400).send({ error: 'title, leadAgentId, pattern, and tasks are required' });
      }

      const sessionId = ulid();
      await query(
        `INSERT INTO coordination_sessions (id, title, pattern, lead_agent_id, lead_agent_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, body.title, body.pattern, body.leadAgentId, body.leadAgentName],
      );

      // Create tasks
      const createdTasks = [];
      for (const task of body.tasks) {
        const taskId = ulid();
        // Look up agent ID by name
        const agent = await queryOne<{ id: string }>(
          `SELECT id FROM forge_agents WHERE name = $1 AND status != 'archived' LIMIT 1`,
          [task.agentName],
        );
        await query(
          `INSERT INTO coordination_tasks (id, session_id, title, description, assigned_agent, assigned_agent_id, dependencies)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [taskId, sessionId, task.title, task.description, task.agentName, agent?.id || null, task.dependencies || []],
        );
        createdTasks.push({
          id: taskId, title: task.title, description: task.description,
          assignedAgent: task.agentName, assignedAgentId: agent?.id || '',
          dependencies: task.dependencies || [], status: 'pending',
        });
      }

      // For pipeline pattern, start the first task immediately
      const firstTask = createdTasks[0];
      if (body.pattern === 'pipeline' && firstTask) {
        await query(`UPDATE coordination_tasks SET status = 'running', started_at = NOW() WHERE id = $1`, [firstTask.id]);
        firstTask.status = 'running';
      }
      // For fan-out pattern, start all tasks
      if (body.pattern === 'fan-out') {
        const taskIds = createdTasks.map(t => t.id);
        await query(`UPDATE coordination_tasks SET status = 'running', started_at = NOW() WHERE id = ANY($1)`, [taskIds]);
        for (const t of createdTasks) t.status = 'running';
      }

      return reply.code(201).send({
        session: {
          id: sessionId, planId: sessionId, leadAgentId: body.leadAgentId,
          leadAgentName: body.leadAgentName, status: 'active',
          startedAt: new Date().toISOString(), completedAt: null, summary: null,
          plan: {
            id: sessionId, title: body.title, pattern: body.pattern,
            leadAgentId: body.leadAgentId, leadAgentName: body.leadAgentName,
            tasks: createdTasks, status: 'executing', createdAt: new Date().toISOString(),
          },
        },
      });
    },
  );

  // Cancel coordination session
  app.post(
    '/api/v1/admin/coordination/sessions/:id/cancel',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const session = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM coordination_sessions WHERE id = $1`, [id],
      );
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      if (session.status !== 'active') return reply.code(400).send({ error: 'Session is not active' });

      await query(`UPDATE coordination_sessions SET status = 'cancelled', completed_at = NOW() WHERE id = $1`, [id]);
      await query(`UPDATE coordination_tasks SET status = 'failed', error = 'Session cancelled' WHERE session_id = $1 AND status IN ('pending', 'running')`, [id]);

      return { success: true };
    },
  );

  // List plans (same as sessions with plan data)
  app.get(
    '/api/v1/admin/coordination/plans',
    { preHandler: [authMiddleware] },
    async () => {
      const sessions = await query<{ id: string; title: string; pattern: string; lead_agent_id: string; lead_agent_name: string; status: string; created_at: string }>(
        `SELECT id, title, pattern, lead_agent_id, lead_agent_name, status, created_at FROM coordination_sessions ORDER BY created_at DESC LIMIT 50`,
      );
      return {
        plans: sessions.map(s => ({
          id: s.id, title: s.title, pattern: s.pattern,
          leadAgentId: s.lead_agent_id, leadAgentName: s.lead_agent_name,
          tasks: [], status: s.status === 'active' ? 'executing' : s.status, createdAt: s.created_at,
        })),
      };
    },
  );

  // Coordination stats
  app.get(
    '/api/v1/admin/coordination/stats',
    { preHandler: [authMiddleware] },
    async () => {
      const stats = await query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text as count FROM coordination_sessions GROUP BY status`,
      );
      const taskStats = await query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text as count FROM coordination_tasks GROUP BY status`,
      );
      const patternStats = await query<{ pattern: string; count: string }>(
        `SELECT pattern, COUNT(*)::text as count FROM coordination_sessions GROUP BY pattern`,
      );

      const sessionMap = Object.fromEntries(stats.map(s => [s.status, parseInt(s.count)]));
      const taskMap = Object.fromEntries(taskStats.map(s => [s.status, parseInt(s.count)]));
      const patternMap = Object.fromEntries(patternStats.map(s => [s.pattern, parseInt(s.count)]));

      const total = Object.values(sessionMap).reduce((a, b) => a + b, 0);
      const totalTasks = Object.values(taskMap).reduce((a, b) => a + b, 0);

      return {
        totalSessions: total,
        activeSessions: sessionMap['active'] || 0,
        completedSessions: sessionMap['completed'] || 0,
        failedSessions: (sessionMap['failed'] || 0) + (sessionMap['cancelled'] || 0),
        totalTasks,
        tasksByStatus: taskMap,
        totalPlans: total,
        patterns: {
          pipeline: patternMap['pipeline'] || 0,
          'fan-out': patternMap['fan-out'] || 0,
          consensus: patternMap['consensus'] || 0,
        },
      };
    },
  );

  // ------------------------------------------
  // ORCHESTRATED EXECUTION (intelligent decompose + match + dispatch)
  // ------------------------------------------

  app.post(
    '/api/v1/admin/coordination/orchestrate',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        task: string;
        leadAgentId?: string;
      };

      if (!body.task) {
        return reply.code(400).send({ error: 'task description is required' });
      }

      try {
        const { decomposeTask, shouldDecompose } = await import('../orchestration/task-decomposer.js');
        const { matchAgentsToTasks } = await import('../orchestration/agent-matcher.js');

        // Check if task warrants decomposition
        if (!shouldDecompose(body.task)) {
          return reply.code(200).send({
            orchestrated: false,
            reason: 'Task is simple enough for a single agent',
          });
        }

        // Get available agents
        const agents = await query<{ id: string; name: string; type: string; description: string }>(
          `SELECT id, name, type, description FROM forge_agents
           WHERE status != 'error' AND (is_decommissioned IS NULL OR is_decommissioned = false)`,
        );

        if (agents.length === 0) {
          return reply.code(400).send({ error: 'No active agents available' });
        }

        // Decompose
        const decomposition = await decomposeTask(body.task, agents);

        // Match agents
        const matches = await matchAgentsToTasks(decomposition.tasks);

        // Determine lead agent
        const leadAgentId = body.leadAgentId || agents[0]!.id;
        const leadAgent = agents.find(a => a.id === leadAgentId) || agents[0]!;

        // Create coordination session in DB
        const sessionId = ulid();
        await query(
          `INSERT INTO coordination_sessions (id, title, pattern, lead_agent_id, lead_agent_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, body.task.substring(0, 200), decomposition.pattern, leadAgentId, leadAgent.name],
        );

        // Create tasks
        interface OrchTask {
          id: string; title: string; description: string;
          assignedAgent: string; assignedAgentId: string;
          dependencies: string[]; status: string;
          matchScore: number; matchReasons: string[];
          complexity: string;
        }
        const createdTasks: OrchTask[] = [];
        for (let i = 0; i < decomposition.tasks.length; i++) {
          const task = decomposition.tasks[i]!;
          const match = matches.find(m => m.taskTitle === task.title);
          const taskId = ulid();

          // Map dependency titles to previously created task IDs
          const depTitles = task.dependencies || [];
          const depTaskIds = depTitles
            .map(title => createdTasks.find(ct => ct.title === title)?.id)
            .filter((id): id is string => id !== undefined);

          await query(
            `INSERT INTO coordination_tasks (id, session_id, title, description, assigned_agent, assigned_agent_id, dependencies)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [taskId, sessionId, task.title, task.description,
             match?.agentName || leadAgent.name, match?.agentId || leadAgentId,
             depTaskIds],
          );

          createdTasks.push({
            id: taskId, title: task.title, description: task.description,
            assignedAgent: match?.agentName || leadAgent.name,
            assignedAgentId: match?.agentId || leadAgentId,
            dependencies: depTaskIds, status: 'pending',
            matchScore: match?.score || 0,
            matchReasons: match?.reasons || [],
            complexity: task.estimatedComplexity,
          });
        }

        // Start ready tasks based on pattern
        if (decomposition.pattern === 'fan-out') {
          const readyIds = createdTasks.filter(t => t.dependencies.length === 0).map(t => t.id);
          if (readyIds.length > 0) {
            await query(`UPDATE coordination_tasks SET status = 'running', started_at = NOW() WHERE id = ANY($1)`, [readyIds]);
            for (const t of createdTasks) {
              if (readyIds.includes(t.id)) t.status = 'running';
            }
          }
        } else {
          // Pipeline/consensus: start first task
          const first = createdTasks.find(t => t.dependencies.length === 0);
          if (first) {
            await query(`UPDATE coordination_tasks SET status = 'running', started_at = NOW() WHERE id = $1`, [first.id]);
            first.status = 'running';
          }
        }

        return reply.code(201).send({
          orchestrated: true,
          session: {
            id: sessionId,
            title: body.task.substring(0, 200),
            pattern: decomposition.pattern,
            reasoning: decomposition.reasoning,
            leadAgent: leadAgent.name,
            tasks: createdTasks,
          },
        });
      } catch (err) {
        console.error('[Orchestrate] Failed:', err instanceof Error ? err.message : err);
        return reply.code(500).send({
          error: 'Orchestration failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
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
      try {
        const note = await substrateQueryOne<Record<string, unknown>>(
          `INSERT INTO agent_ticket_notes (id, ticket_id, content, author, created_at)
           VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
          [noteId, id, content, request.userId || 'admin'],
        );
        return { note };
      } catch (err) {
        console.error(`[Tickets] Failed to add note to ${id}:`, err);
        return { note: null, error: 'Failed to save note' };
      }
    },
  );

  // ------------------------------------------
  // ANALYTICS & CONVERGENCE
  // ------------------------------------------

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


  // ------------------------------------------
  // USER MANAGEMENT
  // ------------------------------------------

  app.get(
    '/api/v1/admin/users',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as { search?: string; role?: string; status?: string; limit?: string; offset?: string };
      const conditions: string[] = [];
      const params: unknown[] = [];
      const limit = Math.min(parseInt(qs.limit ?? '25'), 100);
      const offset = parseInt(qs.offset ?? '0') || 0;

      if (qs.search) {
        params.push(`%${qs.search}%`);
        conditions.push(`(u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`);
      }
      if (qs.role) { params.push(qs.role); conditions.push(`u.role = $${params.length}`); }
      if (qs.status) { params.push(qs.status); conditions.push(`u.status = $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [users, countResult] = await Promise.all([
        substrateQuery<Record<string, unknown>>(
          `SELECT u.id, u.email, u.display_name as name, u.role, u.status,
                  u.email_verified as "emailVerified", u.created_at as "createdAt",
                  u.last_login_at as "lastLoginAt"
           FROM users u
           ${where}
           ORDER BY u.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM users u ${where}`, params),
      ]);

      return { users, total: parseInt(countResult?.count || '0') };
    },
  );

  app.get(
    '/api/v1/admin/users/stats',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const [total, active, suspended, today] = await Promise.all([
        substrateQueryOne<{ count: string }>('SELECT COUNT(*)::text as count FROM users'),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM users WHERE status = 'active'`),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM users WHERE status = 'suspended'`),
        substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM users WHERE created_at > NOW() - INTERVAL '24 hours'`),
      ]);
      return {
        users: {
          total: parseInt(total?.count || '0'),
          active: parseInt(active?.count || '0'),
          suspended: parseInt(suspended?.count || '0'),
          today: parseInt(today?.count || '0'),
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/users/:userId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };
      const user = await substrateQueryOne<Record<string, unknown>>(
        `SELECT u.id, u.email, u.display_name as name, u.role, u.status,
                u.email_verified as "emailVerified", u.created_at as "createdAt",
                u.last_login_at as "lastLoginAt",
                u.failed_login_attempts as "failedLoginAttempts",
                u.locked_until as "lockedUntil"
         FROM users u
         WHERE u.id = $1`,
        [userId],
      );
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const execCount = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM forge_executions WHERE owner_id = $1`,
        [userId],
      ).catch(() => ({ count: '0' }));

      return { user, stats: { executions: parseInt(execCount?.count || '0') } };
    },
  );

  app.patch(
    '/api/v1/admin/users/:userId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };
      const body = request.body as Record<string, unknown>;
      const fields: string[] = [];
      const params: unknown[] = [];

      if (body['display_name'] !== undefined) { params.push(body['display_name']); fields.push(`display_name = $${params.length}`); }
      if (body['status'] !== undefined) { params.push(body['status']); fields.push(`status = $${params.length}`); }
      if (body['role'] !== undefined) { params.push(body['role']); fields.push(`role = $${params.length}`); }

      if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      params.push(userId);
      const result = await substrateQueryOne(
        `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING id`,
        params,
      );
      if (!result) return reply.code(404).send({ error: 'User not found' });
      return { success: true };
    },
  );

  app.post(
    '/api/v1/admin/users',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { email: string; password: string; display_name?: string; role?: string };
      if (!body.email || !body.password) return reply.code(400).send({ error: 'Email and password required' });

      // Check if user exists
      const existing = await substrateQueryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [body.email]);
      if (existing) return reply.code(409).send({ error: 'User already exists' });

      // Hash password using Node crypto (bcrypt not available, use simple hash for admin-created accounts)
      const { createHash: makeHash, randomBytes } = await import('crypto');
      const salt = randomBytes(16).toString('hex');
      const hash = makeHash('sha256').update(body.password + salt).digest('hex');

      const userId = ulid();

      await substrateQuery(
        `INSERT INTO users (id, email, password_hash, display_name, role, status, email_verified, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', true, NOW())`,
        [userId, body.email, `sha256:${salt}:${hash}`, body.display_name || null, body.role || 'user'],
      );

      return reply.code(201).send({ success: true, userId });
    },
  );

  app.delete(
    '/api/v1/admin/users/:userId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };
      const result = await substrateQueryOne<{ id: string }>(
        `UPDATE users SET status = 'deleted', updated_at = NOW() WHERE id = $1 RETURNING id`,
        [userId],
      );
      if (!result) return reply.code(404).send({ error: 'User not found' });
      return { success: true };
    },
  );

  // ------------------------------------------
  // FEEDBACK & LEARNING (Phase 4)
  // ------------------------------------------

  // Submit direct feedback on an execution
  app.post(
    '/api/v1/admin/executions/:id/feedback',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        feedbackType: string;
        feedback: string;
        correctedOutput?: string;
        autonomyDelta?: number;
      };

      if (!body.feedbackType || !body.feedback) {
        return reply.code(400).send({ error: 'feedbackType and feedback are required' });
      }

      // Get execution details
      const exec = await queryOne<{ agent_id: string; owner_id: string; output: string }>(
        `SELECT agent_id, owner_id, output FROM forge_executions WHERE id = $1`,
        [id],
      );
      if (!exec) return reply.code(404).send({ error: 'Execution not found' });

      const result = await processFeedback({
        executionId: id,
        agentId: exec.agent_id,
        ownerId: exec.owner_id,
        feedbackType: body.feedbackType as 'correction' | 'clarification' | 'praise' | 'warning' | 'rejection',
        humanResponse: body.feedback,
        agentOutput: exec.output,
        correctedOutput: body.correctedOutput,
        autonomyDelta: body.autonomyDelta,
      });

      return reply.code(201).send(result);
    },
  );

  // Get feedback stats for an agent
  app.get(
    '/api/v1/admin/agents/:id/feedback',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const stats = await getAgentFeedbackStats(id);
      return { agentId: id, ...stats };
    },
  );

  // Get correction patterns for an agent
  app.get(
    '/api/v1/admin/agents/:id/corrections',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const patterns = await query<{
        id: string; pattern_type: string; description: string;
        frequency: number; confidence: number; last_seen: string;
        examples: unknown[];
      }>(
        `SELECT id, pattern_type, description, frequency, confidence, last_seen, examples
         FROM forge_correction_patterns WHERE agent_id = $1
         ORDER BY frequency DESC, confidence DESC`,
        [id],
      );
      return { agentId: id, patterns };
    },
  );

  // ------------------------------------------
  // CAPABILITIES (Phase 3)
  // ------------------------------------------

  // Get capabilities for a specific agent
  app.get(
    '/api/v1/admin/agents/:id/capabilities',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const caps = await getAgentCapabilities(id);
      return { capabilities: caps };
    },
  );

  // Detect/refresh capabilities for a specific agent
  app.post(
    '/api/v1/admin/agents/:id/capabilities/detect',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const caps = await detectCapabilities(id);
      return { detected: caps.length, capabilities: caps };
    },
  );

  // Detect capabilities for all agents
  app.post(
    '/api/v1/admin/capabilities/detect-all',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const total = await detectAllCapabilities();
      return { detected: total };
    },
  );

  // Find agents with a specific capability
  app.get(
    '/api/v1/admin/capabilities/:name/agents',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { name } = request.params as { name: string };
      const qs = request.query as { minProficiency?: string };
      const agents = await findAgentsWithCapability(name, qs.minProficiency ? parseInt(qs.minProficiency) : 30);
      return { capability: name, agents };
    },
  );

  // Get capability catalog
  app.get(
    '/api/v1/admin/capabilities/catalog',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const catalog = await query<{
        id: string; name: string; display_name: string; description: string;
        category: string; required_tools: string[]; keywords: string[];
      }>(`SELECT * FROM forge_capability_catalog ORDER BY category, name`);
      return { catalog };
    },
  );

  // Get all agents' capabilities summary
  app.get(
    '/api/v1/admin/capabilities/summary',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const summary = await query<{
        agent_id: string; agent_name: string; capability_count: string;
        avg_proficiency: string; top_capability: string;
      }>(
        `SELECT c.agent_id, a.name AS agent_name,
                COUNT(*)::text AS capability_count,
                ROUND(AVG(c.proficiency))::text AS avg_proficiency,
                (SELECT c2.capability FROM forge_agent_capabilities c2
                 WHERE c2.agent_id = c.agent_id ORDER BY c2.proficiency DESC LIMIT 1) AS top_capability
         FROM forge_agent_capabilities c
         JOIN forge_agents a ON a.id = c.agent_id
         GROUP BY c.agent_id, a.name
         ORDER BY avg_proficiency DESC`,
      );
      return { agents: summary };
    },
  );

  // ------------------------------------------
  // REAL-TIME EVENTS (Phase 5)
  // ------------------------------------------

  // SSE endpoint for real-time event streaming
  app.get(
    '/api/v1/admin/events/stream',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as { types?: string };
      const filterTypes = qs.types ? qs.types.split(',') : null;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const eventBus = getEventBus();
      if (!eventBus) {
        reply.raw.write('data: {"error":"Event bus not initialized"}\n\n');
        reply.raw.end();
        return;
      }

      // Send initial connection event
      reply.raw.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

      const handler = (event: ForgeEvent) => {
        if (filterTypes && !filterTypes.includes(event.type)) return;
        try {
          reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        } catch {
          // Client disconnected
        }
      };

      eventBus.on('*', handler);

      // Heartbeat every 15 seconds
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      // Cleanup on disconnect
      request.raw.on('close', () => {
        eventBus.off('*', handler);
        clearInterval(heartbeat);
      });

      // Don't let Fastify close the response
      await reply;
    },
  );

  // Shared context endpoints
  app.post(
    '/api/v1/admin/context/:sessionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { key: string; value: unknown; append?: boolean };
      if (!body.key) return reply.code(400).send({ error: 'key is required' });

      if (body.append) {
        const length = await appendContext(sessionId, body.key, body.value);
        return { appended: true, length };
      }
      await setContext(sessionId, body.key, body.value);
      return { stored: true };
    },
  );

  app.get(
    '/api/v1/admin/context/:sessionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { sessionId } = request.params as { sessionId: string };
      const qs = request.query as { key?: string; list?: string };

      if (qs.key && qs.list === 'true') {
        const items = await getContextList(sessionId, qs.key);
        return { key: qs.key, items };
      }
      if (qs.key) {
        const value = await getContext(sessionId, qs.key);
        return { key: qs.key, value };
      }
      const keys = await listContextKeys(sessionId);
      return { sessionId, keys };
    },
  );

  // Handoff endpoints
  app.post(
    '/api/v1/admin/handoff',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const body = request.body as {
        sessionId: string; fromAgentId: string; toAgentId: string;
        task: string; progress: string; artifacts?: string[]; notes?: string;
      };
      const handoffId = await createHandoff(body.sessionId, body.fromAgentId, body.toAgentId, {
        task: body.task, progress: body.progress, artifacts: body.artifacts, notes: body.notes,
      });

      // Emit handoff event
      const eventBus = getEventBus();
      void eventBus?.emitHandoff('requested', body.fromAgentId, body.toAgentId, {
        sessionId: body.sessionId, context: body.task,
      }).catch(() => {});

      return { handoffId, sessionId: body.sessionId };
    },
  );

  app.get(
    '/api/v1/admin/handoff/:sessionId/:handoffId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, handoffId } = request.params as { sessionId: string; handoffId: string };
      const handoff = await getHandoff(sessionId, handoffId);
      if (!handoff) return reply.code(404).send({ error: 'Handoff not found' });
      return handoff;
    },
  );

  // ==========================================================================
  // PHASE 6: Self-Rewriting System Prompts
  // ==========================================================================

  app.post<{ Params: { id: string } }>(
    '/api/v1/platform/agents/:id/propose-revision',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const revision = await proposePromptRevision(request.params.id);
      if (!revision) return reply.code(200).send({ message: 'No revision proposed — insufficient correction patterns' });
      return revision;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/platform/agents/:id/prompt-revisions',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getPromptRevisions(request.params.id);
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/api/v1/platform/prompt-revisions/:revisionId/apply',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const ok = await applyPromptRevision(request.params.revisionId, 'admin');
      if (!ok) return reply.code(400).send({ error: 'Cannot apply revision' });
      return { success: true };
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/api/v1/platform/prompt-revisions/:revisionId/reject',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const ok = await rejectPromptRevision(request.params.revisionId, 'admin');
      if (!ok) return reply.code(400).send({ error: 'Cannot reject revision' });
      return { success: true };
    },
  );

  // ==========================================================================
  // PHASE 7: Natural Language Orchestration
  // ==========================================================================

  app.post(
    '/api/v1/platform/orchestrate-nl',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { instruction, maxAgents } = request.body as { instruction: string; maxAgents?: number };
      return orchestrateFromNL({
        instruction,
        ownerId: 'admin',
        maxAgents,
      });
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/v1/platform/orchestration/:sessionId/status',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getOrchestrationStatus(request.params.sessionId);
    },
  );

  // ==========================================================================
  // PHASE 8: Multi-Agent Chat
  // ==========================================================================

  app.post(
    '/api/v1/platform/chat/create',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { topic, agentIds } = request.body as { topic: string; agentIds: string[] };
      return createChatSession(topic, agentIds, 'admin');
    },
  );

  app.get(
    '/api/v1/platform/chat/sessions',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return listChatSessions();
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/v1/platform/chat/:sessionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const session = getChatSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      return session;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/platform/chat/:sessionId/message',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const { content } = request.body as { content: string };
      const msg = addModeratorMessage(request.params.sessionId, content, 'admin');
      if (!msg) return reply.code(400).send({ error: 'Session not active' });
      return msg;
    },
  );

  app.post<{ Params: { sessionId: string; agentId: string } }>(
    '/api/v1/platform/chat/:sessionId/respond/:agentId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const msg = await getAgentResponse(request.params.sessionId, request.params.agentId);
      if (!msg) return reply.code(400).send({ error: 'Could not get agent response' });
      return msg;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/platform/chat/:sessionId/round',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return runChatRound(request.params.sessionId);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/platform/chat/:sessionId/end',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const session = endChatSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      return session;
    },
  );

  // ==========================================================================
  // PHASE 9: Autonomous Goal-Setting
  // ==========================================================================

  app.post<{ Params: { id: string } }>(
    '/api/v1/platform/agents/:id/propose-goals',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return proposeGoals(request.params.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/platform/agents/:id/goals',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { status } = request.query as { status?: string };
      return getAgentGoals(request.params.id, status);
    },
  );

  app.post<{ Params: { goalId: string } }>(
    '/api/v1/platform/goals/:goalId/approve',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const ok = await approveGoal(request.params.goalId, 'admin');
      if (!ok) return reply.code(400).send({ error: 'Cannot approve goal' });
      return { success: true };
    },
  );

  app.post<{ Params: { goalId: string } }>(
    '/api/v1/platform/goals/:goalId/reject',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const ok = await rejectGoal(request.params.goalId);
      if (!ok) return reply.code(400).send({ error: 'Cannot reject goal' });
      return { success: true };
    },
  );

  // ==========================================================================
  // PHASE 10: Cost Optimization
  // ==========================================================================

  app.get(
    '/api/v1/platform/cost/dashboard',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getCostDashboard();
    },
  );

  app.post(
    '/api/v1/platform/cost/recommend',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { capabilities, minQuality } = request.body as { capabilities: string[]; minQuality?: number };
      return getModelRecommendations(capabilities, minQuality);
    },
  );

  app.get(
    '/api/v1/platform/cost/optimal-model',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { capability, minQuality } = request.query as { capability: string; minQuality?: string };
      return selectOptimalModel(capability, minQuality ? parseFloat(minQuality) : undefined);
    },
  );

  // ==========================================================================
  // PHASE 11: Knowledge Graph
  // ==========================================================================

  app.get(
    '/api/v1/platform/knowledge/stats',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getGraphStats();
    },
  );

  app.get(
    '/api/v1/platform/knowledge/search',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { q, type, agentId, limit } = request.query as { q: string; type?: string; agentId?: string; limit?: string };
      return searchNodes(q, {
        entityType: type,
        agentId,
        limit: limit ? parseInt(limit) : undefined,
      });
    },
  );

  app.get<{ Params: { nodeId: string } }>(
    '/api/v1/platform/knowledge/nodes/:nodeId/neighborhood',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getNodeNeighborhood(request.params.nodeId);
    },
  );

  // ==========================================================================
  // PHASE 12: Monitoring
  // ==========================================================================

  app.get(
    '/api/v1/platform/monitoring/health',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const cached = getLastHealthReport();
      if (cached && Date.now() - new Date(cached.timestamp).getTime() < 60_000) {
        return cached;
      }
      return runHealthCheck();
    },
  );

  // ==========================================================================
  // PHASE 13: Agent Evolution
  // ==========================================================================

  app.post<{ Params: { id: string } }>(
    '/api/v1/platform/agents/:id/clone',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { type, description, promptOverride, modelOverride } = request.body as {
        type: 'prompt' | 'tools' | 'model' | 'config' | 'combined';
        description: string;
        promptOverride?: string;
        modelOverride?: string;
      };
      const variantId = await cloneAgent(request.params.id, { type, description, promptOverride, modelOverride });
      return { variantId };
    },
  );

  app.post(
    '/api/v1/platform/evolution/experiment',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { parentId, variantId, testTask, mutationDescription, mutationType } = request.body as {
        parentId: string; variantId: string; testTask: string; mutationDescription: string; mutationType?: string;
      };
      return runExperiment(parentId, variantId, testTask, mutationDescription, mutationType);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/platform/agents/:id/experiments',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getExperiments(request.params.id);
    },
  );

  app.post<{ Params: { experimentId: string } }>(
    '/api/v1/platform/evolution/:experimentId/promote',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const ok = await promoteVariant(request.params.experimentId);
      if (!ok) return reply.code(400).send({ error: 'Cannot promote — variant did not win' });
      return { success: true };
    },
  );

  // ==========================================================================
  // PHASE 14: Event Log, Leaderboard, Replay
  // ==========================================================================

  app.get(
    '/api/v1/platform/events/recent',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { limit } = request.query as { limit?: string };
      return getRecentEvents(limit ? parseInt(limit) : 50);
    },
  );

  app.get<{ Params: { executionId: string } }>(
    '/api/v1/platform/events/execution/:executionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getExecutionEvents(request.params.executionId);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/v1/platform/events/session/:sessionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getSessionEvents(request.params.sessionId);
    },
  );

  app.get(
    '/api/v1/platform/events/stats',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getEventLogStats();
    },
  );

  app.get(
    '/api/v1/platform/fleet/leaderboard',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getFleetLeaderboard();
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
