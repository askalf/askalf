/**
 * Forge Execution Routes
 * Start, monitor, and stream agent executions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';
import { checkGuardrails, checkUserBudget } from '../observability/guardrails.js';
import { runDirectCliExecution } from '../runtime/worker.js';
import { calculateCost, estimateTokens } from '../runtime/token-counter.js';
import {
  CreateExecutionBody, ListExecutionsQuery, BatchExecutionBody,
  IdParam, ErrorResponse,
} from './schemas.js';
import { cancelCliExecution } from '../runtime/worker.js';

interface ExecutionRow {
  id: string;
  agent_id: string;
  agent_name: string | null;
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
  cost_events_total: string | null;
  model: string | null;
  duration_ms: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface DailyCostSummaryRow {
  date: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  execution_count: string;
}

interface WeeklyCostSummaryRow {
  week_start: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  execution_count: string;
}

/** Resolve the best available cost: cost_events > stored execution cost > estimated from tokens */
function resolveCost(row: ExecutionRow): number {
  if (row.cost_events_total !== null) {
    const v = parseFloat(row.cost_events_total);
    if (v > 0) return v;
  }
  const stored = parseFloat(row.cost);
  if (stored > 0) return stored;
  // Fall back to model-pricing estimate from token counts
  const model = row.model ?? 'claude-sonnet-4-6';
  const input = row.input_tokens || 0;
  const output = row.output_tokens || 0;
  if (input > 0 || output > 0) return calculateCost(input, output, model);
  return 0;
}

interface ExecutionCountRow {
  total: string;
}

function encodeCursor(id: string, createdAt: string): string {
  return Buffer.from(JSON.stringify({ id, t: createdAt })).toString('base64url');
}

function decodeCursor(cursor: string): { id: string; t: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed.id === 'string' && typeof parsed.t === 'string') return parsed as { id: string; t: string };
    return null;
  } catch {
    return null;
  }
}

