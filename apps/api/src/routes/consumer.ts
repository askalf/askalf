import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';
import {
  ids,
  formatEnvironmentalImpact,
  MODEL_TIERS,
  type ModelTier,
  TOKEN_BUNDLE_SIZES,
  type TokenBundleSize,
  shardLogicScanner,
} from '@substrate/core';
import { runClassifierSeed } from '@substrate/metabolic';
import { getLogger } from '@substrate/observability';
import { AuthenticatedRequest, TenantContext, requireAuth } from '../middleware/tenant.js';
import crypto from 'crypto';

const logger = getLogger();

/**
 * Get tenant from cookie session (for dashboard users)
 * This supplements the API key auth in tenantMiddleware
 */
async function getTenantFromSession(request: FastifyRequest): Promise<TenantContext | null> {
  const cookies = request.cookies as Record<string, string> | undefined;
  const sessionToken = cookies?.['substrate_session'];
  if (!sessionToken) return null;

  try {
    // Hash the session token
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Get user from session and their tenant
    const result = await queryOne<{
      user_id: string;
      tenant_id: string;
      tier: string;
      name: string;
      max_private_shards: number;
      max_private_facts: number;
      max_members: number;
    }>(`
      SELECT s.user_id, u.tenant_id, t.tier, t.name, t.max_private_shards, t.max_private_facts, t.max_members
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      JOIN tenants t ON u.tenant_id = t.id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false
    `, [tokenHash]);

    if (!result) return null;

    return {
      tenantId: result.tenant_id,
      tier: result.tier as TenantContext['tier'],
      name: result.name,
      limits: {
        maxPrivateShards: result.max_private_shards,
        maxPrivateFacts: result.max_private_facts,
        maxMembers: result.max_members,
      },
      scopes: ['read', 'write', 'execute'],
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to get tenant from session');
    return null;
  }
}

/**
 * Resolve tenant from request - checks API key first, then cookie session
 */
async function resolveTenant(request: FastifyRequest): Promise<TenantContext | null> {
  const authReq = request as AuthenticatedRequest;

  // If tenant middleware already resolved a real tenant (not system), use it
  if (authReq.tenant && authReq.tenant.tenantId !== 'tenant_system') {
    return authReq.tenant;
  }

  // Try cookie session
  const sessionTenant = await getTenantFromSession(request);
  if (sessionTenant) {
    // Also update the request.tenant for consistency
    authReq.tenant = sessionTenant;
    return sessionTenant;
  }

  return null;
}

// Simple encryption for API keys (in production, use a proper KMS)
const ENCRYPTION_KEY = (() => {
  const key = process.env['ENCRYPTION_KEY'] || process.env['JWT_SECRET'];
  if (!key && process.env['NODE_ENV'] === 'production') {
    throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set in production');
  }
  return key || 'dev-only-key-not-for-production';
})();

function encryptApiKey(apiKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptApiKey(encryptedKey: string): string {
  const [ivHex, encrypted] = encryptedKey.split(':');
  if (!ivHex || !encrypted) throw new Error('Invalid encrypted key format');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function consumerRoutes(app: FastifyInstance) {
  // ===========================================
  // MODEL ACCESS & RESTRICTIONS
  // ===========================================

  // Get available models for the authenticated user's tier
  app.get('/api/v1/models', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const tenantId = authReq.tenant?.tenantId;

    try {
      // Get user's tier
      let userTier: ModelTier = 'free';
      if (tenantId) {
        const tenant = await queryOne<{ tier: string }>(`
          SELECT tier FROM tenants WHERE id = $1
        `, [tenantId]);
        if (tenant?.tier) {
          userTier = tenant.tier as ModelTier;
        }
      }

      // Get all models available to this tier
      const tierRank = MODEL_TIERS[userTier];
      const models = await query<{
        id: string;
        provider: string;
        model_id: string;
        display_name: string;
        min_tier: string;
        input_cost_per_1k: string | null;
        output_cost_per_1k: string | null;
        is_fast_model: boolean;
        is_reasoning_model: boolean;
        is_embedding_model: boolean;
      }>(`
        SELECT * FROM model_access_tiers
        WHERE is_active = TRUE
        ORDER BY provider, display_name
      `);

      return {
        userTier,
        models: models.map(m => {
          const modelRank = MODEL_TIERS[m.min_tier as ModelTier] || 5;
          const isAvailable = tierRank >= modelRank;
          return {
            provider: m.provider,
            modelId: m.model_id,
            displayName: m.display_name,
            minTier: m.min_tier,
            isAvailable,
            reason: isAvailable ? null : `Requires ${m.min_tier} tier or higher`,
            isFastModel: m.is_fast_model,
            isReasoningModel: m.is_reasoning_model,
            isEmbeddingModel: m.is_embedding_model,
            costPer1k: m.input_cost_per_1k ? {
              input: parseFloat(m.input_cost_per_1k),
              output: parseFloat(m.output_cost_per_1k || '0'),
            } : null,
          };
        }),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get models');
      reply.code(500);
      return { error: 'Failed to get available models' };
    }
  });

  // Check if user can use a specific model
  app.get('/api/v1/models/:provider/:modelId/check', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const tenantId = authReq.tenant?.tenantId;
    const { provider, modelId } = request.params as { provider: string; modelId: string };

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const result = await queryOne<{ can_use: boolean }>(`
        SELECT can_use_model($1, $2, $3) as can_use
      `, [tenantId, provider, modelId]);

      return {
        provider,
        modelId,
        canUse: result?.can_use ?? false,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to check model access');
      reply.code(500);
      return { error: 'Failed to check model access' };
    }
  });

  // ===========================================
  // AI CONNECTORS (BYOK)
  // ===========================================

  // List user's AI connectors
  app.get('/api/v1/connectors', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const connectors = await query<{
        id: string;
        provider: string;
        api_key_last4: string | null;
        base_url: string | null;
        default_model: string | null;
        is_enabled: boolean;
        priority: number;
        last_validated_at: Date | null;
        validation_status: string;
        validation_error: string | null;
        created_at: Date;
      }>(`
        SELECT
          id, provider, api_key_last4, base_url, default_model,
          is_enabled, priority, last_validated_at,
          validation_status, validation_error, created_at
        FROM user_ai_connectors
        WHERE tenant_id = $1
        ORDER BY priority DESC, provider
      `, [tenantId]);

      return {
        connectors: connectors.map(c => ({
          id: c.id,
          provider: c.provider,
          hasApiKey: !!c.api_key_last4,
          apiKeyLast4: c.api_key_last4,
          baseUrl: c.base_url,
          defaultModel: c.default_model,
          isEnabled: c.is_enabled,
          priority: c.priority,
          lastValidatedAt: c.last_validated_at?.toISOString(),
          validationStatus: c.validation_status,
          validationError: c.validation_error,
          createdAt: c.created_at.toISOString(),
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get connectors');
      reply.code(500);
      return { error: 'Failed to get AI connectors' };
    }
  });

  // Add or update AI connector
  app.put('/api/v1/connectors/:provider', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { provider } = request.params as { provider: string };
    const body = request.body as {
      apiKey?: string;
      baseUrl?: string;
      defaultModel?: string;
      isEnabled?: boolean;
      priority?: number;
    } | undefined;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    const validProviders = ['openai', 'anthropic', 'google', 'xai', 'ollama'];
    if (!validProviders.includes(provider)) {
      reply.code(400);
      return { error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` };
    }

    try {
      // Check if connector exists
      const existing = await queryOne<{ id: string }>(`
        SELECT id FROM user_ai_connectors
        WHERE tenant_id = $1 AND provider = $2
      `, [tenantId, provider]);

      const connectorId = existing?.id || ids.apiKey();
      const encryptedKey = body?.apiKey ? encryptApiKey(body.apiKey) : null;
      const keyLast4 = body?.apiKey ? body.apiKey.slice(-4) : null;

      if (existing) {
        // Update existing
        await query(`
          UPDATE user_ai_connectors SET
            api_key_encrypted = COALESCE($1, api_key_encrypted),
            api_key_last4 = COALESCE($2, api_key_last4),
            base_url = COALESCE($3, base_url),
            default_model = COALESCE($4, default_model),
            is_enabled = COALESCE($5, is_enabled),
            priority = COALESCE($6, priority),
            validation_status = CASE WHEN $1 IS NOT NULL THEN 'unknown' ELSE validation_status END,
            updated_at = NOW()
          WHERE tenant_id = $7 AND provider = $8
        `, [
          encryptedKey,
          keyLast4,
          body?.baseUrl,
          body?.defaultModel,
          body?.isEnabled,
          body?.priority,
          tenantId,
          provider,
        ]);
      } else {
        // Create new
        await query(`
          INSERT INTO user_ai_connectors (
            id, tenant_id, provider,
            api_key_encrypted, api_key_last4,
            base_url, default_model, is_enabled, priority
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          connectorId,
          tenantId,
          provider,
          encryptedKey,
          keyLast4,
          body?.baseUrl,
          body?.defaultModel,
          body?.isEnabled ?? true,
          body?.priority ?? 0,
        ]);
      }

      logger.info({ tenantId, provider }, 'AI connector saved');

      return {
        success: true,
        connectorId,
        provider,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to save connector');
      reply.code(500);
      return { error: 'Failed to save AI connector' };
    }
  });

  // Test AI connector
  app.post('/api/v1/connectors/:provider/test', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { provider } = request.params as { provider: string };

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const connector = await queryOne<{
        api_key_encrypted: string | null;
        base_url: string | null;
      }>(`
        SELECT api_key_encrypted, base_url
        FROM user_ai_connectors
        WHERE tenant_id = $1 AND provider = $2
      `, [tenantId, provider]);

      if (!connector?.api_key_encrypted) {
        reply.code(404);
        return { error: 'Connector not found or no API key configured' };
      }

      // Decrypt and test
      const apiKey = decryptApiKey(connector.api_key_encrypted);
      let isValid = false;
      let error: string | null = null;

      // Provider-specific validation
      try {
        switch (provider) {
          case 'openai': {
            const response = await fetch('https://api.openai.com/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            isValid = response.ok;
            if (!isValid) error = `HTTP ${response.status}`;
            break;
          }
          case 'anthropic': {
            // Anthropic doesn't have a simple test endpoint, so we'll just verify key format
            isValid = apiKey.startsWith('sk-ant-');
            if (!isValid) error = 'Invalid key format (should start with sk-ant-)';
            break;
          }
          case 'google': {
            const baseUrl = connector.base_url || 'https://generativelanguage.googleapis.com/v1beta';
            const response = await fetch(`${baseUrl}/models?key=${apiKey}`);
            isValid = response.ok;
            if (!isValid) error = `HTTP ${response.status}`;
            break;
          }
          case 'xai': {
            const response = await fetch('https://api.x.ai/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            isValid = response.ok;
            if (!isValid) error = `HTTP ${response.status}`;
            break;
          }
          case 'ollama': {
            const baseUrl = connector.base_url || 'http://localhost:11434';
            const response = await fetch(`${baseUrl}/api/tags`);
            isValid = response.ok;
            if (!isValid) error = `HTTP ${response.status}`;
            break;
          }
          default:
            error = 'Unknown provider';
        }
      } catch (e) {
        error = e instanceof Error ? e.message : 'Connection failed';
      }

      // Update validation status
      await query(`
        UPDATE user_ai_connectors SET
          last_validated_at = NOW(),
          validation_status = $1,
          validation_error = $2,
          updated_at = NOW()
        WHERE tenant_id = $3 AND provider = $4
      `, [
        isValid ? 'valid' : 'invalid',
        error,
        tenantId,
        provider,
      ]);

      return {
        provider,
        isValid,
        error,
        validatedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to test connector');
      reply.code(500);
      return { error: 'Failed to test connector' };
    }
  });

  // Delete AI connector
  app.delete('/api/v1/connectors/:provider', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { provider } = request.params as { provider: string };

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      await query(`
        DELETE FROM user_ai_connectors
        WHERE tenant_id = $1 AND provider = $2
      `, [tenantId, provider]);

      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to delete connector');
      reply.code(500);
      return { error: 'Failed to delete connector' };
    }
  });

  // ===========================================
  // TOKEN BUNDLES
  // ===========================================

  // Get user's token bundles
  app.get('/api/v1/bundles', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const tenantId = authReq.tenant?.tenantId;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      // Get active bundles
      const bundles = await query<{
        id: string;
        tokens_purchased: number;
        tokens_remaining: number;
        bundle_type: string;
        purchased_at: Date;
        expires_at: Date | null;
        status: string;
      }>(`
        SELECT id, tokens_purchased, tokens_remaining, bundle_type,
               purchased_at, expires_at, status
        FROM token_bundles
        WHERE tenant_id = $1
        ORDER BY
          CASE status WHEN 'active' THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 20
      `, [tenantId]);

      // Calculate total available
      const totalAvailable = bundles
        .filter(b => b.status === 'active')
        .reduce((sum, b) => sum + b.tokens_remaining, 0);

      return {
        totalTokensAvailable: totalAvailable,
        bundles: bundles.map(b => ({
          id: b.id,
          tokensPurchased: b.tokens_purchased,
          tokensRemaining: b.tokens_remaining,
          bundleType: b.bundle_type,
          purchasedAt: b.purchased_at.toISOString(),
          expiresAt: b.expires_at?.toISOString(),
          status: b.status,
        })),
        pricing: TOKEN_BUNDLE_SIZES,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get bundles');
      reply.code(500);
      return { error: 'Failed to get token bundles' };
    }
  });

  // Bundle balance route moved to bundles.ts

  // ===========================================
  // CONVERSATIONS / SESSIONS
  // ===========================================

  // List user's conversations
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const conversations = await query<{
        id: string;
        title: string;
        model: string | null;
        provider: string | null;
        message_count: number;
        created_at: Date;
        updated_at: Date;
      }>(`
        SELECT
          c.id, c.title, c.model, c.provider,
          COUNT(m.id)::int as message_count,
          c.created_at, c.updated_at
        FROM chat_sessions c
        LEFT JOIN chat_messages m ON m.session_id = c.id
        WHERE c.tenant_id = $1
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT 100
      `, [tenantId]);

      return {
        conversations: conversations.map(c => ({
          id: c.id,
          title: c.title || 'New Chat',
          model: c.model,
          provider: c.provider,
          messageCount: c.message_count,
          createdAt: c.created_at.toISOString(),
          updatedAt: c.updated_at.toISOString(),
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get conversations');
      reply.code(500);
      return { error: 'Failed to get conversations' };
    }
  });

  // Create new conversation
  app.post('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const body = request.body as { title?: string; model?: string; provider?: string } | undefined;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const sessionId = ids.session();
      const title = body?.title || 'New Chat';

      await query(`
        INSERT INTO chat_sessions (id, tenant_id, title, model, provider)
        VALUES ($1, $2, $3, $4, $5)
      `, [sessionId, tenantId, title, body?.model, body?.provider]);

      return {
        id: sessionId,
        title,
        model: body?.model,
        provider: body?.provider,
        messageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to create conversation');
      reply.code(500);
      return { error: 'Failed to create conversation' };
    }
  });

  // Get conversation with messages
  app.get('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { id } = request.params as { id: string };

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      // Get session
      const session = await queryOne<{
        id: string;
        title: string;
        model: string | null;
        provider: string | null;
        created_at: Date;
        updated_at: Date;
      }>(`
        SELECT id, title, model, provider, created_at, updated_at
        FROM chat_sessions
        WHERE id = $1 AND tenant_id = $2
      `, [id, tenantId]);

      if (!session) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }

      // Get messages
      const messages = await query<{
        id: string;
        role: string;
        content: string;
        model: string | null;
        provider: string | null;
        shard_id: string | null;
        tokens_saved: number | null;
        water_ml_saved: number | null;
        power_wh_saved: string | null;
        created_at: Date;
      }>(`
        SELECT
          id, role, content, model, provider,
          shard_id, tokens_saved, water_ml_saved, power_wh_saved,
          created_at
        FROM chat_messages
        WHERE session_id = $1
        ORDER BY created_at ASC
      `, [id]);

      return {
        id: session.id,
        title: session.title || 'New Chat',
        model: session.model,
        provider: session.provider,
        createdAt: session.created_at.toISOString(),
        updatedAt: session.updated_at.toISOString(),
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          model: m.model,
          provider: m.provider,
          createdAt: m.created_at.toISOString(),
          shardHit: m.shard_id ? {
            shardId: m.shard_id,
            tokensSaved: m.tokens_saved || 0,
            waterSaved: m.water_ml_saved || 0,
            powerSaved: parseFloat(m.power_wh_saved || '0'),
          } : undefined,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get conversation');
      reply.code(500);
      return { error: 'Failed to get conversation' };
    }
  });

  // Update conversation (title, model switch)
  app.patch('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { id } = request.params as { id: string };
    const body = request.body as { title?: string; model?: string; provider?: string } | undefined;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const result = await query(`
        UPDATE chat_sessions SET
          title = COALESCE($1, title),
          model = COALESCE($2, model),
          provider = COALESCE($3, provider),
          updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5
        RETURNING id
      `, [body?.title, body?.model, body?.provider, id, tenantId]);

      if (result.length === 0) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }

      return { success: true, id };
    } catch (err) {
      logger.error({ err }, 'Failed to update conversation');
      reply.code(500);
      return { error: 'Failed to update conversation' };
    }
  });

  // Delete conversation
  app.delete('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { id } = request.params as { id: string };

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      // Delete messages first
      await query(`DELETE FROM chat_messages WHERE session_id = $1`, [id]);
      // Delete session
      await query(`DELETE FROM chat_sessions WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);

      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to delete conversation');
      reply.code(500);
      return { error: 'Failed to delete conversation' };
    }
  });

  // Delete ALL conversations for the user
  app.delete('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      // Get all session IDs for this tenant
      const sessions = await query<{ id: string }>(`
        SELECT id FROM chat_sessions WHERE tenant_id = $1
      `, [tenantId]);

      // Delete messages first
      if (sessions.length > 0) {
        const sessionIds = sessions.map(s => s.id);
        await query(`DELETE FROM chat_messages WHERE session_id = ANY($1)`, [sessionIds]);
      }

      // Delete all sessions
      const result = await query(`DELETE FROM chat_sessions WHERE tenant_id = $1 RETURNING id`, [tenantId]);

      return {
        success: true,
        deleted: result.length,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to delete all conversations');
      reply.code(500);
      return { error: 'Failed to delete conversations' };
    }
  });

  // ===========================================
  // ENVIRONMENTAL STATS
  // ===========================================

  // Get user's environmental stats
  app.get('/api/v1/environmental/me', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const tenantId = authReq.tenant?.tenantId;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const tenant = await queryOne<{
        total_tokens_saved: string;
        total_water_ml_saved: string;
        total_power_wh_saved: string;
        total_carbon_g_saved: string;
        lifetime_shard_hits: number;
      }>(`
        SELECT
          total_tokens_saved, total_water_ml_saved,
          total_power_wh_saved, total_carbon_g_saved,
          lifetime_shard_hits
        FROM tenants
        WHERE id = $1
      `, [tenantId]);

      if (!tenant) {
        reply.code(404);
        return { error: 'Tenant not found' };
      }

      const impact = {
        tokensSaved: parseInt(tenant.total_tokens_saved || '0', 10),
        waterMlSaved: parseInt(tenant.total_water_ml_saved || '0', 10),
        powerWhSaved: parseFloat(tenant.total_power_wh_saved || '0'),
        carbonGSaved: parseFloat(tenant.total_carbon_g_saved || '0'),
      };

      const formatted = formatEnvironmentalImpact(impact);

      return {
        personal: {
          ...impact,
          shardHits: tenant.lifetime_shard_hits,
        },
        formatted: {
          ...formatted,
          shardHits: `${tenant.lifetime_shard_hits} shard executions`,
        },
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get environmental stats');
      reply.code(500);
      return { error: 'Failed to get environmental statistics' };
    }
  });

  // Get combined personal + global stats
  app.get('/api/v1/environmental/combined', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const tenantId = authReq.tenant?.tenantId;

    try {
      // Get global stats
      const counters = await query<{
        counter_name: string;
        counter_value: string;
      }>(`
        SELECT counter_name, counter_value
        FROM global_counters
        WHERE counter_name IN (
          'total_tokens_saved', 'total_water_ml_saved',
          'total_power_wh_saved', 'total_carbon_g_saved', 'total_shard_hits'
        )
      `);

      const globalStats: Record<string, number> = {};
      for (const c of counters) {
        globalStats[c.counter_name] = parseInt(c.counter_value, 10);
      }

      // Power/carbon stored as x100
      const globalPower = (globalStats['total_power_wh_saved'] || 0) / 100;
      const globalCarbon = (globalStats['total_carbon_g_saved'] || 0) / 100;

      // Get personal stats if authenticated
      let personal = null;
      if (tenantId) {
        const tenant = await queryOne<{
          total_tokens_saved: string;
          total_water_ml_saved: string;
          total_power_wh_saved: string;
          total_carbon_g_saved: string;
          lifetime_shard_hits: number;
        }>(`
          SELECT total_tokens_saved, total_water_ml_saved,
                 total_power_wh_saved, total_carbon_g_saved, lifetime_shard_hits
          FROM tenants WHERE id = $1
        `, [tenantId]);

        if (tenant) {
          const impact = {
            tokensSaved: parseInt(tenant.total_tokens_saved || '0', 10),
            waterMlSaved: parseInt(tenant.total_water_ml_saved || '0', 10),
            powerWhSaved: parseFloat(tenant.total_power_wh_saved || '0'),
            carbonGSaved: parseFloat(tenant.total_carbon_g_saved || '0'),
          };
          personal = {
            ...impact,
            shardHits: tenant.lifetime_shard_hits,
            formatted: formatEnvironmentalImpact(impact),
          };
        }
      }

      // Count total users
      const userCount = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count FROM tenants WHERE status = 'active'
      `);

      const globalImpact = {
        tokensSaved: globalStats['total_tokens_saved'] || 0,
        waterMlSaved: globalStats['total_water_ml_saved'] || 0,
        powerWhSaved: globalPower,
        carbonGSaved: globalCarbon,
      };

      return {
        personal,
        global: {
          ...globalImpact,
          shardHits: globalStats['total_shard_hits'] || 0,
          totalUsers: parseInt(userCount?.count || '0', 10),
          formatted: formatEnvironmentalImpact(globalImpact),
        },
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get combined environmental stats');
      reply.code(500);
      return { error: 'Failed to get environmental statistics' };
    }
  });

  // ===========================================
  // API KEYS (User-facing API key management)
  // ===========================================

  // List user's API keys
  app.get('/api/v1/keys', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const keys = await query<{
        id: string;
        name: string;
        key_prefix: string;
        key_preview: string | null;
        scopes: string[];
        last_used_at: Date | null;
        created_at: Date;
        expires_at: Date | null;
        status: string;
        usage_count: number;
      }>(`
        SELECT id, name, key_prefix, key_preview, scopes, last_used_at, created_at, expires_at, status, usage_count
        FROM api_keys
        WHERE tenant_id = $1 AND status = 'active'
        ORDER BY created_at DESC
      `, [tenantId]);

      return {
        keys: keys.map(k => ({
          id: k.id,
          name: k.name,
          keyPreview: k.key_preview || `${k.key_prefix}...`,
          scopes: k.scopes,
          lastUsed: k.last_used_at?.toISOString() || null,
          createdAt: k.created_at.toISOString(),
          expiresAt: k.expires_at?.toISOString() || null,
          usageCount: k.usage_count,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get API keys');
      reply.code(500);
      return { error: 'Failed to get API keys' };
    }
  });

  // Create new API key
  app.post('/api/v1/keys', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const body = request.body as {
      name: string;
      scopes?: string[];
      expiresInDays?: number;
    } | undefined;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    if (!body?.name?.trim()) {
      reply.code(400);
      return { error: 'Name is required' };
    }

    try {
      // Generate secure API key
      const keyBytes = crypto.randomBytes(32);
      const rawKey = `alf_${keyBytes.toString('base64url')}`;
      const keyPrefix = rawKey.slice(0, 8);
      const keyPreview = `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`;

      // Hash the key for storage
      const encoder = new TextEncoder();
      const data = encoder.encode(rawKey);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const keyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      const keyId = ids.apiKey();
      const scopes = body.scopes || ['read', 'write', 'execute'];
      const validScopes = scopes.filter(s => ['read', 'write', 'execute'].includes(s));
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      // Get user ID from session if available
      const cookies = request.cookies as Record<string, string> | undefined;
      const sessionToken = cookies?.['substrate_session'];
      let userId: string | null = null;

      if (sessionToken) {
        const tokenHashEncoder = new TextEncoder();
        const tokenData = tokenHashEncoder.encode(sessionToken);
        const tokenHashBuffer = await crypto.subtle.digest('SHA-256', tokenData);
        const tokenHashArray = Array.from(new Uint8Array(tokenHashBuffer));
        const tokenHash = tokenHashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

        const session = await queryOne<{ user_id: string }>(
          'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
          [tokenHash]
        );
        userId = session?.user_id || null;
      }

      await query(`
        INSERT INTO api_keys (id, tenant_id, user_id, name, key_hash, key_prefix, key_preview, scopes, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [keyId, tenantId, userId, body.name.trim(), keyHash, keyPrefix, keyPreview, validScopes, expiresAt]);

      logger.info({ tenantId, keyId }, 'API key created');

      return {
        id: keyId,
        key: rawKey, // Only returned once at creation
        name: body.name.trim(),
        keyPreview,
        scopes: validScopes,
        expiresAt: expiresAt?.toISOString() || null,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to create API key');
      reply.code(500);
      return { error: 'Failed to create API key' };
    }
  });

  // Revoke API key
  app.delete('/api/v1/keys/:id', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { id } = request.params as { id: string };

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const result = await query(`
        UPDATE api_keys SET status = 'revoked', revoked_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND status = 'active'
        RETURNING id
      `, [id, tenantId]);

      if (result.length === 0) {
        reply.code(404);
        return { error: 'API key not found' };
      }

      logger.info({ tenantId, keyId: id }, 'API key revoked');

      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to revoke API key');
      reply.code(500);
      return { error: 'Failed to revoke API key' };
    }
  });

  // Get API key usage stats
  app.get('/api/v1/keys/:id/stats', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;
    const { id } = request.params as { id: string };

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const key = await queryOne<{
        id: string;
        name: string;
        usage_count: number;
        last_used_at: Date | null;
        created_at: Date;
      }>(`
        SELECT id, name, usage_count, last_used_at, created_at
        FROM api_keys
        WHERE id = $1 AND tenant_id = $2
      `, [id, tenantId]);

      if (!key) {
        reply.code(404);
        return { error: 'API key not found' };
      }

      return {
        id: key.id,
        name: key.name,
        totalRequests: key.usage_count,
        lastUsed: key.last_used_at?.toISOString() || null,
        createdAt: key.created_at.toISOString(),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get API key stats');
      reply.code(500);
      return { error: 'Failed to get API key stats' };
    }
  });

  // ===========================================
  // CONVERGENCE DASHBOARD
  // ===========================================

  // Get convergence data: cost-per-query trending DOWN, shard hit rate trending UP
  app.get('/api/v1/convergence', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = await resolveTenant(request);
    const tenantId = tenant?.tenantId;

    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    try {
      const isAdmin = tenant?.tier === 'system';
      const tenantFilter = isAdmin ? '' : 'AND s.tenant_id = $1';
      const tenantFilterDirect = isAdmin ? '' : 'AND sf.tenant_id = $1';
      const tenantFilterExec = isAdmin ? '' : 'AND se.executor_tenant_id = $1';
      const params = isAdmin ? [] : [tenantId];

      // Run all queries in parallel
      const [
        daily,
        shardCount,
        knowledgeTypes,
        categoryRows,
        maturityRows,
        feedbackRows,
        impactRow,
        topShardRows,
      ] = await Promise.all([
        // Existing: daily stats for last 30 days
        query<{
          date: string;
          total_queries: string;
          shard_hits: string;
          total_llm_tokens: string;
        }>(`
          SELECT
            DATE(m.created_at) as date,
            COUNT(*)::text as total_queries,
            COUNT(CASE WHEN m.shard_id IS NOT NULL THEN 1 END)::text as shard_hits,
            COALESCE(SUM(CASE WHEN m.shard_id IS NULL AND m.role = 'assistant' THEN m.tokens_used ELSE 0 END), 0)::text as total_llm_tokens
          FROM chat_messages m
          JOIN chat_sessions s ON m.session_id = s.id
          WHERE m.role = 'assistant'
            AND m.created_at >= NOW() - INTERVAL '30 days'
            ${tenantFilter}
          GROUP BY DATE(m.created_at)
          ORDER BY DATE(m.created_at) ASC
        `, params),

        // Existing: active shards count
        queryOne<{ count: string }>(`
          SELECT COUNT(DISTINCT m.shard_id)::text as count
          FROM chat_messages m
          JOIN chat_sessions s ON m.session_id = s.id
          WHERE m.shard_id IS NOT NULL ${tenantFilter}
        `, params),

        // Existing: knowledge type distribution
        query<{
          knowledge_type: string;
          count: string;
        }>(`
          SELECT
            COALESCE(ps.knowledge_type, 'procedural') as knowledge_type,
            COUNT(DISTINCT ps.id)::text as count
          FROM procedural_shards ps
          JOIN chat_messages m ON m.shard_id = ps.id
          JOIN chat_sessions s ON m.session_id = s.id
          WHERE ps.lifecycle = 'promoted'
            AND ps.verification_status NOT IN ('failed', 'expired')
            ${tenantFilter}
          GROUP BY ps.knowledge_type
          ORDER BY count DESC
        `, params),

        // NEW A: Per-category convergence scores
        query<{
          category: string;
          promoted_count: string;
          avg_confidence: string;
          total_tokens_saved: string;
          total_queries: string;
          shard_hits: string;
        }>(`
          WITH category_shards AS (
            SELECT
              COALESCE(ps.category, 'general') as category,
              COUNT(*) FILTER (WHERE ps.lifecycle = 'promoted') as promoted_count,
              AVG(ps.confidence) FILTER (WHERE ps.lifecycle = 'promoted') as avg_confidence,
              COALESCE(SUM(ps.tokens_saved), 0) as total_tokens_saved
            FROM procedural_shards ps
            JOIN chat_messages m ON m.shard_id = ps.id
            JOIN chat_sessions s ON m.session_id = s.id
            WHERE 1=1 ${tenantFilter}
            GROUP BY COALESCE(ps.category, 'general')
          ),
          category_hits AS (
            SELECT
              COALESCE(ps.category, 'general') as category,
              COUNT(*) as total_queries,
              COUNT(CASE WHEN m.shard_id IS NOT NULL THEN 1 END) as shard_hits
            FROM chat_messages m
            JOIN chat_sessions s ON m.session_id = s.id
            LEFT JOIN procedural_shards ps ON m.shard_id = ps.id
            WHERE m.role = 'assistant'
              AND m.created_at >= NOW() - INTERVAL '30 days'
              ${tenantFilter}
            GROUP BY COALESCE(ps.category, 'general')
          )
          SELECT cs.category, cs.promoted_count::text, COALESCE(cs.avg_confidence, 0)::text as avg_confidence,
            cs.total_tokens_saved::text, COALESCE(ch.total_queries, 0)::text as total_queries,
            COALESCE(ch.shard_hits, 0)::text as shard_hits
          FROM category_shards cs LEFT JOIN category_hits ch ON cs.category = ch.category
          ORDER BY cs.promoted_count DESC
        `, params),

        // NEW B: Maturity breakdown (verification + lifecycle)
        query<{
          verification_status: string;
          lifecycle: string;
          count: string;
        }>(`
          SELECT COALESCE(ps.verification_status, 'unverified') as verification_status,
            ps.lifecycle, COUNT(DISTINCT ps.id)::text as count
          FROM procedural_shards ps
          JOIN chat_messages m ON m.shard_id = ps.id
          JOIN chat_sessions s ON m.session_id = s.id
          WHERE 1=1 ${tenantFilter}
          GROUP BY ps.verification_status, ps.lifecycle
        `, params),

        // NEW C: Feedback health (from shard_feedback)
        query<{
          signal_type: string;
          count: string;
        }>(`
          SELECT sf.signal_type, COUNT(*)::text as count
          FROM shard_feedback sf
          WHERE sf.created_at >= NOW() - INTERVAL '30 days'
            ${tenantFilterDirect}
          GROUP BY sf.signal_type
        `, params),

        // NEW D: Impact metrics (from shard_executions)
        queryOne<{
          total_tokens_saved: string;
          avg_shard_latency_ms: string;
          total_executions: string;
        }>(`
          SELECT COALESCE(SUM(se.tokens_saved), 0)::text as total_tokens_saved,
            COALESCE(ROUND(AVG(se.execution_ms)), 0)::text as avg_shard_latency_ms,
            COUNT(*)::text as total_executions
          FROM shard_executions se
          WHERE se.success = true
            AND se.created_at >= NOW() - INTERVAL '30 days'
            ${tenantFilterExec}
        `, params),

        // NEW E: Top performing shards
        query<{
          shard_id: string;
          name: string;
          category: string;
          confidence: string;
          hits: string;
          tokens_saved: string;
        }>(`
          SELECT se.shard_id, ps.name, COALESCE(ps.category, 'general') as category,
            ps.confidence::text, COUNT(*)::text as hits, COALESCE(SUM(se.tokens_saved), 0)::text as tokens_saved
          FROM shard_executions se JOIN procedural_shards ps ON se.shard_id = ps.id
          WHERE se.success = true
            AND se.created_at >= NOW() - INTERVAL '30 days'
            ${tenantFilterExec}
          GROUP BY se.shard_id, ps.name, ps.category, ps.confidence
          ORDER BY COUNT(*) DESC LIMIT 10
        `, params),
      ]);

      // Calculate per-day metrics
      const dailyData = daily.map(d => {
        const totalQueries = parseInt(d.total_queries, 10);
        const shardHits = parseInt(d.shard_hits, 10);
        const totalLlmTokens = parseInt(d.total_llm_tokens, 10);
        const shardHitRate = totalQueries > 0 ? shardHits / totalQueries : 0;
        // Estimate cost: tokens * $0.003 / 1000, distributed across all queries
        const estimatedTotalCost = (totalLlmTokens * 0.003) / 1000;
        const estimatedCostPerQuery = totalQueries > 0 ? estimatedTotalCost / totalQueries : 0;

        return {
          date: d.date,
          totalQueries,
          shardHits,
          shardHitRate: Math.round(shardHitRate * 100) / 100,
          estimatedCostPerQuery: Math.round(estimatedCostPerQuery * 100000) / 100000,
        };
      });

      // Calculate summary
      const recentDays = dailyData.slice(-7);
      const previousDays = dailyData.slice(-14, -7);

      const currentHitRate = recentDays.length > 0
        ? recentDays.reduce((sum, d) => sum + d.shardHitRate, 0) / recentDays.length
        : 0;
      const previousHitRate = previousDays.length > 0
        ? previousDays.reduce((sum, d) => sum + d.shardHitRate, 0) / previousDays.length
        : 0;

      const totalFreeAnswers = dailyData.reduce((sum, d) => sum + d.shardHits, 0);
      const estimatedMonthlySavings = (totalFreeAnswers * 500 * 0.003) / 1000; // ~500 tokens per shard hit

      // NEW A: Compute per-category convergence scores
      const categories = categoryRows.map(row => {
        const promotedCount = parseInt(row.promoted_count, 10);
        const avgConfidence = parseFloat(row.avg_confidence);
        const totalQueries = parseInt(row.total_queries, 10);
        const shardHits = parseInt(row.shard_hits, 10);
        const tokensSaved = parseInt(row.total_tokens_saved, 10);
        const hitRate = totalQueries > 0 ? shardHits / totalQueries : 0;
        const convergenceScore = Math.round(hitRate * 100);
        return {
          category: row.category,
          convergenceScore: Math.min(convergenceScore, 100),
          hitRate: Math.round(hitRate * 100) / 100,
          avgConfidence: Math.round(avgConfidence * 100) / 100,
          promotedShards: promotedCount,
          tokensSaved,
        };
      }).sort((a, b) => b.convergenceScore - a.convergenceScore);

      // NEW B: Maturity breakdown
      const verificationMap: Record<string, number> = {};
      const lifecycleMap: Record<string, number> = {};
      for (const row of maturityRows) {
        const count = parseInt(row.count, 10);
        verificationMap[row.verification_status] = (verificationMap[row.verification_status] || 0) + count;
        lifecycleMap[row.lifecycle] = (lifecycleMap[row.lifecycle] || 0) + count;
      }
      const maturity = {
        verification: Object.entries(verificationMap).map(([status, count]) => ({ status, count })),
        lifecycle: Object.entries(lifecycleMap).map(([stage, count]) => ({ stage, count })),
      };

      // NEW C: Feedback health
      const signalMap: Record<string, number> = {};
      for (const row of feedbackRows) {
        signalMap[row.signal_type] = parseInt(row.count, 10);
      }
      const acceptanceCount = signalMap['acceptance'] || 0;
      const correctionCount = signalMap['correction'] || 0;
      const rephraseCount = signalMap['rephrase'] || 0;
      const feedbackDenom = acceptanceCount + correctionCount + rephraseCount;
      const feedback = {
        signals: Object.entries(signalMap).map(([type, count]) => ({ type, count })),
        acceptanceRate: feedbackDenom > 0 ? Math.round((acceptanceCount / feedbackDenom) * 100) / 100 : 0,
        correctionRate: feedbackDenom > 0 ? Math.round((correctionCount / feedbackDenom) * 100) / 100 : 0,
        totalSignals: Object.values(signalMap).reduce((s, c) => s + c, 0),
      };

      // NEW D: Impact metrics with environmental calculations
      const tokensSaved = parseInt(impactRow?.total_tokens_saved || '0', 10);
      const impact = {
        tokensSaved,
        avgShardLatencyMs: parseInt(impactRow?.avg_shard_latency_ms || '0', 10),
        totalExecutions: parseInt(impactRow?.total_executions || '0', 10),
        environmental: {
          powerWhSaved: parseFloat(((tokensSaved / 1000) * 10).toFixed(2)),
          waterMlSaved: Math.round((tokensSaved / 1000) * 500),
          carbonGSaved: parseFloat(((tokensSaved / 1000) * 5).toFixed(2)),
        },
      };

      // NEW E: Top performing shards
      const topShards = topShardRows.map(row => ({
        id: row.shard_id,
        name: row.name,
        category: row.category,
        confidence: parseFloat(row.confidence),
        hits: parseInt(row.hits, 10),
        tokensSaved: parseInt(row.tokens_saved, 10),
      }));

      return {
        daily: dailyData,
        summary: {
          currentHitRate: Math.round(currentHitRate * 100) / 100,
          previousHitRate: Math.round(previousHitRate * 100) / 100,
          trend: currentHitRate > previousHitRate ? 'improving' : currentHitRate < previousHitRate ? 'declining' : 'stable',
          totalFreeAnswers,
          estimatedMonthlySavings: Math.round(estimatedMonthlySavings * 100) / 100,
          activeShards: parseInt(shardCount?.count || '0', 10),
        },
        knowledgeTypes: knowledgeTypes.map(kt => ({
          type: kt.knowledge_type,
          count: parseInt(kt.count, 10),
        })),
        categories,
        maturity,
        feedback,
        impact,
        topShards,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get convergence data');
      reply.code(500);
      return { error: 'Failed to get convergence data' };
    }
  });

  // ===========================================
  // ONBOARDING SUGGESTIONS
  // ===========================================

  // Get suggested prompts that will hit promoted shards (for cold-start)
  app.get('/api/v1/onboarding/suggestions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const suggestions = await query<{
        name: string;
        sample_query: string;
      }>(`
        SELECT name, patterns->>0 as sample_query
        FROM procedural_shards
        WHERE lifecycle = 'promoted' AND visibility = 'public'
          AND execution_count > 5 AND confidence > 0.8
          AND jsonb_array_length(patterns) > 0
        ORDER BY execution_count DESC
        LIMIT 6
      `);

      return {
        suggestions: suggestions.map(s => ({
          name: s.name,
          query: s.sample_query,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get onboarding suggestions');
      reply.code(500);
      return { error: 'Failed to get onboarding suggestions' };
    }
  });


  // ============================================
  // ADMIN: Seed classifier with historical data
  // ============================================
  app.post('/api/v1/admin/seed-classifier', {
    preHandler: [requireAuth],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const tenantId = req.tenant?.tenantId;
    if (!tenantId) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    const user = await queryOne<{ role: string }>(`
      SELECT role FROM users WHERE tenant_id = $1
    `, [tenantId]);

    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      reply.code(403);
      return { error: 'Admin access required' };
    }

    const body = req.body as { daysBack?: number; maxMessages?: number } | undefined;

    try {
      logger.info({ tenantId, daysBack: body?.daysBack, maxMessages: body?.maxMessages }, 'Admin triggered classifier seed');

      const result = await runClassifierSeed({
        daysBack: body?.daysBack ?? 14,
        maxMessages: body?.maxMessages ?? 200,
      });

      return {
        success: true,
        result,
      };
    } catch (err) {
      logger.error({ err }, 'Classifier seed failed');
      reply.code(500);
      return { error: 'Classifier seed failed' };
    }
  });
}
