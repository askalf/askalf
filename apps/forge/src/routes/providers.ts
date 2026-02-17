/**
 * Forge Provider Routes
 * Provider management and model listing
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string | null;
  is_enabled: boolean;
  health_status: string;
  last_health_check: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Return providers without exposing encrypted API keys
      const providers = await query<ProviderRow>(
        `SELECT id, name, type, base_url, is_enabled, health_status, last_health_check, config, created_at, updated_at
         FROM forge_providers
         ORDER BY name`,
      );

      return reply.send({ providers });
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

      const models = await query<ModelRow>(
        `SELECT * FROM forge_models WHERE ${whereClause} ORDER BY display_name`,
        params,
      );

      return reply.send({ provider: { id: provider.id, name: provider.name, type: provider.type }, models });
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
        `SELECT id, name, type, base_url FROM forge_providers WHERE is_enabled = true`,
      );

      const ENV_KEYS: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
        google: 'GOOGLE_AI_KEY',
        xai: 'XAI_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY',
      };

      // Providers that support alternative auth (CLI/OAuth) and don't need a direct API key
      const CLI_AUTH_PROVIDERS = new Set(['anthropic']);

      const checks = await Promise.allSettled(
        providers.map(async (p) => {
          const apiKey = process.env[ENV_KEYS[p.type] ?? ''] ?? '';
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
            } else if (p.type === 'google') {
              const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
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
