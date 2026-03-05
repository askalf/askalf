/**
 * Forge API Key Management Routes
 * CRUD + rotation for forge_api_keys.
 *
 * POST /api/v1/forge/api-keys/:id/rotate
 *   Generates a new key, sets a 24-hour grace period expiry on the old key,
 *   and returns the new plaintext key (shown once).
 */

import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { ulid } from 'ulid';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

// Must match the PBKDF2 config in middleware/auth.ts
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

function generateForgeApiKey(): { key: string; prefix: string; hash: string } {
  const random = randomBytes(32).toString('hex');
  const key = `fk_${random}`;
  const prefix = `fk_${random.slice(0, 8)}`;

  const salt = randomBytes(16);
  const derived = pbkdf2Sync(key, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
  const hash = `${salt.toString('hex')}.${derived.toString('hex')}`;

  return { key, prefix, hash };
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  rate_limit: number;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/api-keys
   * List all API keys for the authenticated user (no hashes returned).
   */
  app.get(
    '/api/v1/forge/api-keys',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const keys = await query<ApiKeyRow>(
        `SELECT id, name, key_prefix, permissions, rate_limit, last_used_at, expires_at, is_active, created_at
         FROM forge_api_keys
         WHERE owner_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );

      return reply.send({ api_keys: keys });
    },
  );

  /**
   * POST /api/v1/forge/api-keys
   * Create a new API key. Returns the plaintext key once — store it securely.
   */
  app.post(
    '/api/v1/forge/api-keys',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        name?: string;
        permissions?: string[];
        rate_limit?: number;
        expires_at?: string;
      };

      if (!body.name?.trim()) {
        return reply.code(400).send({ error: 'name is required' });
      }

      const { key, prefix, hash } = generateForgeApiKey();
      const id = `apikey_${ulid()}`;
      const permissions = body.permissions ?? ['read', 'write', 'execute'];
      const rateLimit = body.rate_limit ?? 100;
      const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

      await query(
        `INSERT INTO forge_api_keys (id, owner_id, name, key_hash, key_prefix, permissions, rate_limit, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [id, userId, body.name.trim(), hash, prefix, JSON.stringify(permissions), rateLimit, expiresAt],
      );

      return reply.code(201).send({
        id,
        key,
        key_prefix: prefix,
        name: body.name.trim(),
        permissions,
        rate_limit: rateLimit,
        expires_at: expiresAt?.toISOString() ?? null,
        created_at: new Date().toISOString(),
        warning: 'Store this key securely — it will not be shown again.',
      });
    },
  );

  /**
   * DELETE /api/v1/forge/api-keys/:id
   * Revoke (deactivate) an API key immediately.
   */
  app.delete(
    '/api/v1/forge/api-keys/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const result = await query<{ id: string }>(
        `UPDATE forge_api_keys
         SET is_active = false
         WHERE id = $1 AND owner_id = $2 AND is_active = true
         RETURNING id`,
        [id, userId],
      );

      if (result.length === 0) {
        return reply.code(404).send({ error: 'API key not found or already revoked' });
      }

      return reply.send({ success: true, id });
    },
  );

  /**
   * POST /api/v1/forge/api-keys/:id/rotate
   *
   * Rotates an API key:
   *   1. Generates a new key with the same name/permissions/rate_limit.
   *   2. Sets a 24-hour expiry on the old key (grace period for in-flight callers).
   *   3. Returns the new plaintext key — shown once, must be stored securely.
   */
  app.post(
    '/api/v1/forge/api-keys/:id/rotate',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const existing = await queryOne<{
        id: string;
        name: string;
        permissions: string[];
        rate_limit: number;
        is_active: boolean;
      }>(
        `SELECT id, name, permissions, rate_limit, is_active
         FROM forge_api_keys
         WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!existing) {
        return reply.code(404).send({ error: 'API key not found' });
      }

      if (!existing.is_active) {
        return reply.code(400).send({ error: 'Cannot rotate a revoked API key' });
      }

      const { key: newKey, prefix: newPrefix, hash: newHash } = generateForgeApiKey();
      const newId = `apikey_${ulid()}`;
      const graceExpiry = new Date(Date.now() + GRACE_PERIOD_MS);

      // Create new key
      await query(
        `INSERT INTO forge_api_keys (id, owner_id, name, key_hash, key_prefix, permissions, rate_limit)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [newId, userId, existing.name, newHash, newPrefix, JSON.stringify(existing.permissions), existing.rate_limit],
      );

      // Set 24-hour grace period on old key
      await query(
        `UPDATE forge_api_keys SET expires_at = $1 WHERE id = $2`,
        [graceExpiry, id],
      );

      return reply.send({
        new_key: newKey,
        new_key_id: newId,
        new_key_prefix: newPrefix,
        old_key_id: id,
        old_key_expires_at: graceExpiry.toISOString(),
        message: `Old key will expire at ${graceExpiry.toISOString()} (24-hour grace period). Store the new key securely — it will not be shown again.`,
      });
    },
  );
}
