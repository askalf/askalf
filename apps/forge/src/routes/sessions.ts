/**
 * Forge Session Routes
 * Conversation session management with message history
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { ulid } from 'ulid';
import { query, queryOne, retryQuery } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';
import { checkGuardrails } from '../observability/guardrails.js';
import { runDirectCliExecution } from '../runtime/worker.js';
import {
  CreateSessionBody, ListSessionsQuery, SendMessageBody,
  IdParam, ErrorResponse,
} from './schemas.js';

interface SessionRow {
  id: string;
  agent_id: string;
  owner_id: string;
  title: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SessionCountRow {
  total: string;
}

interface ExecutionRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  owner_id: string;
  status: string;
  input: string;
  output: string | null;
  messages: unknown[];
  tool_calls: unknown[];
  iterations: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: string;
  duration_ms: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface AgentCheckRow {
  id: string;
  owner_id: string;
  status: string;
  system_prompt?: string;
  max_cost_per_execution: string;
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/sessions - Create a new session
   */
  app.post(
    '/api/v1/forge/sessions',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Create a new session',
        body: CreateSessionBody,
        response: { 400: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as Static<typeof CreateSessionBody>;

      try {
        // Verify agent exists and is accessible
        const agent = await queryOne<AgentCheckRow>(
          `SELECT id, owner_id, status FROM forge_agents
           WHERE id = $1 AND (owner_id = $2 OR is_public = true)`,
          [body.agentId, userId],
        );

        if (!agent) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Agent not found or not accessible',
          });
        }

        const sessionId = ulid();

        const session = await queryOne<SessionRow>(
          `INSERT INTO forge_sessions (id, agent_id, owner_id, title, metadata)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            sessionId,
            body.agentId,
            userId,
            body.title ?? null,
            JSON.stringify(body.metadata ?? {}),
          ],
        );

        void logAudit({
          ownerId: userId,
          action: 'session.create',
          resourceType: 'session',
          resourceId: sessionId,
          details: { agentId: body.agentId },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.status(201).send({ session });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to create session');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/sessions - List sessions
   */
  app.get(
    '/api/v1/forge/sessions',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'List sessions',
        querystring: ListSessionsQuery,
        response: { 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as Static<typeof ListSessionsQuery>;

      try {
        const conditions: string[] = ['owner_id = $1'];
        const params: unknown[] = [userId];
        let paramIndex = 2;

        if (qs.agentId) {
          conditions.push(`agent_id = $${paramIndex}`);
          params.push(qs.agentId);
          paramIndex++;
        }

        if (qs.active !== undefined) {
          conditions.push(`is_active = $${paramIndex}`);
          params.push(qs.active === 'true');
          paramIndex++;
        }

        const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
        const offset = parseInt(qs.offset ?? '0', 10) || 0;
        const whereClause = conditions.join(' AND ');

        const [sessions, countResult] = await Promise.all([
          query<SessionRow>(
            `SELECT * FROM forge_sessions
             WHERE ${whereClause}
             ORDER BY updated_at DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            [...params, limit, offset],
          ),
          queryOne<SessionCountRow>(
            `SELECT COUNT(*) AS total FROM forge_sessions WHERE ${whereClause}`,
            params,
          ),
        ]);

        return reply.send({
          sessions,
          total: countResult ? parseInt(countResult.total, 10) : 0,
          limit,
          offset,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to list sessions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/sessions/:id - Get session with message history (executions)
   */
  app.get(
    '/api/v1/forge/sessions/:id',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Get session with message history',
        params: IdParam,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

      try {
        const session = await queryOne<SessionRow>(
          `SELECT * FROM forge_sessions WHERE id = $1 AND owner_id = $2`,
          [id, userId],
        );

        if (!session) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Session not found',
          });
        }

        // Fetch execution history for this session (serves as message history)
        const executions = await query<ExecutionRow>(
          `SELECT * FROM forge_executions
           WHERE session_id = $1 AND owner_id = $2
           ORDER BY created_at ASC`,
          [id, userId],
        );

        return reply.send({ session, executions });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to get session');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/sessions/:id/messages - Send a message (triggers an execution)
   */
  app.post(
    '/api/v1/forge/sessions/:id/messages',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Send a message (triggers an execution)',
        params: IdParam,
        body: SendMessageBody,
        response: { 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id: sessionId } = request.params as Static<typeof IdParam>;
      const body = request.body as Static<typeof SendMessageBody>;

      try {
        // Verify session exists and belongs to user
        const session = await queryOne<SessionRow>(
          `SELECT * FROM forge_sessions WHERE id = $1 AND owner_id = $2`,
          [sessionId, userId],
        );

        if (!session) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Session not found',
          });
        }

        if (!session.is_active) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Session is no longer active',
          });
        }

        // Load agent to run guardrails
        const agent = await queryOne<AgentCheckRow>(
          `SELECT id, owner_id, status, max_cost_per_execution, system_prompt FROM forge_agents WHERE id = $1`,
          [session.agent_id],
        );

        if (!agent || agent.status === 'archived') {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'The agent associated with this session is no longer available',
          });
        }

        // Guardrail check
        const guardrailResult = await checkGuardrails({
          ownerId: userId,
          agentId: session.agent_id,
          input: body.message,
          estimatedCost: parseFloat(agent.max_cost_per_execution),
        });

        if (!guardrailResult.allowed) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: guardrailResult.reason ?? 'Blocked by guardrails',
          });
        }

        // Create an execution for this message
        const executionId = ulid();

        const execution = await queryOne<ExecutionRow>(
          `INSERT INTO forge_executions (id, agent_id, session_id, owner_id, input, status, metadata, started_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())
           RETURNING *`,
          [
            executionId,
            session.agent_id,
            sessionId,
            userId,
            body.message,
            JSON.stringify(body.metadata ?? {}),
          ],
        );

        // Dispatch the execution
        void runDirectCliExecution(executionId, session.agent_id, body.message, userId, {
          systemPrompt: agent.system_prompt,
          maxBudgetUsd: agent.max_cost_per_execution,
        }).catch((err) => {
          request.log.error({ err, executionId }, 'Session execution failed');
        });

        // Update session's updated_at with retry on transient DB errors
        void retryQuery(
          `UPDATE forge_sessions SET updated_at = NOW() WHERE id = $1`,
          [sessionId],
        ).catch((err) => {
          request.log.warn({ err }, 'Failed to update session updated_at after retries');
        });

        void logAudit({
          ownerId: userId,
          action: 'session.message',
          resourceType: 'session',
          resourceId: sessionId,
          details: { executionId, agentId: session.agent_id },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.status(201).send({ execution });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to send session message');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * DELETE /api/v1/forge/sessions/:id - Deactivate a session
   */
  app.delete(
    '/api/v1/forge/sessions/:id',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Deactivate a session',
        params: IdParam,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

      try {
        const session = await queryOne<SessionRow>(
          `UPDATE forge_sessions
           SET is_active = false
           WHERE id = $1 AND owner_id = $2
           RETURNING id, agent_id, is_active`,
          [id, userId],
        );

        if (!session) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Session not found',
          });
        }

        void logAudit({
          ownerId: userId,
          action: 'session.deactivate',
          resourceType: 'session',
          resourceId: id,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.send({
          message: 'Session deactivated',
          session: { id: session.id, isActive: session.is_active },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to deactivate session');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );
}
