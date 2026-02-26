/**
 * Onboarding Routes
 * Wizard completion tracking for new users
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { substrateQuery, substrateQueryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

function extractUserId(request: FastifyRequest): string | null {
  return (request as unknown as { userId?: string }).userId || null;
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/onboarding/status
   */
  app.get(
    '/api/v1/forge/onboarding/status',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const row = await substrateQueryOne<{ onboarding_completed_at: string | null }>(
        'SELECT onboarding_completed_at FROM users WHERE id = $1',
        [userId],
      );

      return { completed: !!row?.onboarding_completed_at };
    },
  );

  /**
   * POST /api/v1/forge/onboarding/complete
   */
  app.post(
    '/api/v1/forge/onboarding/complete',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as { workspace_name?: string; theme?: string } | null;
      const workspaceName = body?.workspace_name?.trim();
      const theme = body?.theme?.trim();

      // Update tenant name if provided
      if (workspaceName && workspaceName.length > 0) {
        const userRow = await substrateQueryOne<{ tenant_id: string }>(
          'SELECT tenant_id FROM users WHERE id = $1',
          [userId],
        );
        if (userRow) {
          await substrateQuery(
            'UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2',
            [workspaceName, userRow.tenant_id],
          );
        }
      }

      // Save theme preference + mark onboarding as complete
      const validThemes = ['dark', 'light', 'system'];
      const themeValue = theme && validThemes.includes(theme) ? theme : null;
      await substrateQuery(
        'UPDATE users SET onboarding_completed_at = NOW(), theme_preference = COALESCE($2, theme_preference), updated_at = NOW() WHERE id = $1',
        [userId, themeValue],
      );

      return { success: true };
    },
  );
}
