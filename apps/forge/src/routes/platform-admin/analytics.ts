/**
 * Platform Admin — Fleet-wide cost analytics & audit
 * Unlike /api/v1/forge/admin/costs (user-scoped), these endpoints show ALL cost data.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { query } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';

interface CostSummaryRow {
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  total_events: string;
}

interface DailyCostRow {
  date: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  event_count: string;
}

interface AgentCostRow {
  agent_id: string;
  agent_name: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  total_events: string;
}

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {

  // Fleet-wide cost summary + daily breakdown (not user-scoped)
  app.get(
    '/api/v1/admin/costs',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as {
        startDate?: string;
        endDate?: string;
        agentId?: string;
        days?: string;
      };

      const days = Math.min(parseInt(qs.days ?? '30', 10) || 30, 90);

      // Build conditions for optional agent filter
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (qs.agentId) {
        params.push(qs.agentId);
        conditions.push(`agent_id = $${params.length}`);
      }
      if (qs.startDate) {
        params.push(qs.startDate);
        conditions.push(`created_at >= $${params.length}`);
      }
      if (qs.endDate) {
        params.push(qs.endDate);
        conditions.push(`created_at <= $${params.length}`);
      }

      // Default time filter if no explicit dates
      if (!qs.startDate && !qs.endDate) {
        params.push(days);
        conditions.push(`created_at >= NOW() - INTERVAL '1 day' * $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [summaryRow, dailyRows, agentRows] = await Promise.all([
        // Aggregate summary
        query<CostSummaryRow>(
          `SELECT
             COALESCE(SUM(cost), 0)::text AS total_cost,
             COALESCE(SUM(input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS total_events
           FROM forge_cost_events
           ${where}`,
          params,
        ),

        // Daily breakdown
        query<DailyCostRow>(
          `SELECT
             DATE(created_at)::text AS date,
             COALESCE(SUM(cost), 0)::text AS total_cost,
             COALESCE(SUM(input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS event_count
           FROM forge_cost_events
           ${where}
           GROUP BY DATE(created_at)
           ORDER BY date DESC`,
          params,
        ),

        // Per-agent breakdown
        query<AgentCostRow>(
          `SELECT
             c.agent_id,
             COALESCE(a.name, 'Unknown') AS agent_name,
             COALESCE(SUM(c.cost), 0)::text AS total_cost,
             COALESCE(SUM(c.input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(c.output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS total_events
           FROM forge_cost_events c
           LEFT JOIN forge_agents a ON a.id = c.agent_id
           ${where.replace(/created_at/g, 'c.created_at').replace(/agent_id/g, 'c.agent_id')}
           GROUP BY c.agent_id, a.name
           ORDER BY SUM(c.cost) DESC`,
          params,
        ),
      ]);

      const row = summaryRow[0];
      const summary = {
        totalCost: row ? parseFloat(row.total_cost) || 0 : 0,
        totalInputTokens: row ? parseInt(row.total_input_tokens, 10) || 0 : 0,
        totalOutputTokens: row ? parseInt(row.total_output_tokens, 10) || 0 : 0,
        totalEvents: row ? parseInt(row.total_events, 10) || 0 : 0,
      };

      const dailyCosts = dailyRows.map((r) => ({
        date: r.date,
        totalCost: parseFloat(r.total_cost) || 0,
        totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
        totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
        eventCount: parseInt(r.event_count, 10) || 0,
      }));

      const byAgent = agentRows.map((r) => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        totalCost: parseFloat(r.total_cost) || 0,
        totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
        totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
        totalEvents: parseInt(r.total_events, 10) || 0,
      }));

      return { summary, dailyCosts, byAgent };
    },
  );

  // Hourly cost breakdown for the last N hours
  app.get(
    '/api/v1/admin/costs/hourly',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { hours = '24' } = request.query as { hours?: string };
      const hoursNum = Math.min(parseInt(hours, 10) || 24, 72);

      const rows = await query<{
        hour: string;
        total_cost: string;
        event_count: string;
      }>(
        `SELECT
           date_trunc('hour', created_at)::text AS hour,
           COALESCE(SUM(cost), 0)::text AS total_cost,
           COUNT(*)::text AS event_count
         FROM forge_cost_events
         WHERE created_at >= NOW() - make_interval(hours => $1)
         GROUP BY date_trunc('hour', created_at)
         ORDER BY hour DESC`,
        [hoursNum],
      );

      return {
        hourly: rows.map((r) => ({
          hour: r.hour,
          totalCost: parseFloat(r.total_cost) || 0,
          eventCount: parseInt(r.event_count, 10) || 0,
        })),
        hours: hoursNum,
      };
    },
  );
}
