/**
 * Onboarding Routes
 * First-run experience guidance
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { queryOne } from '../database.js';
import { AUTONOMY_LABELS, INTEGRATION_CATALOG } from '@substrate/self-core';

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /api/v1/self/onboarding/status ----
  // Check onboarding progress
  app.get('/api/v1/self/onboarding/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const selfExists = await queryOne<{ id: string; status: string; conversations: number }>(
      `SELECT id, status, conversations FROM self_instances WHERE user_id = $1`,
      [userId],
    );

    const hasIntegration = selfExists
      ? await queryOne<{ id: string }>(
          `SELECT id FROM self_integrations
           WHERE self_id = $1 AND status = 'connected' LIMIT 1`,
          [selfExists.id],
        )
      : null;

    return reply.send({
      steps: {
        activated: !!selfExists,
        first_conversation: (selfExists?.conversations ?? 0) > 0,
        integration_connected: !!hasIntegration,
        autonomy_set: !!selfExists, // Set during activation
      },
      complete: !!selfExists && (selfExists.conversations ?? 0) > 0,
    });
  });

  // ---- GET /api/v1/self/onboarding/options ----
  // Get options for onboarding UI
  app.get('/api/v1/self/onboarding/options', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      autonomy_levels: Object.entries(AUTONOMY_LABELS).map(([level, label]) => ({
        level: parseInt(level, 10),
        label,
        description: getAutonomyDescription(parseInt(level, 10)),
      })),
      integrations: INTEGRATION_CATALOG.map(i => ({
        provider: i.provider,
        display_name: i.display_name,
        description: i.description,
        available: i.available,
      })),
    });
  });
}

function getAutonomyDescription(level: number): string {
  switch (level) {
    case 1: return 'SELF asks before every action. Maximum control.';
    case 2: return 'SELF handles low-risk tasks, asks for anything important.';
    case 3: return 'Balanced. SELF handles routine work, asks before risky actions.';
    case 4: return 'SELF handles most things, only asks for high-risk actions.';
    case 5: return 'Full autonomy. SELF handles everything within budget.';
    default: return '';
  }
}
