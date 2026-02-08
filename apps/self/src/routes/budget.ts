/**
 * Budget Dashboard Routes
 * Cost tracking, usage history, and budget management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireSelf } from '../middleware/self-auth.js';

interface DailySpend {
  date: string;
  total_cost: string;
  total_tokens: string;
  action_count: string;
}

interface CostBreakdown {
  type: string;
  total_cost: string;
  count: string;
}

export async function budgetRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /api/v1/self/budget ----
  // Current budget overview
  app.get('/api/v1/self/budget', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;

    const self = await queryOne<{
      daily_budget_usd: string;
      monthly_budget_usd: string;
      daily_spent_usd: string;
      monthly_spent_usd: string;
      total_cost_usd: string;
    }>(
      `SELECT daily_budget_usd, monthly_budget_usd, daily_spent_usd, monthly_spent_usd, total_cost_usd
       FROM self_instances WHERE id = $1`,
      [selfId],
    );

    if (!self) {
      return reply.status(404).send({ error: 'SELF not found' });
    }

    return reply.send({
      budget: {
        daily: {
          limit: parseFloat(self.daily_budget_usd),
          spent: parseFloat(self.daily_spent_usd),
          remaining: parseFloat(self.daily_budget_usd) - parseFloat(self.daily_spent_usd),
          usage_percent: parseFloat(self.daily_budget_usd) > 0
            ? (parseFloat(self.daily_spent_usd) / parseFloat(self.daily_budget_usd)) * 100
            : 0,
        },
        monthly: {
          limit: parseFloat(self.monthly_budget_usd),
          spent: parseFloat(self.monthly_spent_usd),
          remaining: parseFloat(self.monthly_budget_usd) - parseFloat(self.monthly_spent_usd),
          usage_percent: parseFloat(self.monthly_budget_usd) > 0
            ? (parseFloat(self.monthly_spent_usd) / parseFloat(self.monthly_budget_usd)) * 100
            : 0,
        },
        total_lifetime: parseFloat(self.total_cost_usd),
        history: [],
        breakdown: [],
      },
    });
  });

  // ---- GET /api/v1/self/budget/history ----
  // Daily spending history
  app.get('/api/v1/self/budget/history', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const qs = request.query as { days?: string };
    const days = parseInt(qs.days ?? '30', 10);

    const history = await query<DailySpend>(
      `SELECT
         DATE(created_at) as date,
         SUM(cost_usd) as total_cost,
         SUM(tokens_used) as total_tokens,
         COUNT(*) as action_count
       FROM self_activities
       WHERE self_id = $1 AND cost_usd > 0
         AND created_at > NOW() - ($2 || ' days')::interval
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [selfId, days],
    );

    return reply.send({
      history: history.map(h => ({
        date: h.date,
        cost_usd: parseFloat(h.total_cost),
        tokens: parseInt(h.total_tokens, 10),
        actions: parseInt(h.action_count, 10),
      })),
    });
  });

  // ---- GET /api/v1/self/budget/breakdown ----
  // Cost breakdown by activity type
  app.get('/api/v1/self/budget/breakdown', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const qs = request.query as { period?: string };
    const period = qs.period ?? '30';

    const breakdown = await query<CostBreakdown>(
      `SELECT
         type,
         SUM(cost_usd) as total_cost,
         COUNT(*) as count
       FROM self_activities
       WHERE self_id = $1 AND cost_usd > 0
         AND created_at > NOW() - ($2 || ' days')::interval
       GROUP BY type
       ORDER BY total_cost DESC`,
      [selfId, period],
    );

    return reply.send({
      breakdown: breakdown.map(b => ({
        type: b.type,
        cost_usd: parseFloat(b.total_cost),
        count: parseInt(b.count, 10),
      })),
    });
  });
}
