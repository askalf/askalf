/**
 * SUBSTRATE v1: Tenant Management Routes
 *
 * API endpoints for tenant and API key management.
 */

import { FastifyInstance } from 'fastify';
import { query, queryOne } from '@substrate/database';
import {
  AuthenticatedRequest,
  requireAuth,
  requireAdmin,
  createTenant,
  createApiKey,
  revokeApiKey,
  updateTenantTier,
} from '../middleware/tenant.js';

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  // ============================================
  // PUBLIC: Tenant Registration
  // ============================================

  /**
   * Register a new tenant (self-service signup)
   */
  app.post('/api/v1/tenants', async (request) => {
    const body = request.body as {
      name: string;
      slug: string;
      email?: string;
      type?: 'user' | 'organization';
    };

    if (!body.name || !body.slug) {
      return { error: 'name and slug are required' };
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(body.slug)) {
      return { error: 'slug must contain only lowercase letters, numbers, and hyphens' };
    }

    // Check if slug is taken
    const existing = await queryOne(
      `SELECT id FROM tenants WHERE slug = $1`,
      [body.slug]
    );

    if (existing) {
      return { error: 'slug is already taken' };
    }

    try {
      const result = await createTenant({
        name: body.name,
        slug: body.slug,
        ...(body.email ? { email: body.email } : {}),
        type: body.type ?? 'user',
        tier: 'free', // Always start on free tier
      });

      return {
        success: true,
        tenant: result.tenant,
        apiKey: result.apiKey,
        message: 'Save your API key - it will not be shown again!',
      };
    } catch (err) {
      return { error: 'Failed to create tenant', details: String(err) };
    }
  });

  // ============================================
  // AUTHENTICATED: Tenant Info
  // ============================================

  /**
   * Get current tenant info
   */
  app.get('/api/v1/tenant', {
    preHandler: requireAuth,
  }, async (request: AuthenticatedRequest) => {
    const tenant = request.tenant!;

    // Get usage stats
    const [stats] = await query<{
      shard_count: string;
      private_shards: string;
      fact_count: string;
      private_facts: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1) as shard_count,
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1 AND visibility = 'private') as private_shards,
        (SELECT COUNT(*) FROM knowledge_facts WHERE owner_id = $1) as fact_count,
        (SELECT COUNT(*) FROM knowledge_facts WHERE owner_id = $1 AND visibility = 'private') as private_facts
    `, [tenant.tenantId]);

    return {
      id: tenant.tenantId,
      name: tenant.name,
      tier: tenant.tier,
      limits: tenant.limits,
      usage: {
        shards: parseInt(stats?.shard_count ?? '0', 10),
        privateShards: parseInt(stats?.private_shards ?? '0', 10),
        facts: parseInt(stats?.fact_count ?? '0', 10),
        privateFacts: parseInt(stats?.private_facts ?? '0', 10),
      },
      scopes: tenant.scopes,
    };
  });

  /**
   * Get tenant's API keys (list, not the actual keys)
   */
  app.get('/api/v1/tenant/keys', {
    preHandler: requireAuth,
  }, async (request: AuthenticatedRequest) => {
    const tenant = request.tenant!;

    const keys = await query<{
      id: string;
      name: string;
      key_prefix: string;
      scopes: string[];
      last_used_at: string | null;
      created_at: string;
      status: string;
    }>(`
      SELECT id, name, key_prefix, scopes, last_used_at, created_at, status
      FROM api_keys
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `, [tenant.tenantId]);

    return {
      keys: keys.map(k => ({
        id: k.id,
        name: k.name,
        prefix: k.key_prefix,
        scopes: k.scopes,
        lastUsedAt: k.last_used_at,
        createdAt: k.created_at,
        status: k.status,
      })),
    };
  });

  /**
   * Create a new API key
   */
  app.post('/api/v1/tenant/keys', {
    preHandler: requireAuth,
  }, async (request: AuthenticatedRequest) => {
    const tenant = request.tenant!;
    const body = request.body as {
      name: string;
      scopes?: string[];
    };

    if (!body.name) {
      return { error: 'name is required' };
    }

    // Validate scopes
    const allowedScopes = ['read', 'write', 'execute'];
    const scopes = (body.scopes ?? ['read', 'write', 'execute']).filter(s => allowedScopes.includes(s));

    const result = await createApiKey(tenant.tenantId, body.name, scopes);

    return {
      success: true,
      key: result.key,
      id: result.id,
      prefix: result.prefix,
      message: 'Save your API key - it will not be shown again!',
    };
  });

  /**
   * Revoke an API key
   */
  app.delete('/api/v1/tenant/keys/:keyId', {
    preHandler: requireAuth,
  }, async (request: AuthenticatedRequest) => {
    const tenant = request.tenant!;
    const { keyId } = request.params as { keyId: string };

    const revoked = await revokeApiKey(keyId, tenant.tenantId);

    if (!revoked) {
      return { error: 'API key not found or already revoked' };
    }

    return { success: true, message: 'API key revoked' };
  });

  // ============================================
  // AUTHENTICATED: Tenant Stats
  // ============================================

  /**
   * Get tenant-scoped stats (only their data)
   */
  app.get('/api/v1/tenant/stats', {
    preHandler: requireAuth,
  }, async (request: AuthenticatedRequest) => {
    const tenant = request.tenant!;

    const [stats] = await query<{
      total_shards: string;
      public_shards: string;
      private_shards: string;
      total_facts: string;
      public_facts: string;
      private_facts: string;
      total_episodes: string;
      total_traces: string;
      total_executions: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1) as total_shards,
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1 AND visibility = 'public') as public_shards,
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1 AND visibility = 'private') as private_shards,
        (SELECT COUNT(*) FROM knowledge_facts WHERE owner_id = $1) as total_facts,
        (SELECT COUNT(*) FROM knowledge_facts WHERE owner_id = $1 AND visibility = 'public') as public_facts,
        (SELECT COUNT(*) FROM knowledge_facts WHERE owner_id = $1 AND visibility = 'private') as private_facts,
        (SELECT COUNT(*) FROM episodes WHERE owner_id = $1) as total_episodes,
        (SELECT COUNT(*) FROM reasoning_traces WHERE owner_id = $1) as total_traces,
        (SELECT COUNT(*) FROM shard_executions se
         JOIN procedural_shards ps ON se.shard_id = ps.id
         WHERE ps.owner_id = $1) as total_executions
    `, [tenant.tenantId]);

    return {
      shards: {
        total: parseInt(stats?.total_shards ?? '0', 10),
        public: parseInt(stats?.public_shards ?? '0', 10),
        private: parseInt(stats?.private_shards ?? '0', 10),
      },
      facts: {
        total: parseInt(stats?.total_facts ?? '0', 10),
        public: parseInt(stats?.public_facts ?? '0', 10),
        private: parseInt(stats?.private_facts ?? '0', 10),
      },
      episodes: parseInt(stats?.total_episodes ?? '0', 10),
      traces: parseInt(stats?.total_traces ?? '0', 10),
      executions: parseInt(stats?.total_executions ?? '0', 10),
    };
  });

  // ============================================
  // ADMIN: Tenant Management
  // ============================================

  /**
   * List all tenants (admin only)
   */
  app.get('/api/v1/admin/tenants', {
    preHandler: requireAdmin,
  }, async (request) => {
    const { limit, offset } = (request as AuthenticatedRequest).query as {
      limit?: string;
      offset?: string;
    };

    const tenants = await query<{
      id: string;
      name: string;
      slug: string;
      type: string;
      tier: string;
      status: string;
      shard_count: number;
      fact_count: number;
      created_at: string;
    }>(`
      SELECT id, name, slug, type, tier, status, shard_count, fact_count, created_at
      FROM tenants
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit ?? '50', 10), parseInt(offset ?? '0', 10)]);

    return { tenants };
  });

  /**
   * Update tenant tier (admin only)
   */
  app.patch('/api/v1/admin/tenants/:tenantId/tier', {
    preHandler: requireAdmin,
  }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const { tier } = request.body as { tier: 'free' | 'pro' | 'enterprise' };

    if (!['free', 'pro', 'enterprise'].includes(tier)) {
      return { error: 'Invalid tier. Must be: free, pro, or enterprise' };
    }

    await updateTenantTier(tenantId, tier);

    return { success: true, message: `Tenant upgraded to ${tier}` };
  });

  /**
   * Suspend a tenant (admin only)
   */
  app.post('/api/v1/admin/tenants/:tenantId/suspend', {
    preHandler: requireAdmin,
  }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };

    await query(
      `UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
      [tenantId]
    );

    // Revoke all API keys
    await query(
      `UPDATE api_keys SET status = 'revoked' WHERE tenant_id = $1`,
      [tenantId]
    );

    return { success: true, message: 'Tenant suspended' };
  });

  /**
   * Reactivate a tenant (admin only)
   */
  app.post('/api/v1/admin/tenants/:tenantId/reactivate', {
    preHandler: requireAdmin,
  }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };

    await query(
      `UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [tenantId]
    );

    return { success: true, message: 'Tenant reactivated' };
  });
}
