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
import { calculateCost } from '../runtime/token-counter.js';
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
        response: { 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as Static<typeof CreateExecutionBody>;

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
          JSON.stringify({ source_layer: 'api', ...body.metadata }),
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
        },
      ).catch((err) => {
        console.error(`[Executions] Async CLI execution failed for ${executionId}:`, err);
        const errMsg = err instanceof Error ? err.message : String(err);
        void query(
          `UPDATE forge_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2 AND status IN ('pending', 'running')`,
          [`Failed to start: ${errMsg}`, executionId],
        ).catch((dbErr) => {
          console.error(`[Executions] Failed to update execution ${executionId} status:`, dbErr);
        });
      });

      return reply.status(201).send({ execution });
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
        response: { 404: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

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
        response: { 404: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
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
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as Static<typeof ListExecutionsQuery>;

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
          `SELECT
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
           ORDER BY e.created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset],
        ),
        queryOne<ExecutionCountRow>(
          `SELECT COUNT(*) AS total FROM forge_executions WHERE ${whereClause}`,
          params,
        ),
      ]);

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
        total: countResult ? parseInt(countResult.total, 10) : 0,
        limit,
        offset,
      });
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
        response: { 400: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as Static<typeof BatchExecutionBody>;

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
          console.warn(`[Batch] Agent ${a.agentId} blocked by guardrails: ${guardrailResult.reason}`);
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
          console.error(`[Batch→CLI] Execution ${execId} failed:`, err);
        });

        executionIds.push(execId);
      }

      console.log(`[Batch→CLI] Dispatched ${executionIds.length} individual CLI executions`);

      return reply.status(202).send({
        message: `${executionIds.length} CLI executions started`,
        agentCount: executionIds.length,
        executionIds,
        mode: 'cli',
      });
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
        response: { 400: ErrorResponse, 404: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

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
        console.error(`[Executions] Retry CLI execution failed for ${newExecutionId}:`, err);
        const errMsg = err instanceof Error ? err.message : String(err);
        void query(
          `UPDATE forge_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2 AND status IN ('pending', 'running')`,
          [`Failed to start retry: ${errMsg}`, newExecutionId],
        ).catch(() => {});
      });

      return reply.status(201).send({ execution: newExecution });
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
        response: { 400: ErrorResponse, 404: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

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
    },
  );

  /**
   * GET /api/v1/forge/executions/resumable - List failed executions with checkpoint data
   * These are orphaned executions that saved iteration progress and can potentially be resumed.
   */
  app.get(
    '/api/v1/forge/executions/resumable',
    { preHandler: authMiddleware },
    async (_request: FastifyRequest, reply: FastifyReply) => {
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
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as { days?: string };
      const days = Math.min(parseInt(qs.days ?? '30', 10) || 30, 90);

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
    },
  );
}
