/**
 * Platform Admin — Users, feedback & learning, capabilities, real-time events,
 * shared context, handoffs, phases 6-14
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';
import { detectCapabilities, getAgentCapabilities, findAgentsWithCapability, detectAllCapabilities } from '../../orchestration/capability-registry.js';
import { processFeedback, getAgentFeedbackStats } from '../../learning/feedback-processor.js';
import { getEventBus, type ForgeEvent } from '../../orchestration/event-bus.js';
import { setContext, getContext, getContextList, appendContext, listContextKeys, createHandoff, getHandoff } from '../../orchestration/shared-context.js';
import { proposePromptRevision, applyPromptRevision, rejectPromptRevision, getPromptRevisions } from '../../learning/prompt-rewriter.js';
import { orchestrateFromNL, getOrchestrationStatus } from '../../orchestration/nl-orchestrator.js';
import { createChatSession, getChatSession, listChatSessions, addModeratorMessage, getAgentResponse, runChatRound, endChatSession } from '../../orchestration/multi-agent-chat.js';
import { proposeGoals, approveGoal, rejectGoal, getAgentGoals } from '../../orchestration/goal-proposer.js';
import { selectOptimalModel, getCostDashboard, getModelRecommendations } from '../../orchestration/cost-router.js';
import { searchNodes, getNodeNeighborhood, getGraphStats } from '../../orchestration/knowledge-graph.js';
import { runHealthCheck, getLastHealthReport } from '../../orchestration/monitoring-agent.js';
import { cloneAgent, runExperiment, getExperiments, promoteVariant } from '../../orchestration/evolution.js';
import { getExecutionEvents, getSessionEvents, getRecentEvents, getFleetLeaderboard, getEventLogStats } from '../../orchestration/event-log.js';
import { getMetabolicStatus } from '../../memory/metabolic.js';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {

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

      const existing = await substrateQueryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [body.email]);
      if (existing) return reply.code(409).send({ error: 'User already exists' });

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

  app.get(
    '/api/v1/admin/agents/:id/feedback',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const stats = await getAgentFeedbackStats(id);
      return { agentId: id, ...stats };
    },
  );

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

  app.get(
    '/api/v1/admin/agents/:id/capabilities',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const caps = await getAgentCapabilities(id);
      return { capabilities: caps };
    },
  );

  app.post(
    '/api/v1/admin/agents/:id/capabilities/detect',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const caps = await detectCapabilities(id);
      return { detected: caps.length, capabilities: caps };
    },
  );

  app.post(
    '/api/v1/admin/capabilities/detect-all',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const total = await detectAllCapabilities();
      return { detected: total };
    },
  );

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

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      request.raw.on('close', () => {
        eventBus.off('*', handler);
        clearInterval(heartbeat);
      });

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
    '/api/v1/admin/agents/:id/propose-revision',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const revision = await proposePromptRevision(request.params.id);
      if (!revision) return reply.code(200).send({ message: 'No revision proposed — insufficient correction patterns' });
      return revision;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/agents/:id/prompt-revisions',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getPromptRevisions(request.params.id);
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/api/v1/admin/prompt-revisions/:revisionId/apply',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const ok = await applyPromptRevision(request.params.revisionId, 'admin');
      if (!ok) return reply.code(400).send({ error: 'Cannot apply revision' });
      return { success: true };
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/api/v1/admin/prompt-revisions/:revisionId/reject',
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
    '/api/v1/admin/orchestrate-nl',
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
    '/api/v1/admin/orchestration/:sessionId/status',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getOrchestrationStatus(request.params.sessionId);
    },
  );

  // ==========================================================================
  // PHASE 8: Multi-Agent Chat
  // ==========================================================================

  app.post(
    '/api/v1/admin/chat/create',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { topic, agentIds } = request.body as { topic: string; agentIds: string[] };
      return createChatSession(topic, agentIds, 'admin');
    },
  );

  app.get(
    '/api/v1/admin/chat/sessions',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return listChatSessions();
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/v1/admin/chat/:sessionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const session = getChatSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      return session;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/admin/chat/:sessionId/message',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const { content } = request.body as { content: string };
      const msg = addModeratorMessage(request.params.sessionId, content, 'admin');
      if (!msg) return reply.code(400).send({ error: 'Session not active' });
      return msg;
    },
  );

  app.post<{ Params: { sessionId: string; agentId: string } }>(
    '/api/v1/admin/chat/:sessionId/respond/:agentId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const msg = await getAgentResponse(request.params.sessionId, request.params.agentId);
      if (!msg) return reply.code(400).send({ error: 'Could not get agent response' });
      return msg;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/admin/chat/:sessionId/round',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return runChatRound(request.params.sessionId);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/admin/chat/:sessionId/end',
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
    '/api/v1/admin/agents/:id/propose-goals',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return proposeGoals(request.params.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/agents/:id/goals',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { status } = request.query as { status?: string };
      return getAgentGoals(request.params.id, status);
    },
  );

  app.post<{ Params: { goalId: string } }>(
    '/api/v1/admin/goals/:goalId/approve',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      const ok = await approveGoal(request.params.goalId, 'admin');
      if (!ok) return reply.code(400).send({ error: 'Cannot approve goal' });
      return { success: true };
    },
  );

  app.post<{ Params: { goalId: string } }>(
    '/api/v1/admin/goals/:goalId/reject',
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
    '/api/v1/admin/cost/dashboard',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getCostDashboard();
    },
  );

  app.post(
    '/api/v1/admin/cost/recommend',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { capabilities, minQuality } = request.body as { capabilities: string[]; minQuality?: number };
      return getModelRecommendations(capabilities, minQuality);
    },
  );

  app.get(
    '/api/v1/admin/cost/optimal-model',
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
    '/api/v1/admin/knowledge/stats',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getGraphStats();
    },
  );

  app.get(
    '/api/v1/admin/knowledge/search',
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
    '/api/v1/admin/knowledge/nodes/:nodeId/neighborhood',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getNodeNeighborhood(request.params.nodeId);
    },
  );

  // ==========================================================================
  // PHASE 12: Monitoring
  // ==========================================================================

  app.get(
    '/api/v1/admin/monitoring/health',
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
    '/api/v1/admin/agents/:id/clone',
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
    '/api/v1/admin/evolution/experiment',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { parentId, variantId, testTask, mutationDescription, mutationType } = request.body as {
        parentId: string; variantId: string; testTask: string; mutationDescription: string; mutationType?: string;
      };
      return runExperiment(parentId, variantId, testTask, mutationDescription, mutationType);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/agents/:id/experiments',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getExperiments(request.params.id);
    },
  );

  app.post<{ Params: { experimentId: string } }>(
    '/api/v1/admin/evolution/:experimentId/promote',
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
    '/api/v1/admin/events/recent',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      const { limit } = request.query as { limit?: string };
      return getRecentEvents(limit ? parseInt(limit) : 50);
    },
  );

  app.get<{ Params: { executionId: string } }>(
    '/api/v1/admin/events/execution/:executionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getExecutionEvents(request.params.executionId);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/v1/admin/events/session/:sessionId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request) => {
      return getSessionEvents(request.params.sessionId);
    },
  );

  app.get(
    '/api/v1/admin/events/stats',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getEventLogStats();
    },
  );

  app.get(
    '/api/v1/admin/fleet/leaderboard',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      return getFleetLeaderboard();
    },
  );

  // ------------------------------------------
  // METABOLIC STATUS
  // ------------------------------------------

  app.get(
    '/api/v1/admin/metabolic/status',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const cycles = getMetabolicStatus();

      // Also get memory counts from DB
      const memoryCounts = await query<{ tier: string; count: string }>(
        `SELECT 'procedural' AS tier, COUNT(*)::text AS count FROM forge_procedural_memories
         UNION ALL SELECT 'semantic', COUNT(*)::text FROM forge_semantic_memories
         UNION ALL SELECT 'episodic', COUNT(*)::text FROM forge_episodic_memories`,
      );

      const memory = Object.fromEntries(memoryCounts.map((r) => [r.tier, parseInt(r.count, 10)]));

      return {
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        cycles,
        memory,
      };
    },
  );
}
