/**
 * Forge Execution Routes
 * Start, monitor, and stream agent executions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';
import { checkGuardrails } from '../observability/guardrails.js';
import { runExecution, runBatchExecution } from '../runtime/worker.js';

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

interface ExecutionCountRow {
  total: string;
}

interface AgentCheckRow {
  id: string;
  owner_id: string;
  status: string;
  max_cost_per_execution: string;
}

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/executions - Start an agent execution
   */
  app.post(
    '/api/v1/forge/executions',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        agentId: string;
        input: string;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      };

      if (!body.agentId || !body.input) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'agentId and input are required',
        });
      }

      // Verify agent exists and is accessible
      const agent = await queryOne<AgentCheckRow>(
        `SELECT id, owner_id, status, max_cost_per_execution
         FROM forge_agents
         WHERE id = $1 AND (owner_id = $2 OR is_public = true)`,
        [body.agentId, userId],
      );

      if (!agent) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Agent not found or not accessible',
        });
      }

      if (agent.status === 'archived') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot execute an archived agent',
        });
      }

      // Run guardrail checks
      const guardrailResult = await checkGuardrails({
        ownerId: userId,
        agentId: body.agentId,
        input: body.input,
        estimatedCost: parseFloat(agent.max_cost_per_execution),
      });

      if (!guardrailResult.allowed) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: guardrailResult.reason ?? 'Blocked by guardrails',
        });
      }

      const executionId = ulid();

      const execution = await queryOne<ExecutionRow>(
        `INSERT INTO forge_executions (id, agent_id, session_id, owner_id, input, status, metadata, started_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())
         RETURNING *`,
        [
          executionId,
          body.agentId,
          body.sessionId ?? null,
          userId,
          body.input,
          JSON.stringify(body.metadata ?? {}),
        ],
      );

      void logAudit({
        ownerId: userId,
        action: 'execution.start',
        resourceType: 'execution',
        resourceId: executionId,
        details: { agentId: body.agentId },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      // Fire execution asynchronously — return immediately, engine runs in background
      void runExecution(
        executionId,
        body.agentId,
        body.input,
        userId,
        body.sessionId,
      ).catch((err) => {
        console.error(`[Executions] Async execution failed for ${executionId}:`, err);
      });

      return reply.status(201).send({ execution });
    },
  );

  /**
   * GET /api/v1/forge/executions/:id - Get execution details
   */
  app.get(
    '/api/v1/forge/executions/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const execution = await queryOne<ExecutionRow>(
        `SELECT * FROM forge_executions WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!execution) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Execution not found',
        });
      }

      return reply.send({ execution });
    },
  );

  /**
   * GET /api/v1/forge/executions/:id/stream - SSE stream for execution updates
   */
  app.get(
    '/api/v1/forge/executions/:id/stream',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Verify the execution exists and belongs to the user
      const execution = await queryOne<ExecutionRow>(
        `SELECT id, status FROM forge_executions WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!execution) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Execution not found',
        });
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial event with current execution status
      const initialEvent = JSON.stringify({
        type: 'status',
        executionId: execution.id,
        status: execution.status,
      });
      reply.raw.write(`data: ${initialEvent}\n\n`);

      // In a full implementation, this would subscribe to a Redis pub/sub channel
      // or BullMQ events for real-time updates. For now, send a stub completion.
      if (execution.status === 'completed' || execution.status === 'failed') {
        const doneEvent = JSON.stringify({
          type: 'done',
          executionId: execution.id,
          status: execution.status,
        });
        reply.raw.write(`data: ${doneEvent}\n\n`);
        reply.raw.end();
      } else {
        // Keep connection open with heartbeat
        const heartbeat = setInterval(() => {
          reply.raw.write(`: heartbeat\n\n`);
        }, 15_000);

        request.raw.on('close', () => {
          clearInterval(heartbeat);
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/executions - List executions for owner
   */
  app.get(
    '/api/v1/forge/executions',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as {
        agentId?: string;
        sessionId?: string;
        status?: string;
        limit?: string;
        offset?: string;
      };

      const conditions: string[] = ['owner_id = $1'];
      const params: unknown[] = [userId];
      let paramIndex = 2;

      if (qs.agentId) {
        conditions.push(`agent_id = $${paramIndex}`);
        params.push(qs.agentId);
        paramIndex++;
      }

      if (qs.sessionId) {
        conditions.push(`session_id = $${paramIndex}`);
        params.push(qs.sessionId);
        paramIndex++;
      }

      if (qs.status) {
        conditions.push(`status = $${paramIndex}`);
        params.push(qs.status);
        paramIndex++;
      }

      const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
      const offset = parseInt(qs.offset ?? '0', 10) || 0;
      const whereClause = conditions.join(' AND ');

      const [executions, countResult] = await Promise.all([
        query<ExecutionRow>(
          `SELECT * FROM forge_executions
           WHERE ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset],
        ),
        queryOne<ExecutionCountRow>(
          `SELECT COUNT(*) AS total FROM forge_executions WHERE ${whereClause}`,
          params,
        ),
      ]);

      return reply.send({
        executions,
        total: countResult ? parseInt(countResult.total, 10) : 0,
        limit,
        offset,
      });
    },
  );

  /**
   * POST /api/v1/forge/executions/batch - Run multiple agents as a batch (50% cost reduction)
   * Accepts an array of {agentId, input} and runs them through the Anthropic Batches API.
   */
  app.post(
    '/api/v1/forge/executions/batch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        agents: Array<{ agentId: string; input: string }>;
      };

      if (!body.agents || !Array.isArray(body.agents) || body.agents.length === 0) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'agents array is required with at least one {agentId, input} entry',
        });
      }

      if (body.agents.length > 20) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Maximum 20 agents per batch',
        });
      }

      const batchAgents = body.agents.map((a) => ({
        agentId: a.agentId,
        input: a.input,
        ownerId: userId,
      }));

      // Fire batch asynchronously
      void runBatchExecution(batchAgents).then((results) => {
        const completed = results.filter((r) => r.status === 'completed').length;
        const failed = results.filter((r) => r.status === 'failed').length;
        const totalCost = results.reduce((s, r) => s + r.cost, 0);
        console.log(`[Batch] Complete: ${completed} succeeded, ${failed} failed, $${totalCost.toFixed(4)} cost`);
      }).catch((err) => {
        console.error('[Batch] Batch execution failed:', err);
      });

      return reply.status(202).send({
        message: 'Batch execution started',
        agentCount: batchAgents.length,
        mode: 'batch',
        costReduction: '50%',
      });
    },
  );
}
