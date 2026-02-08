/**
 * Metacognition API Routes
 * Self-reflective AI monitoring and control endpoints
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

// Helper to get authenticated admin user
async function getAdminUser(
  request: FastifyRequest
): Promise<{ user_id: string; tenant_id: string } | null> {
  const sessionToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string; tenant_id: string }>(
    `SELECT s.user_id, u.tenant_id FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.role = 'admin'`,
    [tokenHash]
  );

  return session || null;
}

export async function metacognitionRoutes(app: FastifyInstance): Promise<void> {
  // ============================================
  // PUBLIC: Metacognition Status
  // ============================================

  /**
   * GET /api/v1/meta/status
   * Get current metacognition system status
   */
  app.get('/api/v1/meta/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const summary = await queryOne<{
      total_events: string;
      events_24h: string;
      avg_confidence: string;
    }>(`
      SELECT
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as events_24h,
        AVG(confidence) as avg_confidence
      FROM metacognition_events
    `);

    const shardCounts = await queryOne<{
      total_meta_shards: string;
      reflection_shards: string;
      strategy_shards: string;
      learning_shards: string;
      correction_shards: string;
    }>(`
      SELECT
        COUNT(*) as total_meta_shards,
        COUNT(*) FILTER (WHERE shard_type = 'reflection') as reflection_shards,
        COUNT(*) FILTER (WHERE shard_type = 'strategy') as strategy_shards,
        COUNT(*) FILTER (WHERE shard_type = 'learning') as learning_shards,
        COUNT(*) FILTER (WHERE shard_type = 'correction') as correction_shards
      FROM procedural_shards
      WHERE shard_type != 'standard'
    `);

    return {
      status: 'active',
      events: {
        total: parseInt(summary?.total_events || '0', 10),
        last24h: parseInt(summary?.events_24h || '0', 10),
        avgConfidence: parseFloat(summary?.avg_confidence || '0'),
      },
      metaShards: {
        total: parseInt(shardCounts?.total_meta_shards || '0', 10),
        reflection: parseInt(shardCounts?.reflection_shards || '0', 10),
        strategy: parseInt(shardCounts?.strategy_shards || '0', 10),
        learning: parseInt(shardCounts?.learning_shards || '0', 10),
        correction: parseInt(shardCounts?.correction_shards || '0', 10),
      },
    };
  });

  /**
   * GET /api/v1/meta/summary
   * Get metacognition event summary by type
   */
  app.get('/api/v1/meta/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const { hours = 24 } = request.query as { hours?: number };

    const summary = await query<{
      event_type: string;
      event_count: string;
      avg_confidence: string | null;
      success_rate: string | null;
    }>(`SELECT * FROM get_metacognition_summary($1)`, [hours]);

    return {
      period: `${hours} hours`,
      events: summary.map((e) => ({
        type: e.event_type,
        count: parseInt(e.event_count, 10),
        avgConfidence: parseFloat(e.avg_confidence || '0'),
        successRate: parseFloat(e.success_rate || '0'),
      })),
    };
  });

  // ============================================
  // ADMIN: Full Metacognition Access
  // ============================================

  /**
   * GET /api/v1/meta/events
   * Get recent metacognition events (admin only)
   */
  app.get('/api/v1/meta/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const { limit = 50, type } = request.query as { limit?: number; type?: string };

    let sql = `
      SELECT id, event_type, analysis, tenant_id, trigger_shard_id,
             confidence, action_taken, outcome, success, processing_time_ms, created_at
      FROM metacognition_events
    `;
    const params: unknown[] = [];

    if (type) {
      sql += ' WHERE event_type = $1 ORDER BY created_at DESC LIMIT $2';
      params.push(type, limit);
    } else {
      sql += ' ORDER BY created_at DESC LIMIT $1';
      params.push(limit);
    }

    const events = await query<{
      id: string;
      event_type: string;
      analysis: Record<string, unknown>;
      tenant_id: string | null;
      trigger_shard_id: string | null;
      confidence: number | null;
      action_taken: string | null;
      outcome: string | null;
      success: boolean | null;
      processing_time_ms: number | null;
      created_at: string;
    }>(sql, params);

    return {
      events: events.map((e) => ({
        id: e.id,
        type: e.event_type,
        analysis: e.analysis,
        tenantId: e.tenant_id,
        shardId: e.trigger_shard_id,
        confidence: e.confidence,
        action: e.action_taken,
        outcome: e.outcome,
        success: e.success,
        processingMs: e.processing_time_ms,
        createdAt: e.created_at,
      })),
    };
  });

  /**
   * GET /api/v1/meta/shards
   * Get meta shards (admin only)
   */
  app.get('/api/v1/meta/shards', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const shards = await query<{
      id: string;
      name: string;
      description: string | null;
      shard_type: string;
      lifecycle: string;
      confidence: number;
      execution_count: number;
      success_rate: number | null;
    }>(`
      SELECT id, name, description, shard_type, lifecycle, confidence, execution_count, success_rate
      FROM procedural_shards
      WHERE shard_type != 'standard'
      ORDER BY shard_type, name
    `);

    return { shards };
  });

  /**
   * POST /api/v1/meta/reflect
   * Trigger manual reflection on a response (admin only)
   */
  app.post('/api/v1/meta/reflect', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const body = request.body as { query: string; response: string; traceId?: string };

    if (!body.query || !body.response) {
      return reply.code(400).send({ error: 'query and response are required' });
    }

    // Simple reflection analysis
    const queryWords = new Set(body.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const responseWords = body.response.toLowerCase().split(/\s+/);
    let relevanceMatches = 0;
    for (const word of responseWords) {
      if (queryWords.has(word)) relevanceMatches++;
    }

    const relevance = Math.min(1, (relevanceMatches / queryWords.size) * 2);
    const completeness = Math.min(1, body.response.length / 500);
    const qualityScore = (relevance + completeness) / 2;

    // Record the reflection event
    await query(
      `SELECT record_metacognition_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        'reflection',
        JSON.stringify({ relevance, completeness, qualityScore, manual: true }),
        admin.tenant_id,
        null,
        null,
        body.traceId || null,
        null,
        qualityScore,
        'manual_reflection',
        qualityScore >= 0.7 ? 'quality_acceptable' : 'needs_improvement',
        qualityScore >= 0.7,
        null,
      ]
    );

    return {
      qualityScore,
      relevance,
      completeness,
      flagged: qualityScore < 0.7,
      suggestions: qualityScore < 0.7
        ? ['Consider providing more detailed response', 'Ensure response addresses query directly']
        : [],
    };
  });

  /**
   * POST /api/v1/meta/adjust-confidence
   * Manually adjust shard confidence (admin only)
   */
  app.post('/api/v1/meta/adjust-confidence', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const body = request.body as { shardId: string; adjustment: number; reason: string };

    if (!body.shardId || body.adjustment === undefined || !body.reason) {
      return reply.code(400).send({ error: 'shardId, adjustment, and reason are required' });
    }

    if (body.adjustment < -0.5 || body.adjustment > 0.5) {
      return reply.code(400).send({ error: 'adjustment must be between -0.5 and 0.5' });
    }

    const result = await queryOne<{ adjust_shard_confidence: number }>(
      `SELECT adjust_shard_confidence($1, $2, $3)`,
      [body.shardId, body.adjustment, body.reason]
    );

    if (!result || result.adjust_shard_confidence === null) {
      return reply.code(404).send({ error: 'Shard not found' });
    }

    return {
      success: true,
      shardId: body.shardId,
      newConfidence: result.adjust_shard_confidence,
      adjustment: body.adjustment,
      reason: body.reason,
    };
  });

  /**
   * POST /api/v1/meta/learn
   * Trigger learning analysis (admin only)
   */
  app.post('/api/v1/meta/learn', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    // Get recent uncystallized traces grouped by intent
    const clusters = await query<{
      intent_category: string;
      count: string;
    }>(`
      SELECT intent_category, COUNT(*) as count
      FROM reasoning_traces
      WHERE crystallization_status = 'not_crystallized'
        AND success = true
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY intent_category
      HAVING COUNT(*) >= 5
      ORDER BY COUNT(*) DESC
    `);

    const proposals = clusters.map((c) => ({
      intent: c.intent_category || 'general',
      clusterSize: parseInt(c.count, 10),
      proposedName: `auto_${c.intent_category}_${Date.now()}`,
    }));

    // Record learning event
    if (proposals.length > 0) {
      await query(
        `SELECT record_metacognition_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          'learning_proposal',
          JSON.stringify({ proposals, totalClusters: proposals.length }),
          admin.tenant_id,
          null,
          null,
          null,
          null,
          0.85,
          'pattern_analysis',
          `${proposals.length} patterns detected`,
          true,
          null,
        ]
      );
    }

    return {
      proposals,
      message: proposals.length > 0
        ? `Found ${proposals.length} potential patterns for crystallization`
        : 'No strong patterns detected. Need more traces for analysis.',
    };
  });

  /**
   * GET /api/v1/meta/insights
   * Get learning insights and recommendations (admin only)
   */
  app.get('/api/v1/meta/insights', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminUser(request);
    if (!admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    // Get shard performance data
    const lowConfidenceShards = await query<{
      id: string;
      name: string;
      confidence: number;
      execution_count: number;
      success_rate: number | null;
    }>(`
      SELECT id, name, confidence, execution_count, success_rate
      FROM procedural_shards
      WHERE lifecycle = 'promoted' AND confidence < 0.7
      ORDER BY confidence ASC
      LIMIT 10
    `);

    // Get trending patterns
    const trendingIntents = await query<{
      intent_category: string;
      count: string;
    }>(`
      SELECT intent_category, COUNT(*) as count
      FROM reasoning_traces
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY intent_category
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    // Get error rate
    const errorRate = await queryOne<{
      total: string;
      errors: string;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE success = false) as errors
      FROM reasoning_traces
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);

    return {
      insights: {
        lowConfidenceShards: lowConfidenceShards.map((s) => ({
          id: s.id,
          name: s.name,
          confidence: s.confidence,
          executions: s.execution_count,
          successRate: s.success_rate,
          recommendation: 'Consider reviewing and improving this shard',
        })),
        trendingIntents: trendingIntents.map((t) => ({
          intent: t.intent_category,
          count: parseInt(t.count, 10),
        })),
        errorRate: {
          total: parseInt(errorRate?.total || '0', 10),
          errors: parseInt(errorRate?.errors || '0', 10),
          rate: errorRate
            ? parseInt(errorRate.errors, 10) / parseInt(errorRate.total, 10)
            : 0,
        },
      },
    };
  });
}

export default metacognitionRoutes;
