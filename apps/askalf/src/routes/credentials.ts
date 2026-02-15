/**
 * Ask Alf Credential Routes
 * AI provider API key management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { askalfQuery } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '../utils/encryption.js';

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/askalf/credentials — List user's credentials
   * Returns provider + last4 — NEVER the actual key
   */
  app.get(
    '/api/v1/askalf/credentials',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const credentials = await askalfQuery<{
        provider: string;
        last4: string | null;
        created_at: string;
      }>(
        `SELECT provider, last4, created_at FROM askalf_credentials WHERE user_id = $1`,
        [userId],
      );

      return reply.send({ credentials });
    },
  );

  /**
   * POST /api/v1/askalf/credentials — Save a credential
   * Body: { provider: 'claude'|'openai', value: string }
   */
  app.post(
    '/api/v1/askalf/credentials',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as { provider?: string; value?: string };

      if (!body.provider || !['claude', 'openai'].includes(body.provider)) {
        return reply.status(400).send({ error: 'provider must be "claude" or "openai"' });
      }

      if (!body.value || typeof body.value !== 'string' || body.value.trim().length < 10) {
        return reply.status(400).send({ error: 'value must be a valid API key (minimum 10 characters)' });
      }

      const value = body.value.trim();
      const last4 = value.slice(-4);
      const credentialEnc = encrypt(value);

      await askalfQuery(
        `INSERT INTO askalf_credentials (id, user_id, provider, credential_enc, last4)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           credential_enc = $4, last4 = $5, updated_at = NOW()`,
        [ulid(), userId, body.provider, credentialEnc, last4],
      );

      return reply.status(201).send({
        provider: body.provider,
        last4,
      });
    },
  );

  /**
   * DELETE /api/v1/askalf/credentials/:provider — Remove credential
   */
  app.delete(
    '/api/v1/askalf/credentials/:provider',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { provider } = request.params as { provider: string };

      await askalfQuery(
        `DELETE FROM askalf_credentials WHERE user_id = $1 AND provider = $2`,
        [userId, provider],
      );

      return reply.send({ deleted: true, provider });
    },
  );
}
