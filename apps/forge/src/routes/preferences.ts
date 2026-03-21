/**
 * User Preferences Routes
 * Alf learns your style — model choices, tone, conventions, budgets.
 * Preferences are stored per-user and injected into agent system prompts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface Preference {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  last_used_at: string | null;
  created_at: string;
}

export async function preferencesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/preferences — list all user preferences
   */
  app.get(
    '/api/v1/forge/preferences',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = request.userId!;
      const prefs = await query<Preference>(
        `SELECT id, category, key, value, confidence, source, last_used_at, created_at
         FROM forge_user_preferences WHERE user_id = $1
         ORDER BY category, key`,
        [userId],
      );
      return { preferences: prefs };
    },
  );

  /**
   * PUT /api/v1/forge/preferences — set a preference (explicit)
   */
  app.put(
    '/api/v1/forge/preferences',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as { category?: string; key?: string; value?: string };

      if (!body.category || !body.key || !body.value) {
        return reply.status(400).send({ error: 'category, key, and value are required' });
      }

      const id = ulid();
      await query(
        `INSERT INTO forge_user_preferences (id, user_id, category, key, value, confidence, source, last_used_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1.0, 'explicit', NOW(), NOW())
         ON CONFLICT (user_id, category, key)
         DO UPDATE SET value = $5, confidence = 1.0, source = 'explicit', last_used_at = NOW(), updated_at = NOW()`,
        [id, userId, body.category, body.key, body.value],
      );

      return { ok: true, category: body.category, key: body.key };
    },
  );

  /**
   * DELETE /api/v1/forge/preferences/:id — remove a preference
   */
  app.delete(
    '/api/v1/forge/preferences/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      await query(
        `DELETE FROM forge_user_preferences WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return { ok: true };
    },
  );

  /**
   * GET /api/v1/forge/preferences/prompt-context — get preferences formatted for agent prompts
   */
  app.get(
    '/api/v1/forge/preferences/prompt-context',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = request.userId!;
      const prefs = await query<{ category: string; key: string; value: string }>(
        `SELECT category, key, value FROM forge_user_preferences
         WHERE user_id = $1 AND confidence >= 0.5
         ORDER BY category, key`,
        [userId],
      );

      if (prefs.length === 0) return { context: '' };

      const grouped: Record<string, string[]> = {};
      for (const p of prefs) {
        if (!grouped[p.category]) grouped[p.category] = [];
        grouped[p.category]!.push(`${p.key}: ${p.value}`);
      }

      const lines = Object.entries(grouped)
        .map(([cat, items]) => `${cat}: ${items.join(', ')}`)
        .join('\n');

      return { context: `USER PREFERENCES (learned from past interactions):\n${lines}` };
    },
  );

  /**
   * POST /api/v1/forge/preferences/learn — called by agents to record observed preferences
   */
  app.post(
    '/api/v1/forge/preferences/learn',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { user_id?: string; category?: string; key?: string; value?: string; confidence?: number };

      if (!body.user_id || !body.category || !body.key || !body.value) {
        return reply.status(400).send({ error: 'user_id, category, key, and value are required' });
      }

      const confidence = Math.min(1, Math.max(0, body.confidence ?? 0.5));
      const id = ulid();

      await query(
        `INSERT INTO forge_user_preferences (id, user_id, category, key, value, confidence, source, last_used_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'observed', NOW(), NOW())
         ON CONFLICT (user_id, category, key)
         DO UPDATE SET
           value = CASE WHEN forge_user_preferences.source = 'explicit' THEN forge_user_preferences.value ELSE $5 END,
           confidence = CASE WHEN forge_user_preferences.source = 'explicit' THEN forge_user_preferences.confidence ELSE GREATEST(forge_user_preferences.confidence, $6) END,
           last_used_at = NOW(),
           updated_at = NOW()`,
        [id, body.user_id, body.category, body.key, body.value, confidence],
      );

      return { ok: true };
    },
  );
}
