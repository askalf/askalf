/**
 * Platform Admin — Cost Summary
 * Aggregated cost data by agent, by day, and by model.
 * Route: GET /api/v1/admin/costs/summary
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { query, queryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';

interface AgentCostRow {
  agent_id: string;
  agent_name: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  event_count: string;
}

interface DayCostRow {
  date: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  event_count: string;
}

interface ModelCostRow {
  model: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  event_count: string;
}

interface TotalsRow {
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  execution_count: string;
  event_count: string;
}

export async function registerCostSummaryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/costs/summary
   * Returns total spend broken down by agent, by day, and by model.
   * Query params:
   *   days  — lookback window in days (default 30, max 90)
   */
  app.get(
    '/api/v1/admin/costs/summary',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as { days?: string };
      const days = Math.max(1, Math.min(parseInt(qs.days ?? '30', 10) || 30, 90));

      const [byAgent, byDay, byModel, totals] = await Promise.all([
        // Spend per agent
        query<AgentCostRow>(
          `SELECT
             ce.agent_id,
             COALESCE(a.name, 'Unknown') AS agent_name,
             COALESCE(SUM(ce.cost), 0)::text AS total_cost,
             COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS event_count
           FROM forge_cost_events ce
           LEFT JOIN forge_agents a ON a.id = ce.agent_id
           WHERE ce.created_at >= NOW() - INTERVAL '1 day' * $1
           GROUP BY ce.agent_id, a.name
           ORDER BY SUM(ce.cost) DESC`,
          [days],
        ),

        // Spend per day
        query<DayCostRow>(
          `SELECT
             DATE(ce.created_at)::text AS date,
             COALESCE(SUM(ce.cost), 0)::text AS total_cost,
             COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS event_count
           FROM forge_cost_events ce
           WHERE ce.created_at >= NOW() - INTERVAL '1 day' * $1
           GROUP BY DATE(ce.created_at)
           ORDER BY date DESC`,
          [days],
        ),

        // Spend per model
        query<ModelCostRow>(
          `SELECT
             ce.model,
             COALESCE(SUM(ce.cost), 0)::text AS total_cost,
             COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS event_count
           FROM forge_cost_events ce
           WHERE ce.created_at >= NOW() - INTERVAL '1 day' * $1
           GROUP BY ce.model
           ORDER BY SUM(ce.cost) DESC`,
          [days],
        ),

        // Overall totals
        queryOne<TotalsRow>(
          `SELECT
             COALESCE(SUM(ce.cost), 0)::text AS total_cost,
             COALESCE(SUM(ce.input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(ce.output_tokens), 0)::text AS total_output_tokens,
             COUNT(DISTINCT ce.execution_id)::text AS execution_count,
             COUNT(*)::text AS event_count
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
          eventCount: parseInt(totals?.event_count ?? '0', 10) || 0,
        },
        byAgent: byAgent.map((r) => ({
          agentId: r.agent_id,
          agentName: r.agent_name,
          totalCost: parseFloat(r.total_cost) || 0,
          totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
          totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
          eventCount: parseInt(r.event_count, 10) || 0,
        })),
        byDay: byDay.map((r) => ({
          date: r.date,
          totalCost: parseFloat(r.total_cost) || 0,
          totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
          totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
          eventCount: parseInt(r.event_count, 10) || 0,
        })),
        byModel: byModel.map((r) => ({
          model: r.model,
          totalCost: parseFloat(r.total_cost) || 0,
          totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
          totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
          eventCount: parseInt(r.event_count, 10) || 0,
        })),
      };
    },
  );
}
