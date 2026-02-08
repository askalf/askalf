/**
 * SUBSTRATE v1: Tenant Middleware
 *
 * Authentication and multi-tenancy support via API keys.
 * - Extracts tenant context from API key or header
 * - Enforces tier-based limits
 * - Provides tenant-aware query helpers
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';
import { createHash, randomBytes } from 'crypto';

// ============================================
// TYPES
// ============================================

export interface TenantContext {
  tenantId: string;
  tier: 'free' | 'pro' | 'enterprise' | 'system';
  name: string;
  limits: {
    maxPrivateShards: number;
    maxPrivateFacts: number;
    maxMembers: number;
  };
  apiKeyId?: string;
  scopes: string[];
  role?: 'user' | 'admin' | 'super_admin';  // User role for permission checks
}

export interface AuthenticatedRequest extends FastifyRequest {
  tenant?: TenantContext;
}

// ============================================
// API KEY AUTHENTICATION
// ============================================

/**
 * Hash an API key for secure storage/comparison
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key with prefix
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  const key = `sk_${bytes.toString('base64url')}`;
  const prefix = key.substring(0, 12);
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}

/**
 * Look up tenant by API key
 */
async function getTenantByApiKey(apiKey: string): Promise<TenantContext | null> {
  const keyHash = hashApiKey(apiKey);

  const result = await queryOne<{
    tenant_id: string;
    name: string;
    tier: string;
    max_private_shards: number;
    max_private_facts: number;
    max_members: number;
    api_key_id: string;
    scopes: string[];
  }>(`
    SELECT
      t.id as tenant_id,
      t.name,
      t.tier,
      t.max_private_shards,
      t.max_private_facts,
      t.max_members,
      ak.id as api_key_id,
      ak.scopes
    FROM api_keys ak
    JOIN tenants t ON ak.tenant_id = t.id
    WHERE ak.key_hash = $1
      AND ak.status = 'active'
      AND t.status = 'active'
      AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
  `, [keyHash]);

  if (!result) {
    return null;
  }

  // Update last used timestamp
  await query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
    [result.api_key_id]
  );

  const scopes = result.scopes || ['read', 'write', 'execute'];
  // Determine role from scopes
  const role = scopes.includes('admin') ? 'admin' as const : 'user' as const;

  return {
    tenantId: result.tenant_id,
    tier: result.tier as TenantContext['tier'],
    name: result.name,
    limits: {
      maxPrivateShards: result.max_private_shards,
      maxPrivateFacts: result.max_private_facts,
      maxMembers: result.max_members,
    },
    apiKeyId: result.api_key_id,
    scopes,
    role,
  };
}

/**
 * Get the system tenant (for backwards compatibility)
 */
async function getSystemTenant(): Promise<TenantContext> {
  return {
    tenantId: 'tenant_system',
    tier: 'system',
    name: 'SUBSTRATE System',
    limits: {
      maxPrivateShards: -1,
      maxPrivateFacts: -1,
      maxMembers: -1,
    },
    scopes: ['read', 'write', 'execute', 'admin'],
    role: 'super_admin',  // System tenant has full admin access
  };
}

// ============================================
// MIDDLEWARE
// ============================================

/**
 * Authentication middleware - extracts tenant from API key
 *
 * Supports multiple auth methods:
 * 1. API Key in Authorization header: "Bearer sk_..."
 * 2. API Key in X-API-Key header
 * 3. Tenant ID in X-Tenant-ID header (development only)
 * 4. No auth = system tenant (backwards compatible)
 */
