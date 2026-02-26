/**
 * User Provider Key Routes
 * Per-user API key management for AI providers
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { ulid } from 'ulid';

interface UserProviderKeyRow {
  id: string;
  user_id: string;
  provider_type: string;
  api_key_encrypted: string;
  key_hint: string | null;
  label: string | null;
  is_active: boolean;
  last_used_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

// Reuse same base64 obfuscation as forge_providers
function encodeKey(key: string): string {
  return Buffer.from(key).toString('base64');
}
function decodeKey(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

function maskKey(key: string): string {
  if (key.length <= 12) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const VALID_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'xai', 'deepseek']);

// Extract user ID set by authMiddleware (handles both direct session and proxy x-user-id forwarding)
function extractUserId(request: FastifyRequest): string | null {
  return (request as unknown as { userId?: string }).userId || null;
}

// Key prefix validation per provider
const KEY_PREFIXES: Record<string, string[]> = {
  anthropic: ['sk-ant-'],
  openai: ['sk-'],
};

export async function userProviderRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/user-providers - List user's configured provider keys
   */
  app.get(
    '/api/v1/forge/user-providers',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const keys = await query<UserProviderKeyRow>(
        `SELECT id, provider_type, key_hint, label, is_active, last_used_at, last_verified_at, created_at, updated_at
         FROM user_provider_keys
         WHERE user_id = $1
         ORDER BY provider_type`,
        [userId],
      );

      return reply.send({
        keys: keys.map((k) => ({
          provider_type: k.provider_type,
          has_key: true,
          key_hint: k.key_hint,
          label: k.label,
          is_active: k.is_active,
          last_verified_at: k.last_verified_at,
          last_used_at: k.last_used_at,
        })),
      });
    },
  );

  /**
   * PUT /api/v1/forge/user-providers/:providerType - Set/update API key
   */
  app.put(
    '/api/v1/forge/user-providers/:providerType',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { providerType } = request.params as { providerType: string };
      if (!VALID_PROVIDER_TYPES.has(providerType)) {
        return reply.status(400).send({ error: 'Bad Request', message: `Invalid provider type: ${providerType}` });
      }

      const body = request.body as { api_key?: string; label?: string } | null;
      const apiKey = body?.api_key?.trim();
      if (!apiKey) {
        return reply.status(400).send({ error: 'Bad Request', message: 'api_key is required' });
      }

      // Validate key prefix
      const prefixes = KEY_PREFIXES[providerType];
      if (prefixes && !prefixes.some((p) => apiKey.startsWith(p))) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Invalid key format for ${providerType}. Expected prefix: ${prefixes.join(' or ')}`,
        });
      }

      const encoded = encodeKey(apiKey);
      const hint = maskKey(apiKey);
      const label = body?.label?.trim() || null;

      // Upsert: insert or update on conflict
      const result = await queryOne<UserProviderKeyRow>(
        `INSERT INTO user_provider_keys (id, user_id, provider_type, api_key_encrypted, key_hint, label)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, provider_type) DO UPDATE SET
           api_key_encrypted = EXCLUDED.api_key_encrypted,
           key_hint = EXCLUDED.key_hint,
           label = EXCLUDED.label,
           is_active = true,
           updated_at = NOW()
         RETURNING id, provider_type, key_hint, label, is_active, last_verified_at, last_used_at`,
        [ulid(), userId, providerType, encoded, hint, label],
      );

      return reply.send({
        key: result ? {
          provider_type: result.provider_type,
          has_key: true,
          key_hint: result.key_hint,
          label: result.label,
          is_active: result.is_active,
          last_verified_at: result.last_verified_at,
          last_used_at: result.last_used_at,
        } : null,
      });
    },
  );

  /**
   * DELETE /api/v1/forge/user-providers/:providerType - Remove user's key
   */
  app.delete(
    '/api/v1/forge/user-providers/:providerType',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { providerType } = request.params as { providerType: string };
      if (!VALID_PROVIDER_TYPES.has(providerType)) {
        return reply.status(400).send({ error: 'Bad Request', message: `Invalid provider type: ${providerType}` });
      }

      await queryOne(
        `DELETE FROM user_provider_keys WHERE user_id = $1 AND provider_type = $2 RETURNING id`,
        [userId, providerType],
      );

      return reply.send({ ok: true });
    },
  );

  /**
   * POST /api/v1/forge/user-providers/:providerType/verify - Verify key works
   */
  app.post(
    '/api/v1/forge/user-providers/:providerType/verify',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { providerType } = request.params as { providerType: string };
      if (!VALID_PROVIDER_TYPES.has(providerType)) {
        return reply.status(400).send({ error: 'Bad Request', message: `Invalid provider type: ${providerType}` });
      }

      // Fetch the user's key
      const row = await queryOne<UserProviderKeyRow>(
        `SELECT api_key_encrypted FROM user_provider_keys WHERE user_id = $1 AND provider_type = $2 AND is_active = true`,
        [userId, providerType],
      );

      if (!row) {
        return reply.status(404).send({ error: 'Not Found', message: 'No key configured for this provider' });
      }

      const apiKey = decodeKey(row.api_key_encrypted);
      let status: 'valid' | 'invalid' = 'invalid';
      let error: string | null = null;

      try {
        if (providerType === 'anthropic') {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
            signal: AbortSignal.timeout(10000),
          });
          status = res.ok ? 'valid' : 'invalid';
          if (!res.ok) error = `HTTP ${res.status}`;
        } else if (providerType === 'openai') {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          status = res.ok ? 'valid' : 'invalid';
          if (!res.ok) error = `HTTP ${res.status}`;
        } else if (providerType === 'xai') {
          // xAI uses OpenAI-compatible API
          const res = await fetch('https://api.x.ai/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          status = res.ok ? 'valid' : 'invalid';
          if (!res.ok) error = `HTTP ${res.status}`;
        } else if (providerType === 'deepseek') {
          const res = await fetch('https://api.deepseek.com/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          status = res.ok ? 'valid' : 'invalid';
          if (!res.ok) error = `HTTP ${res.status}`;
        }
      } catch (err: unknown) {
        status = 'invalid';
        error = err instanceof Error ? err.message : 'Connection failed';
      }

      // Update verification timestamp
      if (status === 'valid') {
        await queryOne(
          `UPDATE user_provider_keys SET last_verified_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND provider_type = $2`,
          [userId, providerType],
        );
      }

      return reply.send({ status, error });
    },
  );
}
