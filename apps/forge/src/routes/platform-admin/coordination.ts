/**
 * Platform Admin — Coordination sessions, plans, stats, orchestrated execution
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/auth.js';

export async function registerCoordinationRoutes(app: FastifyInstance): Promise<void> {

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

  // Create coordination session
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

      const createdTasks = [];
      for (const task of body.tasks) {
        const taskId = ulid();
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

      const firstTask = createdTasks[0];
      if (body.pattern === 'pipeline' && firstTask) {
        await query(`UPDATE coordination_tasks SET status = 'running', started_at = NOW() WHERE id = $1`, [firstTask.id]);
        firstTask.status = 'running';
      }
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

  // List plans
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

  // Orchestrated execution (intelligent decompose + match + dispatch)
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
        const { decomposeTask, shouldDecompose } = await import('../../orchestration/task-decomposer.js');
        const { matchAgentsToTasks } = await import('../../orchestration/agent-matcher.js');

        if (!shouldDecompose(body.task)) {
          return reply.code(200).send({
            orchestrated: false,
            reason: 'Task is simple enough for a single agent',
          });
        }

        const agents = await query<{ id: string; name: string; type: string; description: string }>(
          `SELECT id, name, type, description FROM forge_agents
           WHERE status != 'error' AND (is_decommissioned IS NULL OR is_decommissioned = false)`,
        );

        if (agents.length === 0) {
          return reply.code(400).send({ error: 'No active agents available' });
        }

        const decomposition = await decomposeTask(body.task, agents);
        const matches = await matchAgentsToTasks(decomposition.tasks);

        const leadAgentId = body.leadAgentId || agents[0]!.id;
        const leadAgent = agents.find(a => a.id === leadAgentId) || agents[0]!;

        const sessionId = ulid();
        await query(
          `INSERT INTO coordination_sessions (id, title, pattern, lead_agent_id, lead_agent_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, body.task.substring(0, 200), decomposition.pattern, leadAgentId, leadAgent.name],
        );

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

        if (decomposition.pattern === 'fan-out') {
          const readyIds = createdTasks.filter(t => t.dependencies.length === 0).map(t => t.id);
          if (readyIds.length > 0) {
            await query(`UPDATE coordination_tasks SET status = 'running', started_at = NOW() WHERE id = ANY($1)`, [readyIds]);
            for (const t of createdTasks) {
              if (readyIds.includes(t.id)) t.status = 'running';
            }
          }
        } else {
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
        request.log.error({ err }, '[Orchestrate] Failed');
        const message = process.env['NODE_ENV'] === 'production'
          ? 'Internal Server Error'
          : (err instanceof Error ? err.message : String(err));
        return reply.code(500).send({
          error: 'Internal Server Error',
          message,
        });
      }
    },
  );
}
