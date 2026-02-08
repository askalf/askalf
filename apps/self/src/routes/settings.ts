/**
 * Settings Routes
 * Autonomy level, budget, persona preferences
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireSelf } from '../middleware/self-auth.js';
import { logActivity } from '../services/activity-logger.js';
import { updateAgentPrompt } from '../services/self-engine.js';
import { SELF_SYSTEM_PROMPT, AUTONOMY_LABELS } from '@substrate/self-core';

interface SelfSettingsRow {
  id: string;
  name: string;
  persona: Record<string, unknown>;
  autonomy_level: number;
  daily_budget_usd: string;
  monthly_budget_usd: string;
  heartbeat_interval_ms: number;
  forge_agent_id: string | null;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /api/v1/self/settings ----
  app.get('/api/v1/self/settings', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;

    const self = await queryOne<SelfSettingsRow>(
      `SELECT id, name, persona, autonomy_level, daily_budget_usd, monthly_budget_usd,
              heartbeat_interval_ms
       FROM self_instances WHERE id = $1`,
      [selfId],
    );

    if (!self) {
      return reply.status(404).send({ error: 'SELF not found' });
    }

    return reply.send({
      settings: {
        name: self.name,
        autonomyLevel: self.autonomy_level,
        dailyBudget: parseFloat(self.daily_budget_usd),
        monthlyBudget: parseFloat(self.monthly_budget_usd),
        notificationsEnabled: false,
        emailDigest: false,
        workingHoursOnly: false,
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        timezone: 'America/New_York',
      },
    });
  });

  // ---- PATCH /api/v1/self/settings ----
  app.patch('/api/v1/self/settings', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const userId = request.userId!;

    const raw = request.body as Record<string, unknown> | undefined;

    if (!raw || Object.keys(raw).length === 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'No settings to update',
      });
    }

    // Accept both camelCase (frontend) and snake_case field names
    const body = {
      name: raw['name'] as string | undefined,
      autonomy_level: (raw['autonomyLevel'] ?? raw['autonomy_level']) as number | undefined,
      daily_budget_usd: (raw['dailyBudget'] ?? raw['daily_budget_usd']) as number | undefined,
      monthly_budget_usd: (raw['monthlyBudget'] ?? raw['monthly_budget_usd']) as number | undefined,
      persona: raw['persona'] as Record<string, unknown> | undefined,
    };

    // Validate autonomy level
    if (body.autonomy_level !== undefined) {
      if (body.autonomy_level < 1 || body.autonomy_level > 5 || !Number.isInteger(body.autonomy_level)) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'autonomy_level must be an integer between 1 and 5',
        });
      }
    }

    // Validate budgets
    if (body.daily_budget_usd !== undefined && body.daily_budget_usd < 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'daily_budget_usd must be >= 0',
      });
    }

    if (body.monthly_budget_usd !== undefined && body.monthly_budget_usd < 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'monthly_budget_usd must be >= 0',
      });
    }

    // Build update query
    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIdx = 1;
    const changes: string[] = [];

    if (body.name !== undefined) {
      updates.push(`name = $${paramIdx}`);
      values.push(body.name);
      paramIdx++;
      changes.push(`name → "${body.name}"`);
    }

    if (body.autonomy_level !== undefined) {
      updates.push(`autonomy_level = $${paramIdx}`);
      values.push(body.autonomy_level);
      paramIdx++;
      changes.push(`autonomy → ${AUTONOMY_LABELS[body.autonomy_level] ?? body.autonomy_level}`);
    }

    if (body.daily_budget_usd !== undefined) {
      updates.push(`daily_budget_usd = $${paramIdx}`);
      values.push(body.daily_budget_usd);
      paramIdx++;
      changes.push(`daily budget → $${body.daily_budget_usd.toFixed(2)}`);
    }

    if (body.monthly_budget_usd !== undefined) {
      updates.push(`monthly_budget_usd = $${paramIdx}`);
      values.push(body.monthly_budget_usd);
      paramIdx++;
      changes.push(`monthly budget → $${body.monthly_budget_usd.toFixed(2)}`);
    }

    if (body.persona !== undefined) {
      // Merge with existing persona
      const current = await queryOne<{ persona: Record<string, unknown> }>(
        `SELECT persona FROM self_instances WHERE id = $1`,
        [selfId],
      );
      const merged = { ...(current?.persona ?? {}), ...body.persona };
      updates.push(`persona = $${paramIdx}`);
      values.push(JSON.stringify(merged));
      paramIdx++;
      changes.push('persona updated');
    }

    values.push(selfId);

    await query(
      `UPDATE self_instances SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values,
    );

    // Update forge agent system prompt if name changed
    if (body.name !== undefined) {
      const self = await queryOne<SelfSettingsRow>(
        `SELECT id, forge_agent_id FROM self_instances WHERE id = $1`,
        [selfId],
      );

      if (self?.forge_agent_id) {
        let prompt = SELF_SYSTEM_PROMPT;
        if (body.name !== 'SELF') {
          prompt = prompt.replace('You are SELF', `You are ${body.name}`);
        }
        await updateAgentPrompt(self.forge_agent_id, prompt);
      }
    }

    // Log activity
    await logActivity({
      selfId,
      userId,
      type: 'system',
      title: 'Settings updated',
      body: changes.join(', '),
      importance: 4,
    });

    // Return updated settings
    const updated = await queryOne<SelfSettingsRow>(
      `SELECT id, name, persona, autonomy_level, daily_budget_usd, monthly_budget_usd,
              heartbeat_interval_ms
       FROM self_instances WHERE id = $1`,
      [selfId],
    );

    return reply.send({
      settings: {
        name: updated!.name,
        autonomyLevel: updated!.autonomy_level,
        dailyBudget: parseFloat(updated!.daily_budget_usd),
        monthlyBudget: parseFloat(updated!.monthly_budget_usd),
        notificationsEnabled: false,
        emailDigest: false,
        workingHoursOnly: false,
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        timezone: 'America/New_York',
      },
    });
  });
}
