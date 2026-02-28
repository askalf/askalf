/**
 * User Budget Routes
 * GET/PUT budget limits from forge_user_preferences
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface BudgetPrefs {
  budget_limit_daily: string | null;
  budget_limit_monthly: string | null;
}

interface BudgetSpend {
  total: string;
}

export async function userBudgetRoutes(app: FastifyInstance) {
  /**
   * GET /api/v1/forge/user-budget — get current budget limits + spend
   */
  app.get(
    '/api/v1/forge/user-budget',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as unknown as { userId: string }).userId;

      // Get preferences
      const prefs = await queryOne<BudgetPrefs>(
        `SELECT budget_limit_daily, budget_limit_monthly
         FROM forge_user_preferences WHERE user_id = $1`,
        [userId],
      );

      // Get today's spend
      const todaySpend = await queryOne<BudgetSpend>(
        `SELECT COALESCE(SUM(cost), 0) as total
         FROM forge_cost_events
         WHERE owner_id = $1 AND created_at >= CURRENT_DATE`,
        [userId],
      );

      // Get this month's spend
      const monthSpend = await queryOne<BudgetSpend>(
        `SELECT COALESCE(SUM(cost), 0) as total
         FROM forge_cost_events
         WHERE owner_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [userId],
      );

      return reply.send({
        budgetLimitDaily: prefs?.budget_limit_daily ? parseFloat(prefs.budget_limit_daily) : null,
        budgetLimitMonthly: prefs?.budget_limit_monthly ? parseFloat(prefs.budget_limit_monthly) : null,
        spentToday: parseFloat(todaySpend?.total ?? '0'),
        spentThisMonth: parseFloat(monthSpend?.total ?? '0'),
      });
    },
  );

  /**
   * PUT /api/v1/forge/user-budget — update budget limits
   */
  app.put(
    '/api/v1/forge/user-budget',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as unknown as { userId: string }).userId;
      const body = request.body as { budgetLimitDaily?: number | null; budgetLimitMonthly?: number | null } | undefined;

      const daily = body?.budgetLimitDaily ?? null;
      const monthly = body?.budgetLimitMonthly ?? null;

      // Validate
      if (daily !== null && (typeof daily !== 'number' || daily < 0)) {
        return reply.status(400).send({ error: 'budgetLimitDaily must be a positive number or null' });
      }
      if (monthly !== null && (typeof monthly !== 'number' || monthly < 0)) {
        return reply.status(400).send({ error: 'budgetLimitMonthly must be a positive number or null' });
      }

      // Upsert
      await query(
        `INSERT INTO forge_user_preferences (id, user_id, budget_limit_daily, budget_limit_monthly)
         VALUES (gen_random_uuid()::text, $1, $2, $3)
         ON CONFLICT (user_id)
         DO UPDATE SET budget_limit_daily = $2, budget_limit_monthly = $3, updated_at = NOW()`,
        [userId, daily, monthly],
      );

      return reply.send({ success: true, budgetLimitDaily: daily, budgetLimitMonthly: monthly });
    },
  );
}
