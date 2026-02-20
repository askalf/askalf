/**
 * Self Credential Routes
 * AI provider credential management (Claude, OpenAI)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { selfQuery } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '../utils/encryption.js';

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/self/credentials — List user's AI credentials
   * Returns provider, last4, status — NEVER the actual key
   */
  app.get(
    '/api/v1/self/credentials',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const credentials = await selfQuery<{
        provider: string;
        credential_type: string;
        last4: string | null;
        status: string;
        created_at: string;
      }>(
        `SELECT provider, credential_type, last4, status, created_at
         FROM user_credentials WHERE user_id = $1`,
        [userId],
      );

      return reply.send({ credentials });
    },
  );

  /**
   * POST /api/v1/self/credentials — Save a new credential
   * Body: { provider: 'claude'|'openai', credentialType: 'api_key'|'oauth', value: string }
   */
  app.post(
    '/api/v1/self/credentials',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        provider?: string;
        credentialType?: string;
        value?: string;
      };

      if (!body.provider || !['claude', 'openai'].includes(body.provider)) {
        return reply.status(400).send({ error: 'provider must be "claude" or "openai"' });
      }

      if (!body.credentialType || !['api_key', 'oauth'].includes(body.credentialType)) {
        return reply.status(400).send({ error: 'credentialType must be "api_key" or "oauth"' });
      }

      if (!body.value || typeof body.value !== 'string' || body.value.trim().length < 10) {
        return reply.status(400).send({ error: 'value must be a valid credential (minimum 10 characters)' });
      }

      const value = body.value.trim();
      const last4 = value.slice(-4);
      const credentialEnc = encrypt(value);

      await selfQuery(
        `INSERT INTO user_credentials (id, user_id, provider, credential_type, credential_enc, last4, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (user_id, provider) DO UPDATE SET
           credential_type = $4, credential_enc = $5, last4 = $6, status = 'active', updated_at = NOW()`,
        [ulid(), userId, body.provider, body.credentialType, credentialEnc, last4],
      );

      return reply.status(201).send({
        provider: body.provider,
        last4,
        status: 'active',
      });
    },
  );

  /**
   * DELETE /api/v1/self/credentials/:provider — Remove credential
   */
  app.delete(
    '/api/v1/self/credentials/:provider',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { provider } = request.params as { provider: string };

      await selfQuery(
        `DELETE FROM user_credentials WHERE user_id = $1 AND provider = $2`,
        [userId, provider],
      );

      return reply.send({ deleted: true, provider });
    },
  );
}
