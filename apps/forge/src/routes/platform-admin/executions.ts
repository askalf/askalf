/**
 * Platform Admin — Executions list with enriched cost tracking
 * Provides per-execution cost, token usage, and daily/weekly cost summaries.
 * Joins forge_cost_events for accurate cost data (more reliable than forge_executions.cost alone).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';

interface ExecutionCostRow {
  id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  iterations: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: string;
  cost_events_total: string | null;
  model: string | null;
  duration_ms: number | null;
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

interface TotalCountRow {
  total: string;
}

export async function registerExecutionCostRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/admin/executions
   * Paginated list of all executions with enriched cost data.
   * Joins cost_events for accurate cost; includes agent name and model.
   */
  app.get(
    '/api/v1/admin/executions/costs',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as {
        page?: string;
        limit?: string;
        agentId?: string;
        status?: string;
        days?: string;
      };

      const page = Math.max(parseInt(qs.page ?? '1', 10) || 1, 1);
      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100));
      const offset = (page - 1) * limit;
      const days = Math.max(1, Math.min(parseInt(qs.days ?? '30', 10) || 30, 90));

      const conditions: string[] = [`e.created_at >= NOW() - INTERVAL '1 day' * $1`];
      const params: unknown[] = [days];

      if (qs.agentId) {
        params.push(qs.agentId);
        conditions.push(`e.agent_id = $${params.length}`);
      }
      if (qs.status) {
        params.push(qs.status);
        conditions.push(`e.status = $${params.length}`);
      }

      const where = `WHERE ${conditions.join(' AND ')}`;

      const [rows, countResult] = await Promise.all([
        query<ExecutionCostRow>(
          `SELECT
             e.id,
             e.agent_id,
             COALESCE(a.name, 'Unknown') AS agent_name,
             e.status,
             LEFT(e.input, 200) AS input,
             LEFT(e.output, 500) AS output,
             e.error,
             e.iterations,
             COALESCE(ce.total_input_tokens, e.input_tokens, 0)::int AS input_tokens,
             COALESCE(ce.total_output_tokens, e.output_tokens, 0)::int AS output_tokens,
             (COALESCE(ce.total_input_tokens, e.input_tokens, 0) + COALESCE(ce.total_output_tokens, e.output_tokens, 0))::int AS total_tokens,
             COALESCE(ce.total_cost, e.cost, 0)::text AS cost,
             ce.total_cost::text AS cost_events_total,
             ce.model,
             e.duration_ms,
             e.started_at,
             e.completed_at,
             e.created_at
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
           ${where}
           ORDER BY e.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        queryOne<TotalCountRow>(
          `SELECT COUNT(*)::text AS total FROM forge_executions e ${where}`,
          params,
        ),
      ]);

      const total = countResult ? parseInt(countResult.total, 10) : 0;

      return reply.send({
        executions: rows.map((r) => ({
          id: r.id,
          agentId: r.agent_id,
          agentName: r.agent_name,
          status: r.status,
          input: r.input,
          output: r.output,
          error: r.error,
          iterations: r.iterations || 0,
          inputTokens: r.input_tokens || 0,
          outputTokens: r.output_tokens || 0,
          totalTokens: r.total_tokens || 0,
          cost: parseFloat(r.cost) || 0,
          model: r.model ?? null,
          durationMs: r.duration_ms ?? null,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          createdAt: r.created_at,
        })),
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      });
    },
  );

  /**
   * GET /api/v1/admin/executions/costs/summary
   * Daily and weekly cost summaries across all executions.
   * Uses forge_cost_events as the source of truth.
   */
  app.get(
    '/api/v1/admin/executions/costs/summary',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as { days?: string };
      const days = Math.min(parseInt(qs.days ?? '30', 10) || 30, 90);

      const [daily, weekly, totals] = await Promise.all([
        // Daily breakdown from cost_events
        query<DailyCostSummaryRow>(
          `SELECT
             DATE(ce.created_at)::text AS date,
             COALESCE(SUM(ce.cost), 0)::text AS total_cost,
             COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
             COUNT(DISTINCT ce.execution_id)::text AS execution_count
           FROM forge_cost_events ce
           WHERE ce.created_at >= NOW() - INTERVAL '1 day' * $1
           GROUP BY DATE(ce.created_at)
           ORDER BY date DESC`,
          [days],
        ),

        // Weekly breakdown
        query<WeeklyCostSummaryRow>(
          `SELECT
             DATE_TRUNC('week', ce.created_at)::text AS week_start,
             COALESCE(SUM(ce.cost), 0)::text AS total_cost,
             COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
             COUNT(DISTINCT ce.execution_id)::text AS execution_count
           FROM forge_cost_events ce
           WHERE ce.created_at >= NOW() - INTERVAL '1 day' * $1
           GROUP BY DATE_TRUNC('week', ce.created_at)
           ORDER BY week_start DESC`,
          [days],
        ),

        // Overall totals for the period
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
           WHERE ce.created_at >= NOW() - INTERVAL '1 day' * $1`,
          [days],
        ),
      ]);

      return {
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
      };
    },
  );

  /**
   * GET /api/v1/admin/executions/:id/cost
   * Cost breakdown for a single execution.
   */
  app.get(
    '/api/v1/admin/executions/:id/cost',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const [execution, costEvents] = await Promise.all([
        queryOne<{ id: string; agent_id: string; status: string; input_tokens: number; output_tokens: number; cost: string }>(
          `SELECT id, agent_id, status, input_tokens, output_tokens, cost FROM forge_executions WHERE id = $1`,
          [id],
        ),
        query<{ provider: string; model: string; input_tokens: number; output_tokens: number; cost: string; created_at: string }>(
          `SELECT provider, model, input_tokens, output_tokens, cost::text, created_at
           FROM forge_cost_events
           WHERE execution_id = $1
           ORDER BY created_at ASC`,
          [id],
        ),
      ]);

      if (!execution) {
        return reply.status(404).send({ error: 'Not Found', message: 'Execution not found' });
      }

      const eventTotalCost = costEvents.reduce((sum, e) => sum + (parseFloat(e.cost) || 0), 0);
      const eventInputTokens = costEvents.reduce((sum, e) => sum + (e.input_tokens || 0), 0);
      const eventOutputTokens = costEvents.reduce((sum, e) => sum + (e.output_tokens || 0), 0);

      return {
        executionId: id,
        status: execution.status,
        totalCost: eventTotalCost || parseFloat(execution.cost) || 0,
        totalInputTokens: eventInputTokens || execution.input_tokens || 0,
        totalOutputTokens: eventOutputTokens || execution.output_tokens || 0,
        events: costEvents.map((e) => ({
          provider: e.provider,
          model: e.model,
          inputTokens: e.input_tokens,
          outputTokens: e.output_tokens,
          cost: parseFloat(e.cost) || 0,
          createdAt: e.created_at,
        })),
      };
    },
  );
}
