/**
 * Shard Packs API Routes
 * Browse, preview, and install curated knowledge packs
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';

// Cookie settings
const SESSION_COOKIE_NAME = 'substrate_session';

// Helper to hash session token
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Helper to get authenticated user (any role)
async function getAuthUser(
  request: FastifyRequest
): Promise<{ user_id: string; tenant_id: string; role: string } | null> {
  const sessionToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string; tenant_id: string; role: string }>(
    `SELECT s.user_id, u.tenant_id, u.role FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false`,
    [tokenHash]
  );

  return session || null;
}

export async function shardPackRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/packs
   * List available shard packs (public, no auth required for browsing)
   */
  app.get('/api/v1/packs', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const packs = await query<{
      id: string;
      name: string;
      slug: string;
      description: string;
      category: string;
      version: number;
      shard_count: number;
      total_estimated_tokens: number;
      author: string;
      is_featured: boolean;
      created_at: string;
    }>(
      `SELECT id, name, slug, description, category, version, shard_count,
              total_estimated_tokens, author, is_featured, created_at
       FROM shard_packs
       WHERE is_public = true
       ORDER BY is_featured DESC, shard_count DESC`
    );

    return {
      packs: packs.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        category: p.category,
        version: p.version,
        shardCount: p.shard_count,
        totalEstimatedTokens: p.total_estimated_tokens,
        author: p.author,
        isFeatured: p.is_featured,
        createdAt: p.created_at,
      })),
    };
  });

  /**
   * GET /api/v1/packs/:slug
   * Get pack details including shard list
   */
  app.get('/api/v1/packs/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };

    const pack = await queryOne<{
      id: string;
      name: string;
      slug: string;
      description: string;
      category: string;
      version: number;
      shard_count: number;
      total_estimated_tokens: number;
      author: string;
      is_featured: boolean;
      created_at: string;
    }>(
      `SELECT id, name, slug, description, category, version, shard_count,
              total_estimated_tokens, author, is_featured, created_at
       FROM shard_packs WHERE slug = $1 AND is_public = true`,
      [slug]
    );

    if (!pack) {
      return reply.code(404).send({ error: 'Pack not found' });
    }

    const items = await query<{
      shard_name: string;
      display_order: number;
      confidence: number | null;
      knowledge_type: string | null;
      execution_count: number | null;
      estimated_tokens: number | null;
    }>(
      `SELECT spi.shard_name, spi.display_order,
              ps.confidence, ps.knowledge_type, ps.execution_count, ps.estimated_tokens
       FROM shard_pack_items spi
       LEFT JOIN procedural_shards ps ON ps.name = spi.shard_name AND ps.lifecycle = 'promoted'
       WHERE spi.pack_id = $1
       ORDER BY spi.display_order`,
      [pack.id]
    );

    return {
      id: pack.id,
      name: pack.name,
      slug: pack.slug,
      description: pack.description,
      category: pack.category,
      version: pack.version,
      shardCount: pack.shard_count,
      totalEstimatedTokens: pack.total_estimated_tokens,
      author: pack.author,
      isFeatured: pack.is_featured,
      createdAt: pack.created_at,
      shards: items.map(i => ({
        name: i.shard_name,
        order: i.display_order,
        confidence: i.confidence,
        knowledgeType: i.knowledge_type,
        executionCount: i.execution_count,
        estimatedTokens: i.estimated_tokens,
      })),
    };
  });

  /**
   * POST /api/v1/packs/:slug/install
   * Install a pack for the authenticated user's tenant
   * This records the installation — shards are already in the global pool
   */
  app.post('/api/v1/packs/:slug/install', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const { slug } = request.params as { slug: string };

    const pack = await queryOne<{ id: string; name: string; shard_count: number }>(
      `SELECT id, name, shard_count FROM shard_packs WHERE slug = $1 AND is_public = true`,
      [slug]
    );

    if (!pack) {
      return reply.code(404).send({ error: 'Pack not found' });
    }

    // Check if already installed
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM shard_pack_installs WHERE pack_id = $1 AND tenant_id = $2`,
      [pack.id, user.tenant_id]
    );

    if (existing) {
      return { installed: true, alreadyInstalled: true, packName: pack.name, shardCount: pack.shard_count };
    }

    // Record installation
    const installId = `spi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await query(
      `INSERT INTO shard_pack_installs (id, pack_id, tenant_id) VALUES ($1, $2, $3)`,
      [installId, pack.id, user.tenant_id]
    );

    return {
      installed: true,
      alreadyInstalled: false,
      packName: pack.name,
      shardCount: pack.shard_count,
    };
  });

  /**
   * GET /api/v1/packs/installed
   * List packs installed by the authenticated user's tenant
   */
  app.get('/api/v1/packs/installed', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const installed = await query<{
      pack_id: string;
      name: string;
      slug: string;
      description: string;
      category: string;
      shard_count: number;
      installed_at: string;
    }>(
      `SELECT sp.id as pack_id, sp.name, sp.slug, sp.description, sp.category,
              sp.shard_count, spi.installed_at
       FROM shard_pack_installs spi
       JOIN shard_packs sp ON sp.id = spi.pack_id
       WHERE spi.tenant_id = $1
       ORDER BY spi.installed_at DESC`,
      [user.tenant_id]
    );

    return {
      packs: installed.map(p => ({
        packId: p.pack_id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        category: p.category,
        shardCount: p.shard_count,
        installedAt: p.installed_at,
      })),
    };
  });
}