interface AgentCheckRow {
  id: string;
  owner_id: string;
  status: string;
  max_cost_per_execution: string;
  model_id: string | null;
  system_prompt: string | null;
  max_iterations: number | null;
}

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/executions - Start an agent execution
   */
  app.post(
    '/api/v1/forge/executions',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Start an agent execution',
        body: CreateExecutionBody,
        response: { 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as Static<typeof CreateExecutionBody>;

      try {
        // Verify agent exists and is accessible
        const agent = await queryOne<AgentCheckRow>(
          `SELECT id, owner_id, status, max_cost_per_execution, model_id, system_prompt, max_iterations
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

        // Check user budget limits (from forge_user_preferences)
        const budgetResult = await checkUserBudget(userId);
        if (!budgetResult.allowed) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: budgetResult.reason ?? 'Budget exceeded',
          });
        }

        const executionId = ulid();

        const priority = body.priority ?? 'normal';

        const execution = await queryOne<ExecutionRow>(
          `INSERT INTO forge_executions (id, agent_id, session_id, owner_id, input, status, priority, metadata, started_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW())
           RETURNING *`,
          [
            executionId,
            body.agentId,
            body.sessionId ?? null,
            userId,
            body.input,
            priority,
            JSON.stringify({ source_layer: 'api', ...body.metadata }),
          ],
        );

        void logAudit({
          ownerId: userId,
          action: 'execution.start',
          resourceType: 'execution',
          resourceId: executionId,
          details: { agentId: body.agentId, priority },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        // Fire CLI execution asynchronously — return immediately, CLI runs in background
        void runDirectCliExecution(
          executionId,
          body.agentId,
          body.input,
          userId,
          {
            modelId: agent.model_id ?? undefined,
            systemPrompt: agent.system_prompt ?? undefined,
            sessionId: body.sessionId,
            maxBudgetUsd: agent.max_cost_per_execution,
            maxTurns: agent.max_iterations ?? undefined,
            priority,
          },
        ).catch((err) => {
          request.log.error({ err, executionId }, 'Async CLI execution failed');
          const errMsg = err instanceof Error ? err.message : String(err);
          void query(
            `UPDATE forge_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2 AND status IN ('pending', 'running')`,
            [`Failed to start: ${errMsg}`, executionId],
          ).catch((dbErr) => {
            request.log.error({ err: dbErr, executionId }, 'Failed to update execution status after CLI failure');
          });
        });

        return reply.status(201).send({ execution });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to start execution');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/executions/:id - Get execution details
   */
  app.get(
    '/api/v1/forge/executions/:id',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Get execution details',
        params: IdParam,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

      try {
        const execution = await queryOne<ExecutionRow>(
          `SELECT
             e.*,
             COALESCE(a.name, 'Unknown') AS agent_name,
             COALESCE(ce.total_input_tokens, e.input_tokens, 0)::int AS input_tokens,
             COALESCE(ce.total_output_tokens, e.output_tokens, 0)::int AS output_tokens,
             (COALESCE(ce.total_input_tokens, e.input_tokens, 0) + COALESCE(ce.total_output_tokens, e.output_tokens, 0))::int AS total_tokens,
             COALESCE(ce.total_cost, e.cost, 0)::text AS cost,
             ce.total_cost::text AS cost_events_total,
             ce.model
           FROM forge_executions e
           LEFT JOIN forge_agents a ON a.id = e.agent_id
           LEFT JOIN (
             SELECT execution_id,
               COALESCE(SUM(cost), 0) AS total_cost,
               COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
               COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
               MAX(model) AS model
             FROM forge_cost_events GROUP BY execution_id
           ) ce ON ce.execution_id = e.id
           WHERE e.id = $1 AND e.owner_id = $2`,
          [id, userId],
        );

        if (!execution) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Execution not found',
          });
        }

        return reply.send({
          execution: {
            ...execution,
            agentName: execution.agent_name,
            cost: resolveCost(execution),
            estimatedCost: resolveCost(execution),
            inputTokens: execution.input_tokens || 0,
            outputTokens: execution.output_tokens || 0,
            totalTokens: execution.total_tokens || 0,
            model: execution.model ?? null,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to get execution');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/executions/:id/stream - SSE stream for execution updates
   */
  app.get(
    '/api/v1/forge/executions/:id/stream',
    {
      schema: {
        tags: ['Executions'],
        summary: 'SSE stream for execution updates',
        params: IdParam,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Verify the execution exists and belongs to the user
      let execution: { id: string; status: string } | null = null;
      try {
        execution = await queryOne<ExecutionRow>(
          `SELECT id, status FROM forge_executions WHERE id = $1 AND owner_id = $2`,
          [id, userId],
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to verify execution for stream');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }

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

      if (execution.status === 'completed' || execution.status === 'failed') {
        const doneEvent = JSON.stringify({
          type: 'done',
          executionId: execution.id,
          status: execution.status,
        });
        reply.raw.write(`data: ${doneEvent}\n\n`);
        reply.raw.end();
      } else {
        // Subscribe to real-time execution events via the event bus
        const { getEventBus } = await import('../orchestration/event-bus.js');
        const eventBus = getEventBus();
        let closed = false;

        reply.raw.on('error', cleanup);

        const heartbeat = setInterval(() => {
          if (closed) return;
          try {
            reply.raw.write(`: heartbeat\n\n`);
          } catch {
            cleanup();
          }
        }, 15_000);

        // Poll for status changes (in case events are missed)
        const pollInterval = setInterval(async () => {
          if (closed) return;
          try {
            const current = await queryOne<{ status: string; output: string | null; error: string | null }>(
              `SELECT status, output, error FROM forge_executions WHERE id = $1`,
              [id],
            );
            if (current && (current.status === 'completed' || current.status === 'failed')) {
              const event = JSON.stringify({
                type: 'done',
                executionId: id,
                status: current.status,
                output: current.output?.substring(0, 1000),
                error: current.error,
              });
              reply.raw.write(`data: ${event}\n\n`);
              cleanup();
            }
          } catch { /* ignore polling errors */ }
        }, 3_000);

        // Listen for execution events from the event bus
        // ForgeEvent handler — execution events have: type, event, executionId, data
        const handler = (forgeEvent: Record<string, unknown>) => {
          if (closed) return;
          if (forgeEvent['type'] !== 'execution') return;
          if (forgeEvent['executionId'] !== id) return;

          const eventName = forgeEvent['event'] as string;
          const eventData = (forgeEvent['data'] ?? {}) as Record<string, unknown>;

          const sseEvent = JSON.stringify({
            type: eventName === 'completed' || eventName === 'failed' ? 'done' : 'progress',
            executionId: id,
            status: eventName,
            ...eventData,
          });
          try {
            reply.raw.write(`data: ${sseEvent}\n\n`);
          } catch {
            cleanup();
            return;
          }

          if (eventName === 'completed' || eventName === 'failed') {
            cleanup();
          }
        };

        if (eventBus) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          eventBus.on('execution', handler as any);
        }

        function cleanup() {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          clearInterval(pollInterval);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (eventBus) eventBus.off('execution', handler as any);
          try { reply.raw.end(); } catch { /* already closed */ }
        }

        request.raw.on('close', cleanup);
      }
    },
  );

  /**
   * GET /api/v1/forge/executions - List executions for owner
   */
  app.get(
    '/api/v1/forge/executions',
    {
      schema: {
        tags: ['Executions'],
        summary: 'List executions for owner',
        querystring: ListExecutionsQuery,
        response: { 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as Static<typeof ListExecutionsQuery>;

      try {
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

        // Cursor mode: keyset pagination on (created_at DESC, id DESC)
        const afterCursor = qs.after_cursor ? decodeCursor(qs.after_cursor) : null;
        if (afterCursor) {
          conditions.push(`(e.created_at, e.id) < ($${paramIndex}::timestamptz, $${paramIndex + 1})`);
          params.push(afterCursor.t, afterCursor.id);
          paramIndex += 2;
        }

        const whereClause = conditions.join(' AND ');
        const listSql = `SELECT
               e.id, e.agent_id,
               COALESCE(a.name, 'Unknown') AS agent_name,
               e.session_id, e.owner_id, e.status,
               e.input, e.output, e.messages, e.tool_calls,
               e.iterations,
               COALESCE(ce.total_input_tokens, e.input_tokens, 0)::int AS input_tokens,
               COALESCE(ce.total_output_tokens, e.output_tokens, 0)::int AS output_tokens,
               (COALESCE(ce.total_input_tokens, e.input_tokens, 0) + COALESCE(ce.total_output_tokens, e.output_tokens, 0))::int AS total_tokens,
               COALESCE(ce.total_cost, e.cost, 0)::text AS cost,
               ce.total_cost::text AS cost_events_total,
               ce.model,
               e.duration_ms, e.error, e.metadata,
               e.started_at, e.completed_at, e.created_at
             FROM forge_executions e
             LEFT JOIN forge_agents a ON a.id = e.agent_id
             LEFT JOIN (
               SELECT
                 execution_id,
                 COALESCE(SUM(cost), 0) AS total_cost,
                 COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                 COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                 MAX(model) AS model
               FROM forge_cost_events
               GROUP BY execution_id
             ) ce ON ce.execution_id = e.id
             WHERE ${whereClause}
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

        let executions: ExecutionRow[];
        let total: number | undefined;

        if (afterCursor) {
          // Cursor mode: skip expensive COUNT, use OFFSET=0
          executions = await query<ExecutionRow>(listSql, [...params, limit, 0]);
        } else {
          const [rows, countResult] = await Promise.all([
            query<ExecutionRow>(listSql, [...params, limit, offset]),
            queryOne<ExecutionCountRow>(
              `SELECT COUNT(*) AS total FROM forge_executions WHERE ${conditions.join(' AND ')}`,
              params,
            ),
          ]);
          executions = rows;
          total = countResult ? parseInt(countResult.total, 10) : 0;
        }

        const lastItem = executions.length === limit ? executions[executions.length - 1] : null;
        const nextCursor = lastItem ? encodeCursor(lastItem.id, lastItem.created_at) : null;

        return reply.send({
          executions: executions.map((e) => ({
            ...e,
            agentName: e.agent_name,
            cost: resolveCost(e),
            estimatedCost: resolveCost(e),
            inputTokens: e.input_tokens || 0,
            outputTokens: e.output_tokens || 0,
            totalTokens: e.total_tokens || 0,
            model: e.model ?? null,
          })),
          ...(total !== undefined && { total }),
          limit,
          ...(afterCursor ? {} : { offset }),
          next_cursor: nextCursor,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to list executions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/executions/batch - Run multiple agents via individual CLI executions.
   * Accepts an array of {agentId, input} and dispatches each as a CLI execution.
   * (Batch API is deprecated — CLI uses OAuth subscription, not prepaid credits.)
   */
  app.post(
    '/api/v1/forge/executions/batch',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Batch execute multiple agents',
        body: BatchExecutionBody,
        response: { 400: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as Static<typeof BatchExecutionBody>;

      try {
        // Dispatch each agent as an individual CLI execution
        const executionIds: string[] = [];
        for (const a of body.agents) {
          const execId = ulid();
          const agent = await queryOne<AgentCheckRow>(
            `SELECT id, owner_id, status, max_cost_per_execution, model_id, system_prompt, max_iterations
             FROM forge_agents WHERE id = $1`,
            [a.agentId],
          );
          if (!agent || agent.status === 'archived') continue;

          // Enforce guardrails per-execution — prevents cost/resource abuse via batch
          const guardrailResult = await checkGuardrails({
            ownerId: userId,
            agentId: a.agentId,
            input: a.input,
            estimatedCost: parseFloat(agent.max_cost_per_execution),
          });
          if (!guardrailResult.allowed) {
            request.log.warn({ agentId: a.agentId, reason: guardrailResult.reason }, 'Batch agent blocked by guardrails');
            continue;
          }

          await queryOne<ExecutionRow>(
            `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
             VALUES ($1, $2, $3, $4, 'pending', '{}', NOW()) RETURNING *`,
            [execId, a.agentId, userId, a.input],
          );

          void runDirectCliExecution(execId, a.agentId, a.input, userId, {
            modelId: agent.model_id ?? undefined,
            systemPrompt: agent.system_prompt ?? undefined,
            maxBudgetUsd: agent.max_cost_per_execution,
            maxTurns: agent.max_iterations ?? undefined,
          }).catch((err) => {
            request.log.error({ err, executionId: execId }, 'Batch CLI execution failed');
          });

          executionIds.push(execId);
        }

        request.log.info({ count: executionIds.length }, 'Batch CLI executions dispatched');

        return reply.status(202).send({
          message: `${executionIds.length} CLI executions started`,
          agentCount: executionIds.length,
          executionIds,
          mode: 'cli',
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to process batch execution');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/executions/estimate - Estimate cost before running an execution
   * Returns min/expected/max cost based on agent config and historical data.
   */
  app.post(
    '/api/v1/forge/executions/estimate',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Estimate cost for an agent execution before running it',
        response: { 400: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as { agentId?: string; input?: string };

      if (!body.agentId) {
        return reply.status(400).send({ error: 'Bad Request', message: 'agentId is required' });
      }

      try {
        const agent = await queryOne<AgentCheckRow>(
          `SELECT id, owner_id, status, max_cost_per_execution, model_id, system_prompt, max_iterations
           FROM forge_agents
           WHERE id = $1 AND (owner_id = $2 OR is_public = true)`,
          [body.agentId, userId],
        );

        if (!agent) {
          return reply.status(404).send({ error: 'Not Found', message: 'Agent not found or not accessible' });
        }

        const model = agent.model_id ?? 'claude-sonnet-4-6';
        const maxBudget = parseFloat(agent.max_cost_per_execution) || 2.0;
        const maxTurns = agent.max_iterations ?? 25;

        interface HistoricalStatsRow {
          execution_count: string;
          avg_cost: string | null;
          p10_cost: string | null;
          p90_cost: string | null;
          avg_input_tokens: string | null;
          avg_output_tokens: string | null;
        }

        const stats = await queryOne<HistoricalStatsRow>(
          `SELECT
             COUNT(*) AS execution_count,
             AVG(total_cost)::text AS avg_cost,
             PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY total_cost)::text AS p10_cost,
             PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total_cost)::text AS p90_cost,
             AVG(total_input_tokens)::text AS avg_input_tokens,
             AVG(total_output_tokens)::text AS avg_output_tokens
           FROM (
             SELECT
               execution_id,
               COALESCE(SUM(cost), 0) AS total_cost,
               COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
               COALESCE(SUM(output_tokens), 0) AS total_output_tokens
             FROM forge_cost_events
             WHERE agent_id = $1
             GROUP BY execution_id
             HAVING SUM(cost) > 0
           ) sub`,
          [body.agentId],
        );

        const executionCount = parseInt(stats?.execution_count ?? '0', 10);

        let minCost: number;
        let expectedCost: number;
        let maxCost: number;
        let estimatedInputTokens: number;
        let estimatedOutputTokens: number;
        let basis: 'historical' | 'heuristic';

        if (executionCount >= 3) {
          // Use historical percentiles
          basis = 'historical';
          const avgCost = parseFloat(stats?.avg_cost ?? '0') || 0;
          const p10 = parseFloat(stats?.p10_cost ?? '0') || 0;
          const p90 = parseFloat(stats?.p90_cost ?? '0') || avgCost * 2;

          minCost = Math.max(0, p10);
          expectedCost = avgCost;
          maxCost = Math.min(p90, maxBudget);
          estimatedInputTokens = parseInt(stats?.avg_input_tokens ?? '0', 10) || 0;
          estimatedOutputTokens = parseInt(stats?.avg_output_tokens ?? '0', 10) || 0;
        } else {
          // Heuristic estimate from token counts
          basis = 'heuristic';
          const systemTokens = estimateTokens(agent.system_prompt ?? '');
          const inputTokens = estimateTokens(body.input ?? '');
          estimatedInputTokens = systemTokens + inputTokens;

          // Assume ~500 output tokens per turn; expected = 30% of max turns
          const outputPerTurn = 500;
          const expectedTurns = Math.ceil(maxTurns * 0.3);
          estimatedOutputTokens = outputPerTurn * expectedTurns;

          minCost = calculateCost(estimatedInputTokens, outputPerTurn, model);
          expectedCost = calculateCost(estimatedInputTokens * expectedTurns, estimatedOutputTokens, model);
          maxCost = Math.min(calculateCost(estimatedInputTokens * maxTurns, outputPerTurn * maxTurns, model), maxBudget);
        }

        return reply.send({
          agentId: body.agentId,
          model,
          maxBudget,
          estimate: {
            min: Math.round(minCost * 1e6) / 1e6,
            expected: Math.round(expectedCost * 1e6) / 1e6,
            max: Math.round(maxCost * 1e6) / 1e6,
          },
          tokens: {
            estimatedInput: estimatedInputTokens,
            estimatedOutput: estimatedOutputTokens,
          },
          basis,
          ...(executionCount >= 3 && {
            historicalStats: {
              executionCount,
              avgCost: parseFloat(stats?.avg_cost ?? '0') || 0,
              p10Cost: parseFloat(stats?.p10_cost ?? '0') || 0,
              p90Cost: parseFloat(stats?.p90_cost ?? '0') || 0,
            },
          }),
        });
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to estimate execution cost');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Internal Server Error' });
      }
    },
  );

  /**
   * POST /api/v1/forge/executions/:id/retry - Re-queue a failed or cancelled execution
   */
  app.post(
    '/api/v1/forge/executions/:id/retry',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Retry a failed or cancelled execution',
        params: IdParam,
        response: { 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

      try {
        // Fetch the original execution — must belong to this user
        const original = await queryOne<ExecutionRow>(
          `SELECT * FROM forge_executions WHERE id = $1 AND owner_id = $2`,
          [id, userId],
        );

        if (!original) {
          return reply.status(404).send({ error: 'Not Found', message: 'Execution not found' });
        }

        if (original.status !== 'failed' && original.status !== 'cancelled') {
          return reply.status(400).send({
            error: 'Bad Request',
            message: `Only failed or cancelled executions can be retried (current status: ${original.status})`,
          });
        }

        // Verify the agent is still accessible and not archived
        const agent = await queryOne<AgentCheckRow>(
          `SELECT id, owner_id, status, max_cost_per_execution, model_id, system_prompt, max_iterations
           FROM forge_agents
           WHERE id = $1 AND (owner_id = $2 OR is_public = true)`,
          [original.agent_id, userId],
        );

        if (!agent) {
          return reply.status(404).send({ error: 'Not Found', message: 'Agent not found or not accessible' });
        }

        if (agent.status === 'archived') {
          return reply.status(400).send({ error: 'Bad Request', message: 'Cannot retry: agent is archived' });
        }

        // Run guardrail checks
        const guardrailResult = await checkGuardrails({
          ownerId: userId,
          agentId: original.agent_id,
          input: original.input,
          estimatedCost: parseFloat(agent.max_cost_per_execution),
        });

        if (!guardrailResult.allowed) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: guardrailResult.reason ?? 'Blocked by guardrails',
          });
        }

        const newExecutionId = ulid();

        const newExecution = await queryOne<ExecutionRow>(
          `INSERT INTO forge_executions (id, agent_id, session_id, owner_id, input, status, metadata, started_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())
           RETURNING *`,
          [
            newExecutionId,
            original.agent_id,
            original.session_id,
            userId,
            original.input,
            JSON.stringify({ retried_from: id }),
          ],
        );

        void logAudit({
          ownerId: userId,
          action: 'execution.retry',
          resourceType: 'execution',
          resourceId: newExecutionId,
          details: { originalExecutionId: id, agentId: original.agent_id },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        void runDirectCliExecution(
          newExecutionId,
          original.agent_id,
          original.input,
          userId,
          {
            modelId: agent.model_id ?? undefined,
            systemPrompt: agent.system_prompt ?? undefined,
            sessionId: original.session_id ?? undefined,
            maxBudgetUsd: agent.max_cost_per_execution,
            maxTurns: agent.max_iterations ?? undefined,
          },
        ).catch((err) => {
          request.log.error({ err, executionId: newExecutionId }, 'Retry CLI execution failed');
          const errMsg = err instanceof Error ? err.message : String(err);
          void query(
            `UPDATE forge_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2 AND status IN ('pending', 'running')`,
            [`Failed to start retry: ${errMsg}`, newExecutionId],
          ).catch(() => {});
        });

        return reply.status(201).send({ execution: newExecution });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to retry execution');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/executions/:id/cancel - Cancel a pending or running execution
   */
  app.post(
    '/api/v1/forge/executions/:id/cancel',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Cancel a pending or running execution',
        params: IdParam,
        response: { 400: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

      try {
        const execution = await queryOne<ExecutionRow>(
          `SELECT id, status, agent_id FROM forge_executions WHERE id = $1 AND owner_id = $2`,
          [id, userId],
        );

        if (!execution) {
          return reply.status(404).send({ error: 'Not Found', message: 'Execution not found' });
        }

        if (execution.status !== 'pending' && execution.status !== 'running') {
          return reply.status(400).send({
            error: 'Bad Request',
            message: `Only pending or running executions can be cancelled (current status: ${execution.status})`,
          });
        }

        // Mark as cancelled in DB first
        await query(
          `UPDATE forge_executions SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status IN ('pending', 'running')`,
          [id],
        );

        // Attempt to kill the running process (best-effort)
        const killed = cancelCliExecution(id);

        void logAudit({
          ownerId: userId,
          action: 'execution.cancel',
          resourceType: 'execution',
          resourceId: id,
          details: { agentId: execution.agent_id, processKilled: killed },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.send({ cancelled: true, processKilled: killed });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to cancel execution');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/executions/resumable - List failed executions with checkpoint data
   * These are orphaned executions that saved iteration progress and can potentially be resumed.
   */
  app.get(
    '/api/v1/forge/executions/resumable',
    {
      schema: {
        tags: ['Executions'],
        summary: 'List resumable (failed) executions with checkpoint data',
        response: { 500: ErrorResponse },
      },
      preHandler: authMiddleware,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const rows = await query<ExecutionRow>(
          `SELECT id, agent_id, session_id, owner_id, status, input, output,
                  messages, tool_calls, iterations, input_tokens, output_tokens,
                  total_tokens, cost, duration_ms, error, metadata, started_at,
                  completed_at, created_at
           FROM forge_executions
           WHERE status = 'failed'
             AND (metadata->>'resumable')::boolean = true
             AND iterations > 0
           ORDER BY completed_at DESC
           LIMIT 50`,
        );

        return reply.send({
          executions: rows,
          count: rows.length,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to list resumable executions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/executions/bulk-status
   * Poll status for multiple executions at once.
   * Query param: ids (comma-separated execution IDs, max 100)
   */
  app.get(
    '/api/v1/forge/executions/bulk-status',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Bulk-poll status for multiple executions',
        response: { 400: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as { ids?: string };

      if (!qs.ids || qs.ids.trim() === '') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Query param "ids" is required (comma-separated execution IDs)',
        });
      }

      const ids = qs.ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (ids.length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No valid IDs provided',
        });
      }

      if (ids.length > 100) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Too many IDs — maximum 100 per request',
        });
      }

      try {
        interface BulkStatusRow {
          id: string;
          agent_id: string;
          status: string;
          started_at: string | null;
          completed_at: string | null;
          error: string | null;
        }

        const rows = await query<BulkStatusRow>(
          `SELECT id, agent_id, status, started_at, completed_at, error
           FROM forge_executions
           WHERE id = ANY($1::text[]) AND owner_id = $2`,
          [ids, userId],
        );

        // Build a map for fast lookup; return null for IDs not found (not owned or missing)
        const found = new Map(rows.map((r) => [r.id, r]));

        const result = ids.map((id) => {
          const row = found.get(id);
          if (!row) return { id, found: false };
          return {
            id: row.id,
            found: true,
            agentId: row.agent_id,
            status: row.status,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            error: row.error,
          };
        });

        return reply.send({ executions: result });
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to bulk-fetch execution status');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/executions/costs/summary
   * Daily and weekly cost summaries for the authenticated user.
   * Source of truth: forge_cost_events joined to forge_executions (owner-scoped).
   * Query param: days (default 30, max 90)
   */
  app.get(
    '/api/v1/forge/executions/costs/summary',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Cost summary (daily + weekly) for the authenticated user',
        response: { 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as { days?: string };
      const days = Math.min(parseInt(qs.days ?? '30', 10) || 30, 90);

      try {
        const [daily, weekly, totals] = await Promise.all([
          query<DailyCostSummaryRow>(
            `SELECT
               DATE(ce.created_at)::text AS date,
               COALESCE(SUM(ce.cost), 0)::text AS total_cost,
               COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
               COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
               COUNT(DISTINCT ce.execution_id)::text AS execution_count
             FROM forge_cost_events ce
             JOIN forge_executions e ON e.id = ce.execution_id
             WHERE e.owner_id = $1
               AND ce.created_at >= NOW() - INTERVAL '1 day' * $2
             GROUP BY DATE(ce.created_at)
             ORDER BY date DESC`,
            [userId, days],
          ),

          query<WeeklyCostSummaryRow>(
            `SELECT
               DATE_TRUNC('week', ce.created_at)::text AS week_start,
               COALESCE(SUM(ce.cost), 0)::text AS total_cost,
               COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
               COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
               COUNT(DISTINCT ce.execution_id)::text AS execution_count
             FROM forge_cost_events ce
             JOIN forge_executions e ON e.id = ce.execution_id
             WHERE e.owner_id = $1
               AND ce.created_at >= NOW() - INTERVAL '1 day' * $2
             GROUP BY DATE_TRUNC('week', ce.created_at)
             ORDER BY week_start DESC`,
            [userId, days],
          ),

          queryOne<{
            total_cost: string;
            total_input_tokens: string;
            total_output_tokens: string;
            execution_count: string;
            avg_cost_per_execution: string;
          }>(
            `SELECT
               COALESCE(SUM(ce.cost), 0)::text AS total_cost,
               COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
               COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
               COUNT(DISTINCT ce.execution_id)::text AS execution_count,
               CASE WHEN COUNT(DISTINCT ce.execution_id) > 0
                 THEN (SUM(ce.cost) / COUNT(DISTINCT ce.execution_id))::text
                 ELSE '0'
               END AS avg_cost_per_execution
             FROM forge_cost_events ce
             JOIN forge_executions e ON e.id = ce.execution_id
             WHERE e.owner_id = $1
               AND ce.created_at >= NOW() - INTERVAL '1 day' * $2`,
            [userId, days],
          ),
        ]);

        return reply.send({
          period: { days },
          totals: {
            totalCost: parseFloat(totals?.total_cost ?? '0') || 0,
            totalInputTokens: parseInt(totals?.total_input_tokens ?? '0', 10) || 0,
            totalOutputTokens: parseInt(totals?.total_output_tokens ?? '0', 10) || 0,
            executionCount: parseInt(totals?.execution_count ?? '0', 10) || 0,
            avgCostPerExecution: parseFloat(totals?.avg_cost_per_execution ?? '0') || 0,
          },
          daily: daily.map((r) => ({
            date: r.date,
            totalCost: parseFloat(r.total_cost) || 0,
            totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
            totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
            executionCount: parseInt(r.execution_count, 10) || 0,
          })),
          weekly: weekly.map((r) => ({
            weekStart: r.week_start,
            totalCost: parseFloat(r.total_cost) || 0,
            totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
            totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
            executionCount: parseInt(r.execution_count, 10) || 0,
          })),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to get cost summary');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );
}
