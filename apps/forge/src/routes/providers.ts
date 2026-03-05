/**
 * Forge Provider Routes
 * Provider management, CRUD, and model listing
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string | null;
  api_key_encrypted: string | null;
  is_enabled: boolean;
  health_status: string;
  last_health_check: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Simple obfuscation for stored API keys (base64 — keeps out of plaintext logs/dumps)
function encodeKey(key: string): string {
  return Buffer.from(key).toString('base64');
}
function decodeKey(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

// Mask an API key for display: show first 4 and last 4 chars
function maskKey(key: string): string {
  if (key.length <= 12) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// Resolve the usable API key for a provider
// Priority: user key (if userId provided) → system DB key → env var
async function resolveApiKey(provider: ProviderRow, userId?: string): Promise<string> {
  // Check user-level key first
  if (userId) {
    const userKey = await queryOne<{ api_key_encrypted: string }>(
      `SELECT api_key_encrypted FROM user_provider_keys WHERE user_id = $1 AND provider_type = $2 AND is_active = true`,
      [userId, provider.type],
    ).catch(() => null);
    if (userKey?.api_key_encrypted) {
      // Update last_used_at asynchronously
      void queryOne(
        `UPDATE user_provider_keys SET last_used_at = NOW() WHERE user_id = $1 AND provider_type = $2`,
        [userId, provider.type],
      ).catch(() => {});
      return decodeKey(userKey.api_key_encrypted);
    }
  }

  // Fall back to system key
  if (provider.api_key_encrypted) {
    return decodeKey(provider.api_key_encrypted);
  }
  const ENV_KEYS: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    xai: 'XAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };
  return process.env[ENV_KEYS[provider.type] ?? ''] ?? '';
}

// Determine auth source for display
function getAuthSource(provider: ProviderRow): 'db' | 'env' | 'oauth' | 'none' {
  if (provider.api_key_encrypted) return 'db';
  const ENV_KEYS: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    xai: 'XAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };
  if (process.env[ENV_KEYS[provider.type] ?? '']) return 'env';
  // CLI/OAuth providers (anthropic) can work without a direct key
  if (provider.type === 'anthropic') return 'oauth';
  return 'none';
}

interface ModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  context_window: number;
  max_output: number;
  cost_per_1k_input: string;
  cost_per_1k_output: string;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_streaming: boolean;
  is_reasoning: boolean;
  is_fast: boolean;
  is_enabled: boolean;
  created_at: string;
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/providers - List configured providers
   */
  app.get(
    '/api/v1/forge/providers',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as { limit?: string; offset?: string };
      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

      const [providers, countResult] = await Promise.all([
        query<ProviderRow>(
          `SELECT id, name, type, base_url, api_key_encrypted, is_enabled, health_status, last_health_check, config, created_at, updated_at
           FROM forge_providers
           ORDER BY name
           LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM forge_providers`),
      ]);

      const total = parseInt(countResult[0]?.count ?? '0', 10);

      // Return providers with auth info but never expose raw keys
      const result = await Promise.all(providers.map(async (p) => {
        const authSource = getAuthSource(p);
        const resolvedKey = await resolveApiKey(p);
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          base_url: p.base_url,
          is_enabled: p.is_enabled,
          health_status: p.health_status,
          last_health_check: p.last_health_check,
          config: p.config,
          auth_source: authSource,
          has_key: !!resolvedKey,
          key_hint: resolvedKey ? maskKey(resolvedKey) : null,
          created_at: p.created_at,
          updated_at: p.updated_at,
        };
      }));

      return reply.send({ providers: result, total, limit, offset });
    },
  );

  /**
   * GET /api/v1/forge/providers/:id/models - List models for a provider
   */
  app.get(
    '/api/v1/forge/providers/:id/models',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      // Verify provider exists
      const provider = await queryOne<ProviderRow>(
        `SELECT id, name, type FROM forge_providers WHERE id = $1`,
        [id],
      );

      if (!provider) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Provider not found',
        });
      }

      const qs = request.query as {
        enabled?: string;
        tools?: string;
        vision?: string;
        reasoning?: string;
        limit?: string;
        offset?: string;
      };

      const conditions: string[] = ['provider_id = $1'];
      const params: unknown[] = [id];
      let paramIndex = 2;

      if (qs.enabled !== undefined) {
        conditions.push(`is_enabled = $${paramIndex}`);
        params.push(qs.enabled === 'true');
        paramIndex++;
      }

      if (qs.tools !== undefined) {
        conditions.push(`supports_tools = $${paramIndex}`);
        params.push(qs.tools === 'true');
        paramIndex++;
      }

      if (qs.vision !== undefined) {
        conditions.push(`supports_vision = $${paramIndex}`);
        params.push(qs.vision === 'true');
        paramIndex++;
      }

      if (qs.reasoning !== undefined) {
        conditions.push(`is_reasoning = $${paramIndex}`);
        params.push(qs.reasoning === 'true');
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

      const [models, countResult] = await Promise.all([
        query<ModelRow>(
          `SELECT * FROM forge_models WHERE ${whereClause} ORDER BY display_name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset],
        ),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM forge_models WHERE ${whereClause}`,
          params,
        ),
      ]);

      const total = parseInt(countResult[0]?.count ?? '0', 10);

      return reply.send({ provider: { id: provider.id, name: provider.name, type: provider.type }, models, total, limit, offset });
    },
  );

  /**
   * PATCH /api/v1/forge/providers/:id - Update provider settings
   */
  app.patch(
    '/api/v1/forge/providers/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        base_url?: string | null;
        api_key?: string | null;
        is_enabled?: boolean;
        config?: Record<string, unknown>;
      };

      const provider = await queryOne<ProviderRow>(
        `SELECT id FROM forge_providers WHERE id = $1`,
        [id],
      );
      if (!provider) {
        return reply.status(404).send({ error: 'Not Found', message: 'Provider not found' });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (body.name !== undefined) {
        sets.push(`name = $${idx++}`);
        params.push(body.name);
      }
      if (body.base_url !== undefined) {
        sets.push(`base_url = $${idx++}`);
        params.push(body.base_url);
      }
      if (body.api_key !== undefined) {
        // null or empty string clears the key, non-empty stores encoded
        sets.push(`api_key_encrypted = $${idx++}`);
        params.push(body.api_key ? encodeKey(body.api_key) : null);
      }
      if (body.is_enabled !== undefined) {
        sets.push(`is_enabled = $${idx++}`);
        params.push(body.is_enabled);
      }
      if (body.config !== undefined) {
        sets.push(`config = COALESCE(config, '{}'::jsonb) || $${idx++}::jsonb`);
        params.push(JSON.stringify(body.config));
      }

      if (sets.length === 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'No fields to update' });
      }

      params.push(id);
      const updated = await queryOne<ProviderRow>(
        `UPDATE forge_providers SET ${sets.join(', ')} WHERE id = $${idx}
         RETURNING id, name, type, base_url, api_key_encrypted, is_enabled, health_status, last_health_check, config, created_at, updated_at`,
        params,
      );

      if (!updated) {
        return reply.status(500).send({ error: 'Update failed' });
      }

      const authSource = getAuthSource(updated);
      const resolvedKey = await resolveApiKey(updated);

      return reply.send({
        provider: {
          id: updated.id,
          name: updated.name,
          type: updated.type,
          base_url: updated.base_url,
          is_enabled: updated.is_enabled,
          health_status: updated.health_status,
          last_health_check: updated.last_health_check,
          config: updated.config,
          auth_source: authSource,
          has_key: !!resolvedKey,
          key_hint: resolvedKey ? maskKey(resolvedKey) : null,
          created_at: updated.created_at,
          updated_at: updated.updated_at,
        },
      });
    },
  );

  /**
   * GET /api/v1/forge/providers/health - Check provider health status
   */
  app.get(
    '/api/v1/forge/providers/health',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const providers = await query<ProviderRow>(
        `SELECT id, name, type, is_enabled, health_status, last_health_check
         FROM forge_providers
         WHERE is_enabled = true
         ORDER BY name`,
      );

      const healthSummary = providers.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        healthStatus: p.health_status,
        lastHealthCheck: p.last_health_check,
      }));

      const allHealthy = providers.every((p) => p.health_status === 'healthy');
      const anyDown = providers.some((p) => p.health_status === 'down');

      return reply.send({
        status: anyDown ? 'degraded' : allHealthy ? 'healthy' : 'unknown',
        providers: healthSummary,
      });
    },
  );

  /**
   * POST /api/v1/forge/providers/health-check - Run live health checks against all providers
   */
  app.post(
    '/api/v1/forge/providers/health-check',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const providers = await query<ProviderRow>(
        `SELECT id, name, type, base_url, api_key_encrypted FROM forge_providers WHERE is_enabled = true`,
      );

      // Providers that support alternative auth (CLI/OAuth) and don't need a direct API key
      const CLI_AUTH_PROVIDERS = new Set(['anthropic']);

      const checks = await Promise.allSettled(
        providers.map(async (p) => {
          const apiKey = await resolveApiKey(p);
          let status: 'healthy' | 'down' = 'down';
          let error: string | null = null;

          try {
            // For cloud providers without an API key: if they support CLI/OAuth auth, mark healthy
            if (!apiKey && CLI_AUTH_PROVIDERS.has(p.type)) {
              status = 'healthy';
            } else if (!apiKey && p.type !== 'ollama' && p.type !== 'lmstudio') {
              // Cloud provider with no API key and no alternative auth
              status = 'down';
              error = 'No API key configured';
            } else if (p.type === 'anthropic') {
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
              status = res.ok ? 'healthy' : 'down';
              if (!res.ok) error = `HTTP ${res.status}`;
            } else if (p.type === 'openai') {
              const res = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(10000),
              });
              status = res.ok ? 'healthy' : 'down';
              if (!res.ok) error = `HTTP ${res.status}`;
            } else if (p.type === 'ollama' || p.type === 'lmstudio') {
              const base = p.base_url || 'http://localhost:11434';
              const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
              status = res.ok ? 'healthy' : 'down';
              if (!res.ok) error = `HTTP ${res.status}`;
            } else {
              // Unknown provider type — mark as down if no API key
              status = apiKey ? 'healthy' : 'down';
              if (!apiKey) error = 'No API key configured';
            }
          } catch (err: unknown) {
            status = 'down';
            error = err instanceof Error ? err.message : 'Connection failed';
          }

          await queryOne(
            `UPDATE forge_providers SET health_status = $1, last_health_check = NOW() WHERE id = $2 RETURNING id`,
            [status, p.id],
          );

          return { id: p.id, name: p.name, type: p.type, status, error };
        }),
      );

      const results = checks.map((c) =>
        c.status === 'fulfilled' ? c.value : { id: 'unknown', name: 'unknown', type: 'unknown', status: 'down' as const, error: 'Check failed' },
      );

      const allHealthy = results.every((r) => r.status === 'healthy');
      const anyDown = results.some((r) => r.status === 'down');

      return reply.send({
        status: anyDown ? 'degraded' : allHealthy ? 'healthy' : 'unknown',
        providers: results,
      });
    },
  );
}
