/**
 * Public Knowledge API Routes
 *
 * External-facing API for querying ALF's knowledge base.
 * Supports browsing, searching, and asking questions against procedural shards.
 *
 * Public endpoints (no auth):
 *   GET  /api/v1/knowledge              - Browse knowledge by category
 *   GET  /api/v1/knowledge/categories    - List categories with counts
 *   GET  /api/v1/knowledge/search        - Search knowledge by query
 *   GET  /api/v1/knowledge/:id           - Get single knowledge item
 *   POST /api/v1/knowledge/ask           - Ask a question (uses AI)
 *
 * Rate limited: 30 req/min for browse, 10 req/min for ask (AI-powered)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';
import { generateEmbedding } from '@substrate/ai';

// Rate limiting for public endpoints
const BROWSE_LIMIT = 30; // per minute per IP
const ASK_LIMIT = 10;    // per minute per IP
const rateCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  const key = `${ip}:${limit}`;
  const entry = rateCounts.get(key);
  if (!entry || now > entry.resetAt) {
    rateCounts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// Clean up rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateCounts) {
    if (now > entry.resetAt) rateCounts.delete(key);
  }
}, 300_000);

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/knowledge
   * Browse the public knowledge base with optional filters.
   *
   * Query params:
   *   category      - Filter by category (e.g., "mathematics", "programming")
   *   knowledgeType - Filter by type: immutable, temporal, contextual, procedural
   *   minConfidence - Minimum confidence score (0-1, default 0.5)
   *   lifecycle     - Shard lifecycle: promoted (default), testing, candidate
   *   sort          - Sort by: confidence (default), executions, recent, name
   *   limit         - Results per page (1-100, default 20)
   *   offset        - Pagination offset (default 0)
   */
  app.get('/api/v1/knowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip, BROWSE_LIMIT)) {
      return reply.code(429).send({ error: 'Rate limit exceeded. Max 30 requests per minute.' });
    }

    const qs = request.query as Record<string, string>;
    const category = qs['category'] || null;
    const knowledgeType = qs['knowledgeType'] || null;
    const minConfidence = Math.max(0, Math.min(1, parseFloat(qs['minConfidence'] || '0.5')));
    const lifecycle = qs['lifecycle'] || 'promoted';
    const sort = qs['sort'] || 'confidence';
    const limit = Math.max(1, Math.min(100, parseInt(qs['limit'] || '20', 10)));
    const offset = Math.max(0, parseInt(qs['offset'] || '0', 10));

    // Build dynamic query
    const conditions: string[] = [
      `lifecycle = $1`,
      `confidence >= $2`,
      `(visibility = 'public' OR visibility IS NULL)`,
    ];
    const params: unknown[] = [lifecycle, minConfidence];
    let paramIdx = 3;

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

    // Sort mapping
    const sortMap: Record<string, string> = {
      confidence: 'confidence DESC',
      executions: 'execution_count DESC',
      recent: 'created_at DESC',
      name: 'name ASC',
    };
    const orderBy = sortMap[sort] || 'confidence DESC';

    // Count total
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM procedural_shards WHERE ${conditions.join(' AND ')}`,
      params,
    );
    const total = parseInt(countResult?.count || '0', 10);

    // Fetch page
    const shards = await query<{
      id: string;
      name: string;
      description: string | null;
      category: string | null;
      knowledge_type: string | null;
      patterns: unknown;
      confidence: number;
      execution_count: number;
      success_count: number;
      failure_count: number;
      estimated_tokens: number;
      intent_template: string | null;
      verification_status: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, description, category, knowledge_type, patterns,
              confidence, execution_count, success_count, failure_count,
              estimated_tokens, intent_template, verification_status,
              created_at, updated_at
       FROM procedural_shards
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return {
      knowledge: shards.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        knowledgeType: s.knowledge_type,
        patterns: s.patterns,
        confidence: s.confidence,
        executionCount: s.execution_count,
        successRate: s.execution_count > 0
          ? Math.round((s.success_count / s.execution_count) * 100)
          : null,
        estimatedTokens: s.estimated_tokens,
        intentTemplate: s.intent_template,
        verificationStatus: s.verification_status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  });

  /**
   * GET /api/v1/knowledge/categories
   * List all knowledge categories with counts and stats.
   */
  app.get('/api/v1/knowledge/categories', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip, BROWSE_LIMIT)) {
      return reply.code(429).send({ error: 'Rate limit exceeded.' });
    }

    const categories = await query<{
      category: string | null;
      knowledge_type: string | null;
      count: string;
      avg_confidence: string;
      total_executions: string;
      promoted_count: string;
    }>(
      `SELECT
        category,
        knowledge_type,
        COUNT(*) as count,
        ROUND(AVG(confidence)::numeric, 3) as avg_confidence,
        SUM(execution_count)::text as total_executions,
        COUNT(*) FILTER (WHERE lifecycle = 'promoted')::text as promoted_count
       FROM procedural_shards
       WHERE (visibility = 'public' OR visibility IS NULL)
         AND lifecycle IN ('promoted', 'testing', 'candidate')
       GROUP BY category, knowledge_type
       ORDER BY COUNT(*) DESC`,
    );

    // Aggregate by category
    const categoryMap = new Map<string, {
      category: string;
      totalShards: number;
      promotedShards: number;
      avgConfidence: number;
      totalExecutions: number;
      knowledgeTypes: string[];
    }>();

    for (const row of categories) {
      const cat = row.category || 'uncategorized';
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.totalShards += parseInt(row.count, 10);
        existing.promotedShards += parseInt(row.promoted_count, 10);
        existing.totalExecutions += parseInt(row.total_executions || '0', 10);
        if (row.knowledge_type && !existing.knowledgeTypes.includes(row.knowledge_type)) {
          existing.knowledgeTypes.push(row.knowledge_type);
        }
      } else {
        categoryMap.set(cat, {
          category: cat,
          totalShards: parseInt(row.count, 10),
          promotedShards: parseInt(row.promoted_count, 10),
          avgConfidence: parseFloat(row.avg_confidence),
          totalExecutions: parseInt(row.total_executions || '0', 10),
          knowledgeTypes: row.knowledge_type ? [row.knowledge_type] : [],
        });
      }
    }

    return {
      categories: Array.from(categoryMap.values()).sort((a, b) => b.totalShards - a.totalShards),
    };
  });

  /**
   * GET /api/v1/knowledge/search
   * Search knowledge by text query (semantic search with embeddings).
   *
   * Query params:
   *   q             - Search query (required)
   *   category      - Filter by category
   *   limit         - Results (1-20, default 10)
   *   mode          - Search mode: semantic (default), text
   */
  app.get('/api/v1/knowledge/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip, BROWSE_LIMIT)) {
      return reply.code(429).send({ error: 'Rate limit exceeded.' });
    }

    const qs = request.query as Record<string, string>;
    const searchQuery = qs['q'] || '';
    const category = qs['category'] || null;
    const limit = Math.max(1, Math.min(20, parseInt(qs['limit'] || '10', 10)));
    const mode = qs['mode'] || 'semantic';

    if (!searchQuery.trim()) {
      return reply.code(400).send({ error: 'Search query (q) is required.' });
    }

    if (mode === 'semantic') {
      // Semantic search using embeddings
      try {
        const embedding = await generateEmbedding(searchQuery);
        const embeddingStr = `[${embedding.join(',')}]`;

        const conditions = [
          `lifecycle = 'promoted'`,
          `(visibility = 'public' OR visibility IS NULL)`,
          `embedding IS NOT NULL`,
        ];
        const params: unknown[] = [embeddingStr, limit];
        let paramIdx = 3;

        if (category) {
          conditions.push(`category = $${paramIdx}`);
          params.push(category);
          paramIdx++;
        }

        const results = await query<{
          id: string;
          name: string;
          description: string | null;
          category: string | null;
          knowledge_type: string | null;
          patterns: unknown;
          confidence: number;
          execution_count: number;
          intent_template: string | null;
          similarity: number;
        }>(
          `SELECT id, name, description, category, knowledge_type, patterns,
                  confidence, execution_count, intent_template,
                  1 - (embedding <=> $1::vector) as similarity
           FROM procedural_shards
           WHERE ${conditions.join(' AND ')}
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          params,
        );

        return {
          query: searchQuery,
          mode: 'semantic',
          results: results.map(r => ({
            id: r.id,
            name: r.name,
            description: r.description,
            category: r.category,
            knowledgeType: r.knowledge_type,
            patterns: r.patterns,
            confidence: r.confidence,
            executionCount: r.execution_count,
            intentTemplate: r.intent_template,
            relevance: Math.round(r.similarity * 100) / 100,
          })),
          total: results.length,
        };
      } catch {
        // Fall back to text search if embedding fails
        return textSearch(searchQuery, category, limit);
      }
    }

    // Text search fallback
    return textSearch(searchQuery, category, limit);
  });

  /**
   * GET /api/v1/knowledge/:id
   * Get a single knowledge item with full details.
   */
  app.get('/api/v1/knowledge/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip, BROWSE_LIMIT)) {
      return reply.code(429).send({ error: 'Rate limit exceeded.' });
    }

    const { id } = request.params as { id: string };

    const shard = await queryOne<{
      id: string;
      name: string;
      description: string | null;
      version: number;
      logic: string;
      patterns: unknown;
      category: string | null;
      knowledge_type: string | null;
      confidence: number;
      execution_count: number;
      success_count: number;
      failure_count: number;
      estimated_tokens: number;
      intent_template: string | null;
      verification_status: string | null;
      lifecycle: string;
      synthesis_method: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, description, version, logic, patterns, category, knowledge_type,
              confidence, execution_count, success_count, failure_count,
              estimated_tokens, intent_template, verification_status, lifecycle,
              synthesis_method, created_at, updated_at
       FROM procedural_shards
       WHERE id = $1 AND (visibility = 'public' OR visibility IS NULL)`,
      [id],
    );

    if (!shard) {
      return reply.code(404).send({ error: 'Knowledge item not found.' });
    }

    // Increment access count
    await query(`UPDATE procedural_shards SET execution_count = execution_count + 1 WHERE id = $1`, [id]);

    return {
      id: shard.id,
      name: shard.name,
      description: shard.description,
      version: shard.version,
      logic: shard.logic,
      patterns: shard.patterns,
      category: shard.category,
      knowledgeType: shard.knowledge_type,
      confidence: shard.confidence,
      executionCount: shard.execution_count,
      successRate: shard.execution_count > 0
        ? Math.round((shard.success_count / shard.execution_count) * 100)
        : null,
      estimatedTokens: shard.estimated_tokens,
      intentTemplate: shard.intent_template,
      verificationStatus: shard.verification_status,
      lifecycle: shard.lifecycle,
      synthesisMethod: shard.synthesis_method,
      createdAt: shard.created_at,
      updatedAt: shard.updated_at,
    };
  });

  /**
   * POST /api/v1/knowledge/ask
   * Ask a natural language question and get an answer backed by knowledge shards.
   * Uses semantic search to find relevant shards, then synthesizes an answer.
   *
   * Body: { question: string, category?: string }
   * Response: { answer: string, sources: [{id, name, confidence, relevance}] }
   */
  app.post('/api/v1/knowledge/ask', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip, ASK_LIMIT)) {
      return reply.code(429).send({ error: 'Rate limit exceeded. Max 10 ask requests per minute.' });
    }

    const body = request.body as { question?: string; category?: string } | null;
    const question = body?.question?.trim();
    const category = body?.category || null;

    if (!question) {
      return reply.code(400).send({ error: 'Question is required.' });
    }

    if (question.length > 1000) {
      return reply.code(400).send({ error: 'Question too long. Max 1000 characters.' });
    }

    try {
      // 1. Generate embedding for the question
      const embedding = await generateEmbedding(question);
      const embeddingStr = `[${embedding.join(',')}]`;

      // 2. Find relevant shards
      const conditions = [
        `lifecycle = 'promoted'`,
        `(visibility = 'public' OR visibility IS NULL)`,
        `embedding IS NOT NULL`,
      ];
      const params: unknown[] = [embeddingStr];
      let paramIdx = 2;

      if (category) {
        conditions.push(`category = $${paramIdx}`);
        params.push(category);
        paramIdx++;
      }

      const shards = await query<{
        id: string;
        name: string;
        description: string | null;
        logic: string;
        patterns: unknown;
        category: string | null;
        confidence: number;
        similarity: number;
      }>(
        `SELECT id, name, description, logic, patterns, category, confidence,
                1 - (embedding <=> $1::vector) as similarity
         FROM procedural_shards
         WHERE ${conditions.join(' AND ')}
         ORDER BY embedding <=> $1::vector
         LIMIT 5`,
        params,
      );

      if (shards.length === 0) {
        return {
          answer: 'No relevant knowledge found for your question.',
          sources: [],
          question,
        };
      }

      // 3. Build context from top shards
      const context = shards
        .filter(s => s.similarity > 0.3) // Only include reasonably relevant shards
        .map(s => `[${s.name}] (confidence: ${s.confidence})\n${s.description || s.logic.substring(0, 300)}`)
        .join('\n\n');

      // 4. Use Anthropic to synthesize an answer
      const { getAnthropic } = await import('@substrate/ai');
      const anthropic = getAnthropic();

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        temperature: 0,
        system: 'You are ALF, a knowledge assistant. Answer questions using ONLY the provided knowledge context. Be concise and accurate. If the context does not contain enough information to answer, say so. Do not make up information.',
        messages: [{
          role: 'user',
          content: `Knowledge context:\n${context}\n\nQuestion: ${question}`,
        }],
      });

      const textBlock = response.content.find(c => c.type === 'text');
      const answer = (textBlock && 'text' in textBlock) ? textBlock.text : 'Unable to generate an answer.';

      return {
        answer,
        question,
        sources: shards
          .filter(s => s.similarity > 0.3)
          .map(s => ({
            id: s.id,
            name: s.name,
            category: s.category,
            confidence: s.confidence,
            relevance: Math.round(s.similarity * 100) / 100,
          })),
        tokensUsed: response.usage?.output_tokens || 0,
      };
    } catch (err) {
      return reply.code(500).send({
        error: 'Failed to process question.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Text search fallback when semantic search is unavailable
 */
async function textSearch(searchQuery: string, category: string | null, limit: number) {
  const conditions = [
    `lifecycle = 'promoted'`,
    `(visibility = 'public' OR visibility IS NULL)`,
    `(name ILIKE $1 OR description ILIKE $1 OR intent_template ILIKE $1)`,
  ];
  const params: unknown[] = [`%${searchQuery}%`, limit];
  let paramIdx = 3;

  if (category) {
    conditions.push(`category = $${paramIdx}`);
    params.push(category);
    paramIdx++;
  }

  const results = await query<{
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    knowledge_type: string | null;
    patterns: unknown;
    confidence: number;
    execution_count: number;
    intent_template: string | null;
  }>(
    `SELECT id, name, description, category, knowledge_type, patterns,
            confidence, execution_count, intent_template
     FROM procedural_shards
     WHERE ${conditions.join(' AND ')}
     ORDER BY confidence DESC
     LIMIT $2`,
    params,
  );

  return {
    query: searchQuery,
    mode: 'text',
    results: results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      knowledgeType: r.knowledge_type,
      patterns: r.patterns,
      confidence: r.confidence,
      executionCount: r.execution_count,
      intentTemplate: r.intent_template,
      relevance: null,
    })),
    total: results.length,
  };
}
