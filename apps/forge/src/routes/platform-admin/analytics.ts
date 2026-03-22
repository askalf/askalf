/**
 * Platform Admin — Fleet-wide cost analytics & audit
 * Unlike /api/v1/forge/admin/costs (user-scoped), these endpoints show ALL cost data.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../database.js';
import { authMiddleware, requireAdmin } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';

// CLI events have metadata->>'runtime_mode' = 'cli'. Everything else is API.
const IS_CLI = `metadata->>'runtime_mode' = 'cli'`;

interface CostSummaryRow {
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  total_events: string;
  api_cost: string;
  api_input_tokens: string;
  api_output_tokens: string;
  api_events: string;
  cli_cost: string;
  cli_input_tokens: string;
  cli_output_tokens: string;
  cli_events: string;
  cli_estimated_cost: string;
}

interface DailyCostRow {
  date: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  event_count: string;
  api_cost: string;
  api_events: string;
  cli_cost: string;
  cli_events: string;
  cli_estimated_cost: string;
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
        // Aggregate summary with API/CLI split
        query<CostSummaryRow>(
          `SELECT
             COALESCE(SUM(cost), 0)::text AS total_cost,
             COALESCE(SUM(input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS total_events,
             COALESCE(SUM(CASE WHEN NOT (${IS_CLI}) THEN cost ELSE 0 END), 0)::text AS api_cost,
             COALESCE(SUM(CASE WHEN NOT (${IS_CLI}) THEN input_tokens ELSE 0 END), 0)::text AS api_input_tokens,
             COALESCE(SUM(CASE WHEN NOT (${IS_CLI}) THEN output_tokens ELSE 0 END), 0)::text AS api_output_tokens,
             COUNT(*) FILTER (WHERE NOT (${IS_CLI}))::text AS api_events,
             COALESCE(SUM(CASE WHEN ${IS_CLI} THEN cost ELSE 0 END), 0)::text AS cli_cost,
             COALESCE(SUM(CASE WHEN ${IS_CLI} THEN input_tokens ELSE 0 END), 0)::text AS cli_input_tokens,
             COALESCE(SUM(CASE WHEN ${IS_CLI} THEN output_tokens ELSE 0 END), 0)::text AS cli_output_tokens,
             COUNT(*) FILTER (WHERE ${IS_CLI})::text AS cli_events,
             COALESCE(SUM(CASE WHEN ${IS_CLI} THEN (metadata->>'estimated_cost')::numeric ELSE 0 END), 0)::text AS cli_estimated_cost
           FROM forge_cost_events
           ${where}`,
          params,
        ),

        // Daily breakdown with API/CLI split
        query<DailyCostRow>(
          `SELECT
             DATE(created_at)::text AS date,
             COALESCE(SUM(cost), 0)::text AS total_cost,
             COALESCE(SUM(input_tokens), 0)::text AS total_input_tokens,
             COALESCE(SUM(output_tokens), 0)::text AS total_output_tokens,
             COUNT(*)::text AS event_count,
             COALESCE(SUM(CASE WHEN NOT (${IS_CLI}) THEN cost ELSE 0 END), 0)::text AS api_cost,
             COUNT(*) FILTER (WHERE NOT (${IS_CLI}))::text AS api_events,
             COALESCE(SUM(CASE WHEN ${IS_CLI} THEN cost ELSE 0 END), 0)::text AS cli_cost,
             COUNT(*) FILTER (WHERE ${IS_CLI})::text AS cli_events,
             COALESCE(SUM(CASE WHEN ${IS_CLI} THEN (metadata->>'estimated_cost')::numeric ELSE 0 END), 0)::text AS cli_estimated_cost
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
        total: {
          totalCost: row ? parseFloat(row.total_cost) || 0 : 0,
          totalInputTokens: row ? parseInt(row.total_input_tokens, 10) || 0 : 0,
          totalOutputTokens: row ? parseInt(row.total_output_tokens, 10) || 0 : 0,
          totalEvents: row ? parseInt(row.total_events, 10) || 0 : 0,
        },
        api: {
          totalCost: row ? parseFloat(row.api_cost) || 0 : 0,
          totalInputTokens: row ? parseInt(row.api_input_tokens, 10) || 0 : 0,
          totalOutputTokens: row ? parseInt(row.api_output_tokens, 10) || 0 : 0,
          totalEvents: row ? parseInt(row.api_events, 10) || 0 : 0,
        },
        cli: {
          totalCost: row ? parseFloat(row.cli_cost) || 0 : 0,
          totalInputTokens: row ? parseInt(row.cli_input_tokens, 10) || 0 : 0,
          totalOutputTokens: row ? parseInt(row.cli_output_tokens, 10) || 0 : 0,
          totalEvents: row ? parseInt(row.cli_events, 10) || 0 : 0,
          estimatedCost: row ? parseFloat(row.cli_estimated_cost) || 0 : 0,
        },
      };

      const dailyCosts = dailyRows.map((r) => ({
        date: r.date,
        totalCost: parseFloat(r.total_cost) || 0,
        totalInputTokens: parseInt(r.total_input_tokens, 10) || 0,
        totalOutputTokens: parseInt(r.total_output_tokens, 10) || 0,
        eventCount: parseInt(r.event_count, 10) || 0,
        apiCost: parseFloat(r.api_cost) || 0,
        apiEvents: parseInt(r.api_events, 10) || 0,
        cliCost: parseFloat(r.cli_cost) || 0,
        cliEvents: parseInt(r.cli_events, 10) || 0,
        cliEstimatedCost: parseFloat(r.cli_estimated_cost) || 0,
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

  // Cost forecast — simple linear projection based on recent daily averages
  app.get(
    '/api/v1/admin/costs/forecast',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const { horizon = '7d' } = request.query as { horizon?: string };
      const days = parseInt(horizon.replace('d', ''), 10) || 7;

      // Get daily costs for the last 14 days to build the trend
      const dailyCosts = await query<{ date: string; total_cost: string; event_count: string }>(
        `SELECT DATE(created_at)::text AS date,
                COALESCE(SUM(cost), 0)::text AS total_cost,
                COUNT(*)::text AS event_count
         FROM forge_cost_events
         WHERE created_at >= NOW() - INTERVAL '14 days'
         GROUP BY DATE(created_at)
         ORDER BY date`,
      );

      if (dailyCosts.length === 0) {
        return { hourly_forecast: [], total_predicted: 0, confidence_range: { low: 0, high: 0 }, avg_confidence: 0 };
      }

      const costs = dailyCosts.map(r => parseFloat(r.total_cost) || 0);
      const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
      const variance = costs.reduce((s, c) => s + (c - avg) ** 2, 0) / costs.length;
      const stddev = Math.sqrt(variance);

      // Project forward hour by hour
      const hourly_forecast: { hour: string; predicted_cost: number; confidence: number }[] = [];
      const hourlyAvg = avg / 24;
      const now = new Date();
      for (let h = 0; h < days * 24; h++) {
        const hour = new Date(now.getTime() + h * 3600_000);
        const confidence = Math.max(0.3, 1 - (h / (days * 24)) * 0.5);
        hourly_forecast.push({
          hour: hour.toISOString(),
          predicted_cost: Math.round(hourlyAvg * 10000) / 10000,
          confidence,
        });
      }

      const total_predicted = Math.round(avg * days * 100) / 100;
      const avg_confidence = Math.max(0.4, 1 - days * 0.05);

      return {
        hourly_forecast,
        total_predicted,
        confidence_range: {
          low: Math.max(0, Math.round((avg - stddev) * days * 100) / 100),
          high: Math.round((avg + stddev) * days * 100) / 100,
        },
        avg_confidence: Math.round(avg_confidence * 100) / 100,
      };
    },
  );

  // Model pricing — list all pricing (defaults + overrides)
  app.get(
    '/api/v1/admin/costs/pricing',
    { preHandler: [rateLimiter, authMiddleware, requireAdmin] },
    async () => {
      const { getAllPricing } = await import('../../runtime/token-counter.js');
      return { pricing: await getAllPricing() };
    },
  );

  // Model pricing — set/update a price override
  app.put(
    '/api/v1/admin/costs/pricing',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { model_id?: string; provider?: string; display_name?: string; input_per_1k?: number; output_per_1k?: number };
      if (!body.model_id || body.input_per_1k == null || body.output_per_1k == null) {
        return reply.status(400).send({ error: 'model_id, input_per_1k, and output_per_1k required' });
      }
      await query(
        `INSERT INTO forge_model_pricing (model_id, provider, display_name, input_per_1k, output_per_1k, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (model_id) DO UPDATE SET input_per_1k = $4, output_per_1k = $5, display_name = $3, updated_at = NOW()`,
        [body.model_id, body.provider ?? 'unknown', body.display_name ?? body.model_id, body.input_per_1k, body.output_per_1k],
      );
      return { ok: true };
    },
  );

}