export async function tenantMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
  const tenantIdHeader = request.headers['x-tenant-id'] as string | undefined;

  // Try API key authentication first
  let apiKey: string | null = null;

  if (authHeader?.startsWith('Bearer sk_')) {
    apiKey = authHeader.replace('Bearer ', '');
  } else if (apiKeyHeader?.startsWith('sk_')) {
    apiKey = apiKeyHeader;
  }

  if (apiKey) {
    const tenant = await getTenantByApiKey(apiKey);
    if (!tenant) {
      reply.code(401).send({
        error: 'Invalid or expired API key',
        code: 'INVALID_API_KEY',
      });
      return;
    }
    request.tenant = tenant;
    return;
  }

  // Development: Allow X-Tenant-ID header for testing
  if (tenantIdHeader && process.env['NODE_ENV'] !== 'production') {
    const tenant = await queryOne<{
      id: string;
      name: string;
      tier: string;
      max_private_shards: number;
      max_private_facts: number;
      max_members: number;
    }>(`
      SELECT id, name, tier, max_private_shards, max_private_facts, max_members
      FROM tenants
      WHERE id = $1 AND status = 'active'
    `, [tenantIdHeader]);

    if (tenant) {
      request.tenant = {
        tenantId: tenant.id,
        tier: tenant.tier as TenantContext['tier'],
        name: tenant.name,
        limits: {
          maxPrivateShards: tenant.max_private_shards,
          maxPrivateFacts: tenant.max_private_facts,
          maxMembers: tenant.max_members,
        },
        scopes: ['read', 'write', 'execute'],
        role: 'user',  // Default role for dev tenant header
      };
      return;
    }
  }

  // No authentication - use system tenant (backwards compatible)
  request.tenant = await getSystemTenant();
}

/**
 * Require authentication - rejects requests without valid tenant
 */
export async function requireAuth(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.tenant || request.tenant.tenantId === 'tenant_system') {
    reply.code(401).send({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
      hint: 'Provide API key via Authorization header: Bearer sk_...',
    });
    throw new Error('Authentication required');
  }
}

/**
 * Require specific scope
 */
export function requireScope(scope: string) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!request.tenant?.scopes.includes(scope) && !request.tenant?.scopes.includes('admin')) {
      reply.code(403).send({
        error: `Missing required scope: ${scope}`,
        code: 'INSUFFICIENT_SCOPE',
      });
      throw new Error(`Missing required scope: ${scope}`);
    }
  };
}

/**
 * Require admin scope with actual API key (not system tenant fallback)
 */
export async function requireAdmin(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  // Must have actual API key auth (not system tenant fallback)
  if (!request.tenant || request.tenant.tenantId === 'tenant_system') {
    reply.code(401).send({
      error: 'Admin API key required',
      code: 'AUTH_REQUIRED',
      hint: 'Provide admin API key via Authorization header: Bearer sk_...',
    });
    throw new Error('Admin API key required');
  }
  // Must have admin scope
  if (!request.tenant.scopes.includes('admin')) {
    reply.code(403).send({
      error: 'Admin access required',
      code: 'ADMIN_REQUIRED',
    });
    throw new Error('Admin access required');
  }
}

// ============================================
// TENANT-AWARE QUERY HELPERS
// ============================================

/**
 * Build visibility filter for SQL queries
 * Returns { clause: string, params: any[] }
 */
export function buildVisibilityFilter(
  tenant: TenantContext | undefined,
  tableAlias: string = ''
): { clause: string; params: unknown[]; paramOffset: number } {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!tenant || tenant.tenantId === 'tenant_system') {
    // System tenant sees everything
    return { clause: '1=1', params: [], paramOffset: 0 };
  }

  // Regular tenant: sees public + ALF shards (non-system) + own private + own org
  // Explicitly exclude 'system' visibility shards which are admin-only
  return {
    clause: `(
      ${prefix}visibility = 'public'
      OR (${prefix}owner_id IS NULL AND ${prefix}visibility != 'system')
      OR ${prefix}owner_id = $1
    )`,
    params: [tenant.tenantId],
    paramOffset: 1,
  };
}

/**
 * Check if tenant can create a private shard
 */
