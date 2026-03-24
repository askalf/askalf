/**
 * Marketplace Sync — Fetches approved skills from the central marketplace
 * and caches them locally. Runs daily if marketplace is enabled.
 *
 * Privacy: Only connects if MARKETPLACE_URL is set (opt-in).
 * No user data is sent — only fetches the public skill catalog.
 */

import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const MARKETPLACE_URL = process.env['MARKETPLACE_URL'] || '';
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastSyncAt = 0;
let syncTimer: ReturnType<typeof setInterval> | null = null;

interface RemoteSkill {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  system_prompt?: string;
  tools: string[];
  model: string;
  author_name: string;
  install_count: number;
  avg_rating: number;
  approved_at: string;
}

async function syncFromCentral(): Promise<{ synced: number; error?: string }> {
  if (!MARKETPLACE_URL) return { synced: 0, error: 'Marketplace not enabled' };

  try {
    const res = await fetch(`${MARKETPLACE_URL}/skills?limit=500&sort=recent`, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return { synced: 0, error: `Marketplace returned ${res.status}` };

    const data = await res.json() as { skills: RemoteSkill[] };
    const skills = data.skills || [];
    let synced = 0;

    for (const skill of skills) {
      // Upsert into local community skills table
      const existing = await queryOne(
        `SELECT id FROM forge_agent_templates WHERE slug = $1 AND source = 'marketplace'`,
        [skill.slug],
      );

      if (existing) {
        // Update metadata (install count, rating) but don't overwrite local edits
        await query(
          `UPDATE forge_agent_templates SET
           downloads = $1, rating_sum = $2, rating_count = $3, updated_at = NOW()
           WHERE id = $4`,
          [skill.install_count, Math.round(skill.avg_rating * 10), 10, (existing as Record<string, unknown>)['id']],
        );
      } else {
        // Insert new skill from marketplace
        await query(
          `INSERT INTO forge_agent_templates (
            id, name, slug, category, description, icon, agent_config, required_tools,
            source, visibility, approved, featured, downloads, rating_sum, rating_count,
            author_name, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'marketplace', 'public', true, false, $9, $10, $11, $12, NOW(), NOW())
          ON CONFLICT (slug) DO NOTHING`,
          [
            `mkt_${skill.id}`,
            skill.name,
            skill.slug,
            skill.category,
            skill.description || '',
            '🌐',
            JSON.stringify({
              system_prompt: skill.system_prompt || `You are ${skill.name}.`,
              model: skill.model || 'claude-sonnet-4-6',
            }),
            skill.tools || [],
            skill.install_count || 0,
            Math.round((skill.avg_rating || 0) * 10),
            10,
            skill.author_name || 'Community',
          ],
        );
        synced++;
      }
    }

    lastSyncAt = Date.now();
    console.log(`[Marketplace] Synced ${synced} new skills from central marketplace (${skills.length} total)`);
    return { synced };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Marketplace] Sync failed: ${message}`);
    return { synced: 0, error: message };
  }
}

export async function marketplaceSyncRoutes(app: FastifyInstance): Promise<void> {
  // Start daily sync if marketplace is enabled
  if (MARKETPLACE_URL) {
    console.log(`[Marketplace] Sync enabled — fetching from ${MARKETPLACE_URL} every 24h`);

    // First sync 30 seconds after startup
    setTimeout(() => { void syncFromCentral(); }, 30_000);

    // Then every 24 hours
    syncTimer = setInterval(() => { void syncFromCentral(); }, SYNC_INTERVAL_MS);
  } else {
    console.log('[Marketplace] Central marketplace not configured — community skills are local only');
  }

  /**
   * GET /api/v1/forge/marketplace/sync/status — Check sync status
   */
  app.get(
    '/api/v1/forge/marketplace/sync/status',
    { preHandler: [authMiddleware] },
    async () => ({
      enabled: !!MARKETPLACE_URL,
      url: MARKETPLACE_URL || null,
      lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
      nextSyncAt: lastSyncAt ? new Date(lastSyncAt + SYNC_INTERVAL_MS).toISOString() : null,
    }),
  );

  /**
   * POST /api/v1/forge/marketplace/sync/now — Trigger manual sync
   */
  app.post(
    '/api/v1/forge/marketplace/sync/now',
    { preHandler: [authMiddleware] },
    async (_request, reply) => {
      if (!MARKETPLACE_URL) {
        return reply.code(400).send({ error: 'Marketplace not enabled. Set MARKETPLACE_URL in .env' });
      }
      const result = await syncFromCentral();
      return result;
    },
  );
}
