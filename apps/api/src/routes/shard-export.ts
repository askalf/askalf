/**
 * Shard Export API Routes
 * Export procedural shards as portable JSON for sharing, backup, and shard packs
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '@substrate/database';

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

// Helper to get authenticated admin user
async function getAdminUser(
  request: FastifyRequest
): Promise<{ user_id: string; tenant_id: string } | null> {
  const sessionToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await query<{ user_id: string; tenant_id: string }>(
    `SELECT s.user_id, u.tenant_id FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.role = 'admin'`,
    [tokenHash]
  );

  return session?.[0] || null;
}

interface ExportedShard {
  name: string;
  version: number;
  category: string;
  knowledgeType: string;
  patterns: string[];
  logic: string;
  intentTemplate: string | null;
  confidence: number;
  executionCount: number;
  successCount: number;
  estimatedTokens: number;
  metadata: Record<string, unknown>;
}

interface ShardExportPackage {
  formatVersion: '1.0';
  exportedAt: string;
  source: string;
  shardCount: number;
  shards: ExportedShard[];
}

export async function shardExportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/shards/export
   * Export all promoted shards as portable JSON
   * Query params:
   *   - category: filter by category
   *   - knowledgeType: filter by knowledge_type
   *   - minConfidence: minimum confidence threshold (default 0.5)
   */
  app.get('/api/v1/shards/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const qs = request.query as Record<string, string>;
    const category = qs['category'] || null;
    const knowledgeType = qs['knowledgeType'] || null;
    const minConfidence = parseFloat(qs['minConfidence'] || '0.5');

    const conditions: string[] = [`lifecycle = 'promoted'`, `confidence >= $1`];
    const params: unknown[] = [minConfidence];
    let paramIdx = 2;

    if (category) {
      conditions.push(`category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }

    if (knowledgeType) {
      conditions.push(`knowledge_type = $${paramIdx}`);
      params.push(knowledgeType);
      paramIdx++;
    }

    const shards = await query<{
      name: string;
      version: number;
      category: string;
      knowledge_type: string;
      patterns: string[];
      logic: string;
      intent_template: string | null;
      confidence: number;
      execution_count: number;
      success_count: number;
      estimated_tokens: number;
    }>(
      `SELECT name, version, category, knowledge_type, patterns, logic,
              intent_template, confidence, execution_count, success_count, estimated_tokens
       FROM procedural_shards
       WHERE ${conditions.join(' AND ')}
       ORDER BY category, name`,
      params
    );

    const exportPackage: ShardExportPackage = {
      formatVersion: '1.0',
      exportedAt: new Date().toISOString(),
      source: 'askalf.org',
      shardCount: shards.length,
      shards: shards.map(s => ({
        name: s.name,
        version: s.version,
        category: s.category,
        knowledgeType: s.knowledge_type,
        patterns: s.patterns,
        logic: s.logic,
        intentTemplate: s.intent_template,
        confidence: s.confidence,
        executionCount: s.execution_count,
        successCount: s.success_count,
        estimatedTokens: s.estimated_tokens,
        metadata: {},
      })),
    };

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="alf-shards-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return exportPackage;
  });

  /**
   * GET /api/v1/shards/export/stats
   * Get export statistics without downloading
   */
  app.get('/api/v1/shards/export/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const stats = await query<{
      category: string;
      knowledge_type: string;
      count: string;
      avg_confidence: string;
    }>(
      `SELECT category, knowledge_type, COUNT(*) as count, ROUND(AVG(confidence)::numeric, 3) as avg_confidence
       FROM procedural_shards
       WHERE lifecycle = 'promoted'
       GROUP BY category, knowledge_type
       ORDER BY count DESC`
    );

    const total = stats.reduce((sum, s) => sum + parseInt(s.count, 10), 0);

    return {
      totalExportable: total,
      byCategory: stats.map(s => ({
        category: s.category,
        knowledgeType: s.knowledge_type,
        count: parseInt(s.count, 10),
        avgConfidence: parseFloat(s.avg_confidence),
      })),
    };
  });
}