export async function canCreatePrivateShard(tenant: TenantContext): Promise<boolean> {
  if (tenant.limits.maxPrivateShards === -1) {
    return true; // Unlimited
  }

  if (tenant.limits.maxPrivateShards === 0) {
    return false; // Free tier
  }

  const [result] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM procedural_shards
     WHERE owner_id = $1 AND visibility = 'private'`,
    [tenant.tenantId]
  );

  return parseInt(result?.count ?? '0', 10) < tenant.limits.maxPrivateShards;
}

/**
 * Check if tenant can create a private fact
 */
export async function canCreatePrivateFact(tenant: TenantContext): Promise<boolean> {
  if (tenant.limits.maxPrivateFacts === -1) {
    return true;
  }

  if (tenant.limits.maxPrivateFacts === 0) {
    return false;
  }

  const [result] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM knowledge_facts
     WHERE owner_id = $1 AND visibility = 'private'`,
    [tenant.tenantId]
  );

  return parseInt(result?.count ?? '0', 10) < tenant.limits.maxPrivateFacts;
}

// ============================================
// TENANT MANAGEMENT
// ============================================

/**
 * Create a new tenant
 */
export async function createTenant(opts: {
  name: string;
  slug: string;
  type?: 'user' | 'organization';
  tier?: 'free' | 'pro' | 'enterprise';
  email?: string;
}): Promise<{ tenant: { id: string; name: string; slug: string }; apiKey: string }> {
  const { ids } = await import('@substrate/core');

  const tenantId = ids.tenant ? ids.tenant() : `tenant_${Date.now()}`;
  const { key, prefix, hash } = generateApiKey();
  const apiKeyId = ids.apiKey ? ids.apiKey() : `key_${Date.now()}`;

  // Tier limits
  const tierLimits = {
    free: { shards: 0, facts: 0, members: 1 },
    pro: { shards: 100, facts: 1000, members: 5 },
    enterprise: { shards: -1, facts: -1, members: -1 },
  };

  const limits = tierLimits[opts.tier ?? 'free'];

  // Create tenant
  await query(
    `INSERT INTO tenants (id, name, slug, type, tier, email, max_private_shards, max_private_facts, max_members)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      tenantId,
      opts.name,
      opts.slug,
      opts.type ?? 'user',
      opts.tier ?? 'free',
      opts.email ?? null,
      limits.shards,
      limits.facts,
      limits.members,
    ]
  );

  // Create initial API key
  await query(
    `INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      apiKeyId,
      tenantId,
      'Default API Key',
      hash,
      prefix,
      ['read', 'write', 'execute'],
    ]
  );

  return {
    tenant: { id: tenantId, name: opts.name, slug: opts.slug },
    apiKey: key,
  };
}

/**
 * Create a new API key for a tenant
 */
export async function createApiKey(
  tenantId: string,
  name: string,
  scopes: string[] = ['read', 'write', 'execute']
): Promise<{ key: string; id: string; prefix: string }> {
  const { ids } = await import('@substrate/core');

  const apiKeyId = ids.apiKey ? ids.apiKey() : `key_${Date.now()}`;
  const { key, prefix, hash } = generateApiKey();

  await query(
    `INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [apiKeyId, tenantId, name, hash, prefix, scopes]
  );

  return { key, id: apiKeyId, prefix };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId: string, tenantId: string): Promise<boolean> {
  const result = await query(
    `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND tenant_id = $2`,
    [keyId, tenantId]
  );
  return (result as unknown[]).length > 0;
}

/**
 * Update tenant tier
 */
export async function updateTenantTier(
  tenantId: string,
  tier: 'free' | 'pro' | 'enterprise'
): Promise<void> {
  const tierLimits = {
    free: { shards: 0, facts: 0, members: 1 },
    pro: { shards: 100, facts: 1000, members: 5 },
    enterprise: { shards: -1, facts: -1, members: -1 },
  };

  const limits = tierLimits[tier];

  await query(
    `UPDATE tenants SET
       tier = $2,
       max_private_shards = $3,
       max_private_facts = $4,
       max_members = $5,
       updated_at = NOW()
     WHERE id = $1`,
    [tenantId, tier, limits.shards, limits.facts, limits.members]
  );
}
