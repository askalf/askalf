/**
 * Onboarding Routes
 * Wizard completion tracking and platform configuration for new users
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

      // Check if Anthropic key is configured (env or platform_settings)
      const hasAnthropicKey = !!process.env['ANTHROPIC_API_KEY'];

      return {
        completed: !!row?.onboarding_completed_at,
        hasAnthropicKey,
      };
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

  /**
   * POST /api/v1/forge/onboarding/api-key
   * Save Anthropic API key to platform_settings (persists across restarts)
   * and set it in process.env immediately for the intent parser.
   */
  app.post(
    '/api/v1/forge/onboarding/api-key',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as { key: string; provider?: string } | null;
      const apiKey = body?.key?.trim();
      if (!apiKey) {
        return reply.status(400).send({ error: 'API key is required' });
      }

      const provider = body?.provider || 'anthropic';
      const envName = provider === 'openai' ? 'OPENAI_API_KEY'
        : provider === 'google' ? 'GOOGLE_AI_KEY'
        : 'ANTHROPIC_API_KEY';

      // Test the key first (Anthropic only — others are stored but not tested here)
      if (provider === 'anthropic') {
        try {
          const testRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }),
          });
          if (!testRes.ok) {
            const err = await testRes.json().catch(() => ({})) as { error?: { message?: string } };
            return reply.status(400).send({
              error: `Invalid API key: ${err.error?.message || testRes.statusText}`,
            });
          }
        } catch (err) {
          return reply.status(400).send({
            error: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          });
        }
      }

      // Save to platform_settings (persists across container restarts)
      await substrateQuery(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [envName, apiKey],
      );

      // Set in process.env immediately (no restart needed)
      process.env[envName] = apiKey;

      return { success: true, provider, envName };
    },
  );
}
