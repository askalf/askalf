/**
 * Ask Alf Preference Routes
 * Default provider/model preferences
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { askalfQuery, askalfQueryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

export async function preferenceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/askalf/preferences — Get user preferences
   */
  app.get(
    '/api/v1/askalf/preferences',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const prefs = await askalfQueryOne<{
        default_provider: string;
        default_model: string | null;
      }>(
        `SELECT default_provider, default_model FROM askalf_preferences WHERE user_id = $1`,
        [userId],
      );

      return reply.send({
        preferences: prefs || { default_provider: 'auto', default_model: null },
      });
    },
  );

  /**
   * PUT /api/v1/askalf/preferences — Update preferences
   * Body: { defaultProvider?: string, defaultModel?: string }
   */
  app.put(
    '/api/v1/askalf/preferences',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as { defaultProvider?: string; defaultModel?: string };

      const validProviders = ['auto', 'claude', 'openai'];
      const defaultProvider = body.defaultProvider && validProviders.includes(body.defaultProvider)
        ? body.defaultProvider
        : 'auto';
      const defaultModel = body.defaultModel || null;

      await askalfQuery(
        `INSERT INTO askalf_preferences (id, user_id, default_provider, default_model)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           default_provider = $3, default_model = $4, updated_at = NOW()`,
        [ulid(), userId, defaultProvider, defaultModel],
      );

      return reply.send({
        preferences: { default_provider: defaultProvider, default_model: defaultModel },
      });
    },
  );
}
