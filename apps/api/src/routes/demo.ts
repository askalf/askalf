import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';
import {
  ids,
  calculateEnvironmentalImpact,
  ENVIRONMENTAL_CONSTANTS,
  generatePatternHash,
  type EnvironmentalImpact,
} from '@substrate/core';
import { procedural, episodic, semantic, working, checkpoint } from '@substrate/memory';
import {
  generateEmbedding,
  extractIntent,
  routeQuery,
  type RoutingDecision,
  classifyShardMatch,
  logShadowComparison,
  type ShardCandidate,
  completeWithProvider,
  isProviderAvailable,
} from '@substrate/ai';
import { execute } from '@substrate/sandbox';
import { getLogger } from '@substrate/observability';
import { getEventBus } from '@substrate/events';
import crypto from 'crypto';

const logger = getLogger();

// ===========================================
// DEMO ALF PERSONA
// ===========================================

const DEMO_ALF_PERSONA = `
DEMO CONTEXT:
This user is a first-time visitor trying the demo on askalf.org. They have limited interactions, so make every response count.

Guidelines for demo interactions:
- Keep responses punchy and impressive -- show what ALF can actually do
- If you matched a knowledge shard, briefly explain what happened: "I pulled that from a crystallized shard -- zero tokens, instant answer"
- Demonstrate real knowledge depth, not generic chatbot fluff
- Be conversational but sharp -- every word should earn its place
- If the question is simple, answer it fast and mention that ALF handles complex queries too
- Subtly convey that this is a living system (memory, evolution, self-improvement) without being sales-y
`;

// Helper to get Redis client (using event bus)
function getRedis() {
  return getEventBus();
}

// ===========================================
// DEMO ABUSE PROTECTION (Redis-backed)
// ===========================================

// Global demo stats for cost protection
const globalDemoStats = {
  llmCallsThisHour: 0,
  llmCallsToday: 0,
  hourResetAt: Date.now() + 3600000,
  dayResetAt: Date.now() + 86400000,
  shardOnlyMode: false,
};

// Rate limits
const DEMO_RATE_LIMIT = 10; // Max requests per minute per IP
const DEMO_RATE_WINDOW = 60; // 1 minute in seconds
const MAX_SESSIONS_PER_IP_PER_DAY = 10; // Max sessions one IP can create per day (handles shared IPs like homes/offices)
const MAX_SESSIONS_PER_FINGERPRINT_PER_DAY = 3; // Max sessions per fingerprint per day
const SESSION_COUNT_WINDOW = 86400; // 24 hours in seconds
const CAPTCHA_THRESHOLD = 50; // Require CAPTCHA after this many sessions (effectively disabled until Turnstile integrated)

// Cost caps - when exceeded, demo falls back to shard-only mode
const MAX_LLM_CALLS_PER_HOUR = 500;
const MAX_LLM_CALLS_PER_DAY = 5000;

// In-memory fallback (used if Redis unavailable)
const memoryRateLimit = new Map<string, { count: number; resetAt: number }>();
const memorySessionCount = new Map<string, { count: number; resetAt: number }>();

function hashIP(ip: string): string {
  return crypto.createHash('sha256').update(ip + 'substrate-demo-salt').digest('hex').slice(0, 32);
}

function hashFingerprint(fingerprint: string): string {
  return crypto.createHash('sha256').update(fingerprint + 'substrate-fp-salt').digest('hex').slice(0, 32);
}

// Redis-backed rate limiting with memory fallback
async function checkDemoRateLimit(ipHash: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `demo:ratelimit:${ipHash}`;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, DEMO_RATE_WINDOW);
    }

    return count <= DEMO_RATE_LIMIT;
  } catch (err) {
    // Fallback to memory if Redis fails
    logger.warn({ err }, 'Redis rate limit check failed, using memory fallback');
    const now = Date.now();
    const entry = memoryRateLimit.get(ipHash);

    if (!entry || now > entry.resetAt) {
      memoryRateLimit.set(ipHash, { count: 1, resetAt: now + (DEMO_RATE_WINDOW * 1000) });
      return true;
    }

    if (entry.count >= DEMO_RATE_LIMIT) {
      return false;
    }

    entry.count++;
    return true;
  }
}

// Redis-backed session creation limit
async function checkSessionCreationLimit(ipHash: string, fingerprintHash?: string): Promise<{ allowed: boolean; requiresCaptcha: boolean; sessionsUsed: number }> {
  try {
    const redis = getRedis();
    const ipKey = `demo:sessions:ip:${ipHash}`;
    const fpKey = fingerprintHash ? `demo:sessions:fp:${fingerprintHash}` : null;

    // Check IP limit
    const ipCount = await redis.incr(ipKey);
    if (ipCount === 1) {
      await redis.expire(ipKey, SESSION_COUNT_WINDOW);
    }

    // Check fingerprint limit if provided
    let fpCount = 0;
    if (fpKey) {
      fpCount = await redis.incr(fpKey);
      if (fpCount === 1) {
        await redis.expire(fpKey, SESSION_COUNT_WINDOW);
      }
    }

    const maxCount = Math.max(ipCount, fpCount);
    const allowed = ipCount <= MAX_SESSIONS_PER_IP_PER_DAY &&
                    (!fpKey || fpCount <= MAX_SESSIONS_PER_FINGERPRINT_PER_DAY);
    const requiresCaptcha = maxCount > CAPTCHA_THRESHOLD;

    if (!allowed) {
      // Decrement since we're not allowing this session
      await redis.decr(ipKey);
      if (fpKey) await redis.decr(fpKey);
    }

    return { allowed, requiresCaptcha, sessionsUsed: maxCount };
  } catch (err) {
    // Fallback to memory if Redis fails
    logger.warn({ err }, 'Redis session limit check failed, using memory fallback');
    const now = Date.now();
    const entry = memorySessionCount.get(ipHash);

    if (!entry || now > entry.resetAt) {
      memorySessionCount.set(ipHash, { count: 1, resetAt: now + (SESSION_COUNT_WINDOW * 1000) });
      return { allowed: true, requiresCaptcha: false, sessionsUsed: 1 };
    }

    if (entry.count >= MAX_SESSIONS_PER_IP_PER_DAY) {
      return { allowed: false, requiresCaptcha: false, sessionsUsed: entry.count };
    }

    entry.count++;
    return { allowed: true, requiresCaptcha: entry.count > CAPTCHA_THRESHOLD, sessionsUsed: entry.count };
  }
}

function checkGlobalCostLimits(): { allowed: boolean; shardOnly: boolean } {
  const now = Date.now();

  // Reset hourly counter
  if (now > globalDemoStats.hourResetAt) {
    globalDemoStats.llmCallsThisHour = 0;
    globalDemoStats.hourResetAt = now + 3600000;
    // Re-enable LLM if we were in shard-only mode due to hourly limit
    if (globalDemoStats.llmCallsToday < MAX_LLM_CALLS_PER_DAY) {
      globalDemoStats.shardOnlyMode = false;
    }
  }

  // Reset daily counter
  if (now > globalDemoStats.dayResetAt) {
    globalDemoStats.llmCallsToday = 0;
    globalDemoStats.dayResetAt = now + 86400000;
    globalDemoStats.shardOnlyMode = false;
  }

  // Check if we've hit limits
  if (globalDemoStats.llmCallsThisHour >= MAX_LLM_CALLS_PER_HOUR ||
      globalDemoStats.llmCallsToday >= MAX_LLM_CALLS_PER_DAY) {
    globalDemoStats.shardOnlyMode = true;
    return { allowed: true, shardOnly: true };
  }

  return { allowed: true, shardOnly: globalDemoStats.shardOnlyMode };
}

function recordLLMCall() {
  globalDemoStats.llmCallsThisHour++;
  globalDemoStats.llmCallsToday++;

  // Log when approaching limits
  if (globalDemoStats.llmCallsThisHour === Math.floor(MAX_LLM_CALLS_PER_HOUR * 0.8)) {
    logger.warn({ stats: globalDemoStats }, 'Demo LLM calls at 80% of hourly limit');
  }
  if (globalDemoStats.llmCallsToday === Math.floor(MAX_LLM_CALLS_PER_DAY * 0.8)) {
    logger.warn({ stats: globalDemoStats }, 'Demo LLM calls at 80% of daily limit');
  }
}

// Periodically clean up memory fallback entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryRateLimit.entries()) {
    if (now > entry.resetAt) {
      memoryRateLimit.delete(key);
    }
  }
  for (const [key, entry] of memorySessionCount.entries()) {
    if (now > entry.resetAt) {
      memorySessionCount.delete(key);
    }
  }
}, 60000);

// Cloudflare Turnstile CAPTCHA verification
async function verifyCaptcha(token: string, ip: string): Promise<boolean> {
  const TURNSTILE_SECRET = process.env['TURNSTILE_SECRET_KEY'];
  if (!TURNSTILE_SECRET) {
    logger.warn('TURNSTILE_SECRET_KEY not configured, skipping CAPTCHA verification');
    return true; // Skip if not configured
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET,
        response: token,
        remoteip: ip,
      }),
    });

    const result = await response.json() as { success: boolean };
    return result.success;
  } catch (err) {
    logger.error({ err }, 'CAPTCHA verification failed');
    return false;
  }
}

export async function demoRoutes(app: FastifyInstance) {
  // ===========================================
  // CREATE DEMO SESSION
  // ===========================================

  app.post('/api/v1/demo/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      fingerprint?: string;
      userAgent?: string;
      referrer?: string;
      landingPage?: string;
      captchaToken?: string;
    } | undefined;

    const ipHash = hashIP(request.ip);
    const fingerprintHash = body?.fingerprint ? hashFingerprint(body.fingerprint) : undefined;

    // Check rate limit (Redis-backed)
    const rateLimitOk = await checkDemoRateLimit(ipHash);
    if (!rateLimitOk) {
      reply.code(429);
      return { error: 'Too many requests. Please try again later.' };
    }

    // Check session creation limit (Redis-backed with fingerprint)
    const sessionLimit = await checkSessionCreationLimit(ipHash, fingerprintHash);
    if (!sessionLimit.allowed) {
      reply.code(429);
      return { error: 'Session limit reached. Please try again tomorrow or sign up for a free account.' };
    }

    // Require CAPTCHA after threshold
    if (sessionLimit.requiresCaptcha) {
      if (!body?.captchaToken) {
        reply.code(400);
        return {
          error: 'CAPTCHA required',
          requiresCaptcha: true,
          sessionsUsed: sessionLimit.sessionsUsed,
        };
      }

      const captchaValid = await verifyCaptcha(body.captchaToken, request.ip);
      if (!captchaValid) {
        reply.code(400);
        return { error: 'CAPTCHA verification failed. Please try again.' };
      }
    }

    try {
      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const sessionId = ids.session();

      // Create demo session
      await query(`
        INSERT INTO demo_sessions (
          id, session_token, fingerprint, ip_hash,
          interactions_used, max_interactions,
          user_agent, referrer, landing_page,
          created_at, last_active_at, expires_at
        ) VALUES (
          $1, $2, $3, $4,
          0, 5,
          $5, $6, $7,
          NOW(), NOW(), NOW() + INTERVAL '24 hours'
        )
      `, [
        sessionId,
        sessionToken,
        body?.fingerprint,
        ipHash,
        body?.userAgent ?? request.headers['user-agent'],
        body?.referrer ?? request.headers['referer'],
        body?.landingPage,
      ]);

      // Increment global demo session counter
      await query(`
        UPDATE global_counters
        SET counter_value = counter_value + 1, last_updated = NOW()
        WHERE counter_name = 'total_demo_sessions'
      `);

      logger.info({ sessionId, ipHash }, 'Demo session created');

      return {
        sessionToken,
        interactionsRemaining: 3,
        maxInteractions: 3,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to create demo session');
      reply.code(500);
      return { error: 'Failed to create demo session' };
    }
  });

  // ===========================================
  // GET DEMO SESSION STATUS
  // ===========================================

  app.get('/api/v1/demo/session/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as { token: string };

    try {
      const session = await queryOne<{
        id: string;
        interactions_used: number;
        max_interactions: number;
        expires_at: Date;
        total_tokens_saved: number;
        total_water_ml_saved: number;
        total_power_wh_saved: number;
        total_carbon_g_saved: number;
      }>(`
        SELECT
          id, interactions_used, max_interactions, expires_at,
          total_tokens_saved, total_water_ml_saved,
          total_power_wh_saved, total_carbon_g_saved
        FROM demo_sessions
        WHERE session_token = $1
          AND expires_at > NOW()
      `, [token]);

      if (!session) {
        reply.code(404);
        return { error: 'Session not found or expired' };
      }

      return {
        interactionsUsed: session.interactions_used,
        interactionsRemaining: session.max_interactions - session.interactions_used,
        maxInteractions: session.max_interactions,
        expiresAt: session.expires_at.toISOString(),
        environmental: {
          tokensSaved: session.total_tokens_saved,
          waterMlSaved: session.total_water_ml_saved,
          powerWhSaved: session.total_power_wh_saved,
          carbonGSaved: session.total_carbon_g_saved,
        },
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get demo session');
      reply.code(500);
      return { error: 'Failed to get demo session status' };
    }
  });

  // ===========================================
  // DEMO CHAT (Main demo endpoint)
  // ===========================================

  app.post('/api/v1/demo/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      sessionToken: string;
      message: string;
      model?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    } | undefined;

    if (!body?.sessionToken || !body.message) {
      reply.code(400);
      return { error: 'sessionToken and message are required' };
    }

    const message = body.message.trim();
    if (message.length === 0 || message.length > 500) {
      reply.code(400);
      return { error: 'Message must be 1-500 characters' };
    }

    try {
      // Validate session and check interactions
      const session = await queryOne<{
        id: string;
        interactions_used: number;
        max_interactions: number;
        expires_at: Date;
      }>(`
        SELECT id, interactions_used, max_interactions, expires_at
        FROM demo_sessions
        WHERE session_token = $1
          AND expires_at > NOW()
        FOR UPDATE
      `, [body.sessionToken]);

      if (!session) {
        reply.code(404);
        return {
          error: 'Session not found or expired',
          requiresSignup: true,
        };
      }

      if (session.interactions_used >= session.max_interactions) {
        return {
          response: null,
          interactionsRemaining: 0,
          requiresSignup: true,
          message: 'You\'ve used all your free demo interactions. Sign up for free to continue!',
        };
      }

      // ==============================================
      // PHASE 4.5: Route demo through real pipeline
      // Uses same intelligence as authenticated users:
      //   smart router, memory context, cognitive checkpoint, shadow classifier
      // ==============================================

      // Build memory context (public-only, no tenant)
      let memoryContextStr = '';
      let shardMatches: Array<{ id: string; name: string; confidence: number }> = [];
      let hasMemoryContext = false;

      try {
        const contextParts: string[] = [];

        // Procedural: Find relevant shards via embedding (0.5 threshold for context, 0.85 for execution)
        const embedding = await generateEmbedding(message);
        const embeddingMatches = await procedural.findSimilarShardsByEmbedding(embedding, 0.5, 3, false, undefined);
        if (embeddingMatches.length > 0) {
          contextParts.push('## Available Procedural Knowledge');
          for (const sm of embeddingMatches) {
            const similarity = (sm as unknown as { similarity: number }).similarity ?? sm.confidence;
            shardMatches.push({ id: sm.id, name: sm.name, confidence: similarity });
            contextParts.push(`- **${sm.name}** (similarity: ${(similarity * 100).toFixed(0)}%): Patterns: ${sm.patterns.join(', ')}`);
          }
        }

        // Episodic: Find similar past experiences (public only)
        try {
          const episodes = await episodic.findSimilarEpisodes(message, 3, undefined);
          if (episodes.length > 0) {
            contextParts.push('\n## Relevant Past Experiences');
            for (const ep of episodes) {
              contextParts.push(`- ${ep.summary} (${ep.valence}, importance: ${ep.importance.toFixed(2)})`);
              if (ep.lessonsLearned.length > 0) {
                contextParts.push(`  Lessons: ${ep.lessonsLearned.join('; ')}`);
              }
            }
          }
        } catch (e) {
          logger.warn({ err: e }, 'Demo: Failed to fetch episodic context');
        }

        // Semantic: Find related facts (public only)
        try {
          const facts = await semantic.findSimilarFacts(message, 5, undefined);
          if (facts.length > 0) {
            contextParts.push('\n## Known Facts');
            for (const fact of facts) {
              contextParts.push(`- ${fact.statement} (confidence: ${(fact.confidence * 100).toFixed(0)}%)`);
            }
          }
        } catch (e) {
          logger.warn({ err: e }, 'Demo: Failed to fetch semantic context');
        }

        // Working: Find similar contexts (public only)
        try {
          const contexts = await working.findSimilarContexts(message, 3, undefined, undefined);
          if (contexts.length > 0) {
            contextParts.push('\n## Working Memory Context');
            for (const ctx of contexts) {
              if (ctx.extractedFacts && ctx.extractedFacts.length > 0) {
                contextParts.push(`- Session facts: ${ctx.extractedFacts.slice(0, 3).join(', ')}`);
              }
            }
          }
        } catch (e) {
          logger.warn({ err: e }, 'Demo: Failed to fetch working context');
        }

        memoryContextStr = contextParts.join('\n');
        hasMemoryContext = memoryContextStr.length > 0;
      } catch (memErr) {
        logger.warn({ err: memErr }, 'Demo: Failed to build memory context');
      }

      // Run cognitive checkpoint (public-only, no tenant)
      let checkpointPrompt = '';
      try {
        const checkpointContext = await checkpoint.runCheckpoint(message, {
          tenant: undefined,
          includeFailureWarnings: true,
          checkExpensiveOps: true,
        });
        checkpointPrompt = checkpoint.formatCheckpointForPrompt(checkpointContext);
      } catch (cpErr) {
        logger.warn({ err: cpErr }, 'Demo: Cognitive checkpoint failed');
      }

      // ============================
      // SHARD MATCHING (same logic as main pipeline)
      // ============================

      let shard;
      let matchMethod = 'none';
      let environmental: EnvironmentalImpact | null = null;
      let shardKnowledgeType: string | undefined;

      // Strategy 1: Pattern matching via procedural.findShardsByPattern (specificity-scored)
      // Also reused for shadow classifier candidates
      let patternCandidates: Awaited<ReturnType<typeof procedural.findShardsByPattern>> = [];
      try {
        patternCandidates = await procedural.findShardsByPattern(message, undefined);
        if (patternCandidates.length > 0) {
          shard = patternCandidates[0];
          matchMethod = 'pattern';
        }
      } catch (e) {
        logger.warn({ err: e }, 'Demo: Pattern matching failed');
      }

      // Fire shadow classifier async (non-blocking) using already-fetched candidates
      let classifierResultPromise: Promise<Awaited<ReturnType<typeof classifyShardMatch>> | null> | null = null;
      try {
        const allCandidates: ShardCandidate[] = [];

        for (const pc of patternCandidates) {
          allCandidates.push({
            id: pc.id,
            name: pc.name,
            description: undefined,
            patterns: pc.patterns,
            intentTemplate: pc.intentTemplate ?? undefined,
            knowledgeType: pc.knowledgeType ?? undefined,
            confidence: pc.confidence,
          });
        }

        // Add embedding match candidates not already in list
        for (const sm of shardMatches) {
          if (!allCandidates.find(c => c.id === sm.id)) {
            const shardDetail = await procedural.getShardById(sm.id);
            if (shardDetail) {
              allCandidates.push({
                id: shardDetail.id,
                name: shardDetail.name,
                description: undefined,
                patterns: shardDetail.patterns || [],
                intentTemplate: shardDetail.intentTemplate ?? undefined,
                knowledgeType: shardDetail.knowledgeType ?? undefined,
                confidence: sm.confidence,
              });
            }
          }
        }

        if (allCandidates.length > 0) {
          classifierResultPromise = classifyShardMatch(message, allCandidates, { shadowMode: true })
            .catch(err => {
              logger.warn({ err }, 'Demo: Shadow classifier failed');
              return null;
            });
        }
      } catch (scErr) {
        logger.warn({ err: scErr }, 'Demo: Failed to gather candidates for shadow classifier');
      }

      // Strategy 2: Embedding similarity (require 0.85+ confidence for execution)
      if (!shard && shardMatches.length > 0) {
        const bestMatch = shardMatches[0];
        if (bestMatch && bestMatch.confidence >= 0.85) {
          try {
            const fullShard = await procedural.getShardById(bestMatch.id);
            if (fullShard) {
              shard = fullShard;
              matchMethod = 'embedding';
            }
          } catch (e) {
            logger.warn({ err: e }, 'Demo: Embedding shard lookup failed');
          }
        }
      }

      let response = '';
      let isShardHit = false;
      let executionMs = 0;
      let routingDecision: RoutingDecision | null = null;

      // ============================
      // SHARD COMPOSITION — compound query handling
      // When 2+ shards match and the query spans multiple topics, compose outputs
      // ============================
      const isCompound = patternCandidates.length >= 2 && /\b(and|or|also|compare|vs|difference|versus)\b|,\s*\w+.*\?/i.test(message);

      if (isCompound && patternCandidates.length >= 2) {
        const compositionShards = patternCandidates.slice(0, 3); // Max 3 shards
        const composedParts: string[] = [];
        let totalExecMs = 0;
        let totalTokensSaved = 0;
        const executedShardNames: string[] = [];

        for (const cs of compositionShards) {
          try {
            const csResult = await execute(cs.logic, message);
            totalExecMs += csResult.executionMs;
            if (csResult.success && csResult.output) {
              const output = typeof csResult.output === 'string' ? csResult.output : JSON.stringify(csResult.output);
              composedParts.push(output);
              executedShardNames.push(cs.name);
              const estTokens = Math.ceil(message.length / 4) + Math.ceil(output.length / 4);
              totalTokensSaved += estTokens;
              void procedural.recordExecution(cs.id, true, csResult.executionMs, estTokens, 'demo').catch(() => {});
            }
          } catch (compErr) {
            logger.warn({ err: compErr, shardId: cs.id }, 'Composition: shard execution failed');
          }
        }

        if (composedParts.length >= 2) {
          response = composedParts.join('\n\n---\n\n');
          isShardHit = true;
          executionMs = totalExecMs;
          matchMethod = 'composition';
          shardKnowledgeType = 'procedural';
          environmental = calculateEnvironmentalImpact(totalTokensSaved);

          logger.info({
            shards: executedShardNames,
            parts: composedParts.length,
            executionMs: totalExecMs,
          }, 'Shard composition: combined response from multiple shards');

          // Record episodic memory for composition
          void episodic.recordEpisode({
            situation: {
              context: `Composed response from ${executedShardNames.length} shards: ${message.slice(0, 200)}`,
              entities: executedShardNames,
              state: { source: 'demo', composition: true },
            },
            action: {
              type: 'shard_composition',
              description: `Composed ${executedShardNames.join(' + ')}`,
              parameters: { input: message.slice(0, 100), matchMethod: 'composition' },
            },
            outcome: {
              result: `Composed ${composedParts.length} shard outputs`,
              success: true,
              effects: ['tokens_saved', 'composition_used'],
              metrics: { executionMs: totalExecMs },
            },
            type: 'shard_execution',
            summary: `Composition: ${executedShardNames.join(' + ')}`,
            success: true,
            valence: 'positive',
            importance: 0.5,
            lessonsLearned: [],
            metadata: {},
            timestamp: new Date(),
          }, { visibility: 'public' }).catch(() => {});
        } else if (composedParts.length === 1) {
          // Only one shard succeeded — use it as a normal single-shard hit
          shard = compositionShards.find(cs => executedShardNames.includes(cs.name));
          response = composedParts[0]!;
          isShardHit = true;
          executionMs = totalExecMs;
          environmental = calculateEnvironmentalImpact(totalTokensSaved);
        }
      }

      if (!isShardHit && shard) {
        // Execute shard (FREE - no token cost)
        const result = await execute(shard.logic, message);
        isShardHit = true;
        executionMs = result.executionMs;
        shardKnowledgeType = shard.knowledgeType ?? 'procedural';

        if (result.success) {
          const output = result.output;
          response = typeof output === 'string' ? output : JSON.stringify(output ?? 'Execution completed successfully');

          // Calculate environmental savings dynamically based on actual content
          const estimatedInputTokens = Math.ceil(message.length / 4);
          const estimatedOutputTokens = Math.ceil(response.length / 4);
          const tokensSaved = estimatedInputTokens + estimatedOutputTokens;
          environmental = calculateEnvironmentalImpact(tokensSaved);

          // Record shard execution to global stats
          void procedural.recordExecution(shard.id, true, executionMs, tokensSaved, 'demo').catch((err) => {
            logger.warn({ err, shardId: shard.id }, 'Failed to record demo shard execution');
          });

          // Log shadow classifier comparison (fire-and-forget)
          if (classifierResultPromise) {
            void classifierResultPromise.then(cr => {
              if (cr) logShadowComparison(message, { shardId: shard.id, shardName: shard.name, method: matchMethod }, cr);
            });
          }

          // Record episodic memory (public visibility, fire-and-forget)
          void episodic.recordEpisode({
            situation: {
              context: `Demo user request: ${message.slice(0, 200)}`,
              entities: [shard.name, matchMethod],
              state: { source: 'demo', shardConfidence: shard.confidence },
            },
            action: {
              type: 'shard_execution',
              description: `Executed shard: ${shard.name} via ${matchMethod}`,
              parameters: { input: message.slice(0, 100), matchMethod },
            },
            outcome: {
              result: `Success: ${response.slice(0, 100)}`,
              success: true,
              effects: ['tokens_saved', 'demo_user_served'],
              metrics: { executionMs },
            },
            type: 'shard_execution',
            summary: `Demo shard hit: "${shard.name}" via ${matchMethod}`,
            success: true,
            valence: 'positive',
            importance: 0.3,
            lessonsLearned: [],
            metadata: {},
            timestamp: new Date(),
          }, { visibility: 'public' }).catch(() => {});
        } else {
          response = `I couldn't process that: ${result.error || 'Unknown error'}`;
        }
      }

      if (!isShardHit) {
        // No shard match (or composition failed) - log shadow classifier with null existing match
        if (classifierResultPromise) {
          void classifierResultPromise.then(cr => {
            if (cr) logShadowComparison(message, null, cr);
          });
        }

        // Check if LLM fallback is allowed (cost protection)
        const costCheck = checkGlobalCostLimits();

        if (costCheck.shardOnly) {
          // Cost limits hit - shard-only mode, no LLM calls
          logger.info({ message: message.slice(0, 50) }, 'Demo in shard-only mode, LLM fallback disabled');
          response = 'No cached response found for that query. ' +
                     'Try asking about temperature conversions (e.g., "100 fahrenheit to celsius") ' +
                     'or percentage calculations (e.g., "what is 15% of 200") for instant responses! ' +
                     'Sign up for full AI access.';
          executionMs = 0;
        } else {
          // LLM fallback allowed - use Smart Router to select model
          try {
            const startTime = Date.now();

            // Smart Router: select model based on query complexity
            let selectedModel = 'claude-sonnet-4-5'; // fallback
            try {
              routingDecision = routeQuery(message);
              selectedModel = routingDecision.model;
              logger.info({
                tier: routingDecision.tier,
                model: routingDecision.model,
                provider: routingDecision.provider,
                reason: routingDecision.reason,
                confidence: routingDecision.confidence,
              }, 'Demo Smart Router: Model selected');

              // Validate: if non-Claude model selected, check provider availability
              if (!selectedModel.startsWith('claude')) {
                if (!isProviderAvailable(routingDecision.provider)) {
                  logger.info({ provider: routingDecision.provider, model: selectedModel }, 'Demo: Provider not available, falling back to Claude');
                  selectedModel = 'claude-sonnet-4-5';
                  routingDecision = null;
                }
              }
            } catch (routeErr) {
              logger.warn({ err: routeErr }, 'Demo: Smart Router failed, using default model');
            }

            // Build conversation context from history
            let conversationPrompt = message;
            if (body.history && body.history.length > 0) {
              // Limit history to last 6 messages to control costs
              const recentHistory = body.history.slice(-6);
              const historyContext = recentHistory
                .map(msg => `${msg.role === 'user' ? 'User' : 'ALF'}: ${msg.content}`)
                .join('\n\n');
              conversationPrompt = `Previous conversation:\n${historyContext}\n\nUser: ${message}`;
            }

            // Build system prompt: same structure as main pipeline
            const systemPrompt = `You are ALF (AI Learning Friend) - a sharp, genuinely helpful AI assistant who treats every question like it matters.

CRITICAL - FORMATTING RULES (TECHNICAL REQUIREMENT):
The asterisk character (*) BREAKS our display system. You must NEVER output asterisks anywhere in your response. No *emphasis*, no **bold**, no ***anything***. This is not optional - asterisks cause rendering errors.

Use instead:
- Dashes (-) for bullet points
- Plain text for everything else
- CAPS sparingly if you need emphasis

Your Personality:
- Curious and engaged - you find topics interesting and it shows
- Direct but warm - no corporate fluff, just real conversation
- Knowledgeable without being pedantic - share what's useful, skip the lectures
- Slightly witty when appropriate - but never at the user's expense

How to Respond:
- Get to the point quickly - lead with the answer, then explain if needed
- Be specific and practical - vague advice is useless advice
- If you don't know something, say so honestly
- Match the user's energy - casual question gets casual answer, serious gets serious

Boundaries:
- Don't discuss your technical internals (tokens, context windows, architecture)
- If asked about pricing or features, mention they can sign up for free to explore more
- Focus entirely on being helpful with whatever they're asking
${DEMO_ALF_PERSONA}
${checkpointPrompt ? `\n${checkpointPrompt}\n` : ''}${hasMemoryContext ? `\n## Memory Context\n${memoryContextStr}\n\nUse the context above to provide informed responses. Pay attention to any warnings or guidance from the cognitive checkpoint.` : ''}`;

            // Call LLM via completeWithProvider (multi-provider support)
            response = await completeWithProvider(conversationPrompt, {
              model: selectedModel,
              maxTokens: 512, // Kept for cost protection
              temperature: 0.7,
              systemPrompt,
            });
            executionMs = Date.now() - startTime;

            // Record this LLM call for cost tracking
            recordLLMCall();

            // Record trace for crystallization - use actual selected model
            void (async () => {
              try {
                const traceId = ids.trace();
                const intent = await extractIntent(message, response);
                const patternHash = generatePatternHash(message, response);
                const traceEmbedding = await generateEmbedding(`${message} ${response}`);
                const tokensUsed = Math.ceil((message.length + response.length) / 4);

                await query(
                  `INSERT INTO reasoning_traces (
                    id, input, output, pattern_hash, embedding,
                    intent_template, intent_category, intent_name, intent_parameters,
                    tokens_used, execution_ms, model, source, visibility, timestamp
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
                  [
                    traceId,
                    message,
                    response,
                    patternHash,
                    `[${traceEmbedding.join(',')}]`,
                    intent.template,
                    intent.category,
                    intent.intentName,
                    JSON.stringify(intent.parameters),
                    tokensUsed,
                    executionMs,
                    selectedModel,
                    'demo',
                    'public',
                  ]
                );
                logger.info({ traceId, model: selectedModel }, 'Demo trace captured for crystallization');
              } catch (traceErr) {
                logger.warn({ err: traceErr }, 'Failed to capture demo trace');
              }
            })();

            // Record episodic memory for LLM response (fire-and-forget)
            void episodic.recordEpisode({
              situation: {
                context: `Demo user request: ${message.slice(0, 200)}`,
                entities: ['demo_user', selectedModel],
                state: { source: 'demo', model: selectedModel },
              },
              action: {
                type: 'llm_response',
                description: `LLM responded via ${selectedModel}`,
                parameters: { input: message.slice(0, 100) },
              },
              outcome: {
                result: `Answered: ${response.slice(0, 100)}`,
                success: true,
                effects: ['demo_user_served'],
                metrics: { executionMs },
              },
              type: 'llm_response',
              summary: `Demo LLM response via ${selectedModel}`,
              valence: 'neutral',
              importance: 0.2,
              lessonsLearned: [],
              metadata: {},
              timestamp: new Date(),
            }, { visibility: 'public' }).catch(() => {});
          } catch (llmError) {
            logger.error({ err: llmError }, 'Demo LLM fallback failed');
            response = 'I couldn\'t process that request right now. ' +
                       'Try asking about temperature conversions (e.g., "100 fahrenheit to celsius") ' +
                       'or percentage calculations (e.g., "what is 15% of 200") for instant cached responses!';
          }
        }
      }

      // Calculate tokens used for LLM calls
      let tokensUsed = 0;
      if (!isShardHit && response) {
        tokensUsed = Math.ceil((message.length + response.length) / 4);
      }

      // Update session - track which model was used (smart-router-selected or shard)
      const modelUsed = isShardHit ? 'shard' : (routingDecision?.model || body.model || 'claude-sonnet-4-5');
      await query(`
        UPDATE demo_sessions SET
          interactions_used = interactions_used + 1,
          last_active_at = NOW(),
          total_tokens_saved = total_tokens_saved + $1,
          total_water_ml_saved = total_water_ml_saved + $2,
          total_power_wh_saved = total_power_wh_saved + $3,
          total_carbon_g_saved = total_carbon_g_saved + $4,
          models_used = CASE
            WHEN NOT (models_used @> to_jsonb($5::text))
            THEN models_used || to_jsonb($5::text)
            ELSE models_used
          END
        WHERE session_token = $6
      `, [
        environmental?.tokensSaved ?? 0,
        environmental?.waterMlSaved ?? 0,
        environmental?.powerWhSaved ?? 0,
        environmental?.carbonGSaved ?? 0,
        modelUsed,
        body.sessionToken,
      ]);

      const interactionsRemaining = session.max_interactions - session.interactions_used - 1;

      return {
        response,
        interactionsRemaining,
        isShardHit,
        matchMethod,
        executionMs,
        shardName: shard?.name,
        knowledgeType: isShardHit ? (shardKnowledgeType || 'procedural') : undefined,
        tokensUsed: isShardHit ? 0 : tokensUsed,
        environmental: isShardHit ? environmental : null,
        smartRouter: routingDecision ? {
          tier: routingDecision.tier,
          model: routingDecision.model,
          reason: routingDecision.reason,
          confidence: routingDecision.confidence,
        } : undefined,
        memoryContext: hasMemoryContext,
        requiresSignup: interactionsRemaining <= 0,
        hint: interactionsRemaining === 1
          ? 'Last free interaction! Sign up to continue.'
          : interactionsRemaining <= 0
            ? 'Sign up for free to continue chatting!'
            : null,
      };
    } catch (err) {
      logger.error({ err }, 'Demo chat error');
      reply.code(500);
      return { error: 'Chat failed. Please try again.' };
    }
  });

  // ===========================================
  // GET AVAILABLE MODELS FOR TIER
  // ===========================================

  app.get('/api/v1/demo/models', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const models = await query<{
        provider: string;
        model_id: string;
        display_name: string;
        is_fast_model: boolean;
        is_reasoning_model: boolean;
      }>(`
        SELECT provider, model_id, display_name, is_fast_model, is_reasoning_model
        FROM model_access_tiers
        WHERE min_tier = 'demo' AND is_active = TRUE
        ORDER BY provider, display_name
      `);

      return {
        tier: 'demo',
        models: models.map(m => ({
          provider: m.provider,
          modelId: m.model_id,
          displayName: m.display_name,
          isFastModel: m.is_fast_model,
          isReasoningModel: m.is_reasoning_model,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get demo models');
      reply.code(500);
      return { error: 'Failed to get available models' };
    }
  });

  // ===========================================
  // GET GLOBAL ENVIRONMENTAL STATS
  // ===========================================

  app.get('/api/v1/demo/environmental', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get real stats from shard_executions table
      const execStats = await query<{
        total_executions: string;
        total_tokens_saved: string;
      }>(`
        SELECT
          COUNT(*) as total_executions,
          COALESCE(SUM(tokens_saved), 0) as total_tokens_saved
        FROM shard_executions
        WHERE success = true
      `);

      const shardHits = parseInt(execStats[0]?.total_executions || '0', 10);
      const tokensSaved = parseInt(execStats[0]?.total_tokens_saved || '0', 10);

      // Calculate environmental impact from tokens saved
      // Per 1000 tokens: 500ml water, 10Wh power, 5g CO2
      const waterMl = Math.round(tokensSaved * 0.5);
      const powerWh = tokensSaved * 0.01;
      const carbonG = tokensSaved * 0.005;

      const stats: Record<string, number> = {
        'total_tokens_saved': tokensSaved,
        'total_water_ml_saved': waterMl,
        'total_power_wh_saved': powerWh * 100, // stored as x100
        'total_carbon_g_saved': carbonG * 100, // stored as x100
        'total_shard_hits': shardHits,
      };

      // Format for display
      const formatNumber = (n: number, unit: string) => {
        if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B ${unit}`;
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ${unit}`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K ${unit}`;
        return `${n} ${unit}`;
      };

      const formatWater = (ml: number) => {
        if (ml >= 1_000_000) return `${(ml / 1_000_000).toFixed(1)} kL`;
        if (ml >= 1_000) return `${(ml / 1_000).toFixed(1)} L`;
        return `${ml} mL`;
      };

      const formatPower = (wh: number) => {
        if (wh >= 1_000_000) return `${(wh / 1_000_000).toFixed(2)} MWh`;
        if (wh >= 1_000) return `${(wh / 1_000).toFixed(2)} kWh`;
        return `${wh.toFixed(1)} Wh`;
      };

      const formatCarbon = (g: number) => {
        if (g >= 1_000_000) return `${(g / 1_000_000).toFixed(2)} tonnes CO2`;
        if (g >= 1_000) return `${(g / 1_000).toFixed(2)} kg CO2`;
        return `${g.toFixed(1)}g CO2`;
      };

      return {
        global: {
          tokensSaved: stats['total_tokens_saved'] || 0,
          waterMlSaved: stats['total_water_ml_saved'] || 0,
          powerWhSaved: powerWh,
          carbonGSaved: carbonG,
          shardHits: stats['total_shard_hits'] || 0,
        },
        formatted: {
          tokens: formatNumber(stats['total_tokens_saved'] || 0, 'tokens'),
          water: formatWater(stats['total_water_ml_saved'] || 0),
          power: formatPower(powerWh),
          carbon: formatCarbon(carbonG),
        },
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get environmental stats');
      reply.code(500);
      return { error: 'Failed to get environmental statistics' };
    }
  });

  // ===========================================
  // ADMIN: DEMO METRICS (All stats)
  // ===========================================

  app.get('/api/v1/demo/admin/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    // Admin auth check
    const sessionToken = (request.cookies as Record<string, string> | undefined)?.['substrate_session'];
    if (!sessionToken) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(sessionToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const session = await queryOne<{ user_id: string }>(
      `SELECT s.user_id FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.role = 'admin'`,
      [tokenHash]
    );

    if (!session) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    try {
      // Get session stats from database
      const sessionStats = await queryOne<{
        total_sessions: string;
        sessions_today: string;
        active_sessions: string;
        total_interactions: string;
        interactions_today: string;
        unique_fingerprints: string;
        unique_ips: string;
        conversions: string;
      }>(`
        SELECT
          COUNT(*) as total_sessions,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as sessions_today,
          COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '15 minutes' AND expires_at > NOW()) as active_sessions,
          COALESCE(SUM(interactions_used), 0) as total_interactions,
          COALESCE(SUM(interactions_used) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) as interactions_today,
          COUNT(DISTINCT fingerprint) FILTER (WHERE fingerprint IS NOT NULL) as unique_fingerprints,
          COUNT(DISTINCT ip_hash) as unique_ips,
          COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) as conversions
        FROM demo_sessions
      `);

      // Get shard hit stats
      const shardStats = await queryOne<{
        total_shard_hits: string;
        shard_hits_today: string;
      }>(`
        SELECT
          COUNT(*) as total_shard_hits,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as shard_hits_today
        FROM shard_executions
        WHERE success = true
      `);

      // Get rate limit stats from Redis
      let rateLimitBlocks = 0;
      let activeRateLimits = 0;
      try {
        const redis = getRedis();
        const keys = await redis.keys('demo:ratelimit:*');
        activeRateLimits = keys.length;
        // Count high values (near or at limit)
        for (const key of keys.slice(0, 100)) { // Sample first 100
          const val = await redis.get(key);
          if (val && parseInt(val, 10) >= DEMO_RATE_LIMIT) {
            rateLimitBlocks++;
          }
        }
      } catch {
        // Redis unavailable, use memory fallback count
        activeRateLimits = memoryRateLimit.size;
      }

      // Get environmental totals from shard_executions (platform-wide, same as website)
      // Demo is part of the ecosystem - all shard hits count toward global savings
      const execStats = await queryOne<{ total_tokens_saved: string }>(`
        SELECT COALESCE(SUM(tokens_saved), 0) as total_tokens_saved
        FROM shard_executions
        WHERE success = true
      `);
      const tokensSaved = parseInt(execStats?.total_tokens_saved || '0', 10);
      // Calculate environmental impact from tokens saved (500ml water, 10Wh power, 5g CO2 per 1000 tokens)
      const envStats = {
        total_tokens_saved: tokensSaved.toString(),
        total_water_ml: Math.round(tokensSaved * 0.5).toString(),
        total_power_wh: (tokensSaved * 0.01).toString(),
        total_carbon_g: (tokensSaved * 0.005).toString(),
      };

      return {
        sessions: {
          total: parseInt(sessionStats?.total_sessions || '0', 10),
          today: parseInt(sessionStats?.sessions_today || '0', 10),
          active: parseInt(sessionStats?.active_sessions || '0', 10),
          conversions: parseInt(sessionStats?.conversions || '0', 10),
        },
        interactions: {
          total: parseInt(sessionStats?.total_interactions || '0', 10),
          today: parseInt(sessionStats?.interactions_today || '0', 10),
        },
        visitors: {
          uniqueFingerprints: parseInt(sessionStats?.unique_fingerprints || '0', 10),
          uniqueIPs: parseInt(sessionStats?.unique_ips || '0', 10),
        },
        shards: {
          totalHits: parseInt(shardStats?.total_shard_hits || '0', 10),
          hitsToday: parseInt(shardStats?.shard_hits_today || '0', 10),
        },
        llm: {
          callsThisHour: globalDemoStats.llmCallsThisHour,
          callsToday: globalDemoStats.llmCallsToday,
          maxPerHour: MAX_LLM_CALLS_PER_HOUR,
          maxPerDay: MAX_LLM_CALLS_PER_DAY,
          shardOnlyMode: globalDemoStats.shardOnlyMode,
          hourResetsAt: new Date(globalDemoStats.hourResetAt).toISOString(),
          dayResetsAt: new Date(globalDemoStats.dayResetAt).toISOString(),
        },
        rateLimits: {
          activeTracked: activeRateLimits,
          blockedSample: rateLimitBlocks,
          limitPerMinute: DEMO_RATE_LIMIT,
          maxSessionsPerIP: MAX_SESSIONS_PER_IP_PER_DAY,
          maxSessionsPerFingerprint: MAX_SESSIONS_PER_FINGERPRINT_PER_DAY,
          captchaThreshold: CAPTCHA_THRESHOLD,
        },
        environmental: {
          tokensSaved: parseInt(envStats?.total_tokens_saved || '0', 10),
          waterMlSaved: parseInt(envStats?.total_water_ml || '0', 10),
          powerWhSaved: parseFloat(envStats?.total_power_wh || '0'),
          carbonGSaved: parseFloat(envStats?.total_carbon_g || '0'),
        },
        linkClicks: await getLinkClickStats(),
        timestamp: new Date().toISOString(),
      };

      async function getLinkClickStats() {
        try {
          const redis = getRedis();
          const links = ['home', 'our-solution', 'about', 'help', 'signup', 'login', 'terms', 'privacy'];
          const clicks: Record<string, number> = {};
          for (const link of links) {
            const count = await redis.get(`demo:linkclicks:${link}`);
            clicks[link] = parseInt(count || '0', 10);
          }
          return clicks;
        } catch {
          return { home: 0, 'our-solution': 0, about: 0, help: 0, signup: 0, login: 0, terms: 0, privacy: 0 };
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to get demo admin metrics');
      reply.code(500);
      return { error: 'Failed to get demo metrics' };
    }
  });

  // ===========================================
  // ADMIN: PLATFORM ANALYTICS (Full Ecosystem)
  // ===========================================

  app.get('/api/v1/admin/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    // Authenticate via cookie session and require admin role
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.['substrate_session'];

    if (!sessionToken) {
      reply.code(401);
      return { error: 'Authentication required' };
    }

    // Hash the session token and look up user
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const sessionUser = await queryOne<{ user_id: string; role: string }>(`
      SELECT s.user_id, u.role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false
    `, [tokenHash]);

    if (!sessionUser) {
      reply.code(401);
      return { error: 'Invalid or expired session' };
    }

    // Require admin role
    if (sessionUser.role !== 'admin' && sessionUser.role !== 'super_admin') {
      reply.code(403);
      return { error: 'Admin access required' };
    }

    try {
      // ============ USERS & GROWTH ============
      const userStats = await queryOne<{
        total_users: string;
        free_users: string;
        basic_users: string;
        pro_users: string;
        team_users: string;
        lifetime_users: string;
        enterprise_users: string;
        new_today: string;
        new_this_week: string;
        new_this_month: string;
        active_24h: string;
        active_7d: string;
        active_30d: string;
      }>(`
        SELECT
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE t.tier = 'free') as free_users,
          COUNT(*) FILTER (WHERE t.tier = 'basic') as basic_users,
          COUNT(*) FILTER (WHERE t.tier = 'pro') as pro_users,
          COUNT(*) FILTER (WHERE t.tier = 'team') as team_users,
          COUNT(*) FILTER (WHERE t.tier = 'lifetime') as lifetime_users,
          COUNT(*) FILTER (WHERE t.tier = 'enterprise') as enterprise_users,
          COUNT(*) FILTER (WHERE u.created_at > NOW() - INTERVAL '24 hours') as new_today,
          COUNT(*) FILTER (WHERE u.created_at > NOW() - INTERVAL '7 days') as new_this_week,
          COUNT(*) FILTER (WHERE u.created_at > NOW() - INTERVAL '30 days') as new_this_month,
          COUNT(*) FILTER (WHERE u.last_login_at > NOW() - INTERVAL '24 hours') as active_24h,
          COUNT(*) FILTER (WHERE u.last_login_at > NOW() - INTERVAL '7 days') as active_7d,
          COUNT(*) FILTER (WHERE u.last_login_at > NOW() - INTERVAL '30 days') as active_30d
        FROM users u
        JOIN tenants t ON u.tenant_id = t.id
      `);

      // ============ WAITLIST ============
      const waitlistStats = await queryOne<{
        total_waitlist: string;
        waitlist_today: string;
        converted: string;
      }>(`
        SELECT
          COUNT(*) as total_waitlist,
          COUNT(*) FILTER (WHERE w.created_at > NOW() - INTERVAL '24 hours') as waitlist_today,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(w.email)
          )) as converted
        FROM waitlist w
      `);

      // ============ CONVERSATIONS & MESSAGES ============
      const conversationStats = await queryOne<{
        total_conversations: string;
        conversations_today: string;
        total_messages: string;
        messages_today: string;
        avg_messages_per_convo: string;
      }>(`
        SELECT
          COUNT(DISTINCT c.id) as total_conversations,
          COUNT(DISTINCT c.id) FILTER (WHERE c.created_at > NOW() - INTERVAL '24 hours') as conversations_today,
          COUNT(m.id) as total_messages,
          COUNT(m.id) FILTER (WHERE m.created_at > NOW() - INTERVAL '24 hours') as messages_today,
          COALESCE(ROUND(AVG(msg_count), 1), 0) as avg_messages_per_convo
        FROM chat_sessions c
        LEFT JOIN chat_messages m ON m.session_id = c.id
        LEFT JOIN (
          SELECT session_id, COUNT(*) as msg_count
          FROM chat_messages
          GROUP BY session_id
        ) mc ON mc.session_id = c.id
      `);

      // ============ SHARDS & MEMORY ============
      const shardStats = await queryOne<{
        total_shards: string;
        public_shards: string;
        private_shards: string;
        shards_today: string;
        total_executions: string;
        executions_today: string;
        hit_rate: string;
      }>(`
        SELECT
          (SELECT COUNT(*) FROM procedural_shards) as total_shards,
          (SELECT COUNT(*) FROM procedural_shards WHERE visibility = 'public') as public_shards,
          (SELECT COUNT(*) FROM procedural_shards WHERE visibility = 'private') as private_shards,
          (SELECT COUNT(*) FROM procedural_shards WHERE created_at > NOW() - INTERVAL '24 hours') as shards_today,
          (SELECT COUNT(*) FROM shard_executions WHERE success = true) as total_executions,
          (SELECT COUNT(*) FROM shard_executions WHERE success = true AND created_at > NOW() - INTERVAL '24 hours') as executions_today,
          COALESCE(ROUND(
            (SELECT COUNT(*)::numeric FROM shard_executions WHERE success = true) * 100.0 /
            NULLIF((SELECT COUNT(*) FROM chat_messages WHERE role = 'user'), 0),
            1
          ), 0) as hit_rate
      `);

      // ============ TOKEN USAGE ============
      const tokenStats = await queryOne<{
        total_tokens_used: string;
        tokens_today: string;
        tokens_saved: string;
        byok_usage: string;
        bundle_usage: string;
      }>(`
        SELECT
          COALESCE(SUM(tokens_used), 0) as total_tokens_used,
          COALESCE(SUM(tokens_used) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) as tokens_today,
          COALESCE(SUM(tokens_saved), 0) as tokens_saved,
          COALESCE(SUM(tokens_used) FILTER (WHERE token_source = 'byok'), 0) as byok_usage,
          COALESCE(SUM(tokens_used) FILTER (WHERE token_source = 'bundle'), 0) as bundle_usage
        FROM chat_messages
        WHERE role = 'assistant'
      `);

      // ============ DAILY USAGE BY TIER ============
      const usageByTier = await query<{
        tier: string;
        total_used: string;
        user_count: string;
      }>(`
        SELECT
          t.tier,
          COALESCE(SUM(d.credits_used), 0) as total_used,
          COUNT(DISTINCT t.id) as user_count
        FROM tenants t
        LEFT JOIN user_daily_usage d ON d.tenant_id = t.id AND d.usage_date = CURRENT_DATE
        GROUP BY t.tier
        ORDER BY t.tier
      `);

      // ============ API KEYS (BYOK) ============
      const apiKeyStats = await queryOne<{
        total_keys: string;
        openai_keys: string;
        anthropic_keys: string;
        google_keys: string;
        xai_keys: string;
        ollama_keys: string;
        users_with_byok: string;
      }>(`
        SELECT
          COUNT(*) as total_keys,
          COUNT(*) FILTER (WHERE provider = 'openai') as openai_keys,
          COUNT(*) FILTER (WHERE provider = 'anthropic') as anthropic_keys,
          COUNT(*) FILTER (WHERE provider = 'google') as google_keys,
          COUNT(*) FILTER (WHERE provider = 'xai') as xai_keys,
          COUNT(*) FILTER (WHERE provider = 'ollama') as ollama_keys,
          COUNT(DISTINCT tenant_id) as users_with_byok
        FROM user_ai_connectors
        WHERE api_key_encrypted IS NOT NULL AND is_enabled = true
      `);

      // ============ BUNDLES ============
      const bundleStats = await queryOne<{
        total_bundles_sold: string;
        bundles_today: string;
        total_revenue_cents: string;
        active_bundle_users: string;
      }>(`
        SELECT
          COUNT(*) as total_bundles_sold,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as bundles_today,
          COALESCE(SUM(price_usd * 100), 0)::bigint as total_revenue_cents,
          COUNT(DISTINCT tenant_id) FILTER (WHERE tokens_remaining > 0 OR credits_remaining > 0) as active_bundle_users
        FROM token_bundles
      `);

      // ============ SUBSCRIPTIONS ============
      const subscriptionStats = await queryOne<{
        total_subscriptions: string;
        active_subscriptions: string;
        mrr_cents: string;
      }>(`
        SELECT
          COUNT(*) as total_subscriptions,
          COUNT(*) FILTER (WHERE s.status = 'active') as active_subscriptions,
          COALESCE(SUM(p.price_monthly) FILTER (WHERE s.status = 'active'), 0) as mrr_cents
        FROM subscriptions s
        JOIN plans p ON s.plan_id = p.id
      `);

      // ============ ENVIRONMENTAL IMPACT ============
      const envStats = await queryOne<{
        total_tokens_saved: string;
        total_water_ml: string;
        total_power_wh: string;
        total_carbon_g: string;
      }>(`
        SELECT
          COALESCE(SUM(tokens_saved), 0) as total_tokens_saved,
          COALESCE(SUM(water_ml_saved), 0) as total_water_ml,
          COALESCE(SUM(power_wh_saved), 0) as total_power_wh,
          COALESCE(SUM(carbon_g_saved), 0) as total_carbon_g
        FROM chat_messages
        WHERE role = 'assistant' AND shard_id IS NOT NULL
      `);
      const tokensSaved = parseInt(envStats?.total_tokens_saved || '0', 10);
      const waterMlFromDb = parseInt(envStats?.total_water_ml || '0', 10);
      const powerWhFromDb = parseFloat(envStats?.total_power_wh || '0');
      const carbonGRaw = parseFloat(envStats?.total_carbon_g || '0');
      // Fallback: historical rows may not have carbon_g_saved populated
      const carbonGFromDb = carbonGRaw > 0 ? carbonGRaw : parseFloat(((tokensSaved / 1000) * 5).toFixed(2));

      // ============ DEMO STATS (include for comparison) ============
      const demoStats = await queryOne<{
        total_sessions: string;
        sessions_today: string;
        active_sessions: string;
        conversions: string;
      }>(`
        SELECT
          COUNT(*) as total_sessions,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as sessions_today,
          COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '15 minutes' AND expires_at > NOW()) as active_sessions,
          COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) as conversions
        FROM demo_sessions
      `);

      // ============ SYSTEM HEALTH (from recent requests) ============
      const healthStats = await queryOne<{
        p50: string;
        p95: string;
        p99: string;
        error_rate: string;
        active_hours: string;
        total_hours: string;
      }>(`
        SELECT
          COALESCE((SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_ms) FROM chat_messages WHERE response_ms > 0 AND created_at > NOW() - INTERVAL '24 hours'), 0)::integer as p50,
          COALESCE((SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_ms) FROM chat_messages WHERE response_ms > 0 AND created_at > NOW() - INTERVAL '24 hours'), 0)::integer as p95,
          COALESCE((SELECT PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_ms) FROM chat_messages WHERE response_ms > 0 AND created_at > NOW() - INTERVAL '24 hours'), 0)::integer as p99,
          COALESCE(
            ROUND(
              (SELECT COUNT(*)::numeric FROM shard_executions WHERE success = false AND created_at > NOW() - INTERVAL '24 hours') * 100.0 /
              NULLIF((SELECT COUNT(*) FROM shard_executions WHERE created_at > NOW() - INTERVAL '24 hours'), 0),
              2
            ), 0
          ) as error_rate,
          (SELECT COUNT(DISTINCT date_trunc('hour', created_at)) FROM chat_messages WHERE created_at > NOW() - INTERVAL '7 days') as active_hours,
          GREATEST(EXTRACT(EPOCH FROM LEAST(NOW() - COALESCE((SELECT MIN(created_at) FROM chat_messages WHERE created_at > NOW() - INTERVAL '7 days'), NOW()), INTERVAL '7 days')) / 3600.0, 1) as total_hours
      `);
      const activeHours = parseFloat(healthStats?.active_hours || '0');
      const totalHours = parseFloat(healthStats?.total_hours || '1');
      const systemHealth = {
        apiLatencyP50Ms: parseInt(healthStats?.p50 || '0', 10),
        apiLatencyP95Ms: parseInt(healthStats?.p95 || '0', 10),
        apiLatencyP99Ms: parseInt(healthStats?.p99 || '0', 10),
        errorRate: parseFloat(healthStats?.error_rate || '0'),
        uptime: totalHours > 0 ? Math.min(Math.round((activeHours / totalHours) * 1000) / 10, 100) : 0,
      };

      // Get link click stats
      let linkClicks: Record<string, number> = {};
      try {
        const redis = getRedis();
        const links = ['home', 'our-solution', 'about', 'help', 'signup', 'login', 'terms', 'privacy'];
        for (const link of links) {
          const count = await redis.get(`demo:linkclicks:${link}`);
          linkClicks[link] = parseInt(count || '0', 10);
        }
      } catch {
        linkClicks = { home: 0, 'our-solution': 0, about: 0, help: 0, signup: 0, login: 0, terms: 0, privacy: 0 };
      }

      return {
        users: {
          total: parseInt(userStats?.total_users || '0', 10),
          byTier: {
            free: parseInt(userStats?.free_users || '0', 10),
            basic: parseInt(userStats?.basic_users || '0', 10),
            pro: parseInt(userStats?.pro_users || '0', 10),
            team: parseInt(userStats?.team_users || '0', 10),
            lifetime: parseInt(userStats?.lifetime_users || '0', 10),
            enterprise: parseInt(userStats?.enterprise_users || '0', 10),
          },
          growth: {
            today: parseInt(userStats?.new_today || '0', 10),
            thisWeek: parseInt(userStats?.new_this_week || '0', 10),
            thisMonth: parseInt(userStats?.new_this_month || '0', 10),
          },
          active: {
            last24h: parseInt(userStats?.active_24h || '0', 10),
            last7d: parseInt(userStats?.active_7d || '0', 10),
            last30d: parseInt(userStats?.active_30d || '0', 10),
          },
        },
        waitlist: {
          total: parseInt(waitlistStats?.total_waitlist || '0', 10),
          today: parseInt(waitlistStats?.waitlist_today || '0', 10),
          converted: parseInt(waitlistStats?.converted || '0', 10),
          conversionRate: waitlistStats ?
            Math.round((parseInt(waitlistStats.converted || '0', 10) / Math.max(parseInt(waitlistStats.total_waitlist || '1', 10), 1)) * 100) : 0,
        },
        conversations: {
          total: parseInt(conversationStats?.total_conversations || '0', 10),
          today: parseInt(conversationStats?.conversations_today || '0', 10),
          totalMessages: parseInt(conversationStats?.total_messages || '0', 10),
          messagesToday: parseInt(conversationStats?.messages_today || '0', 10),
          avgMessagesPerConvo: parseFloat(conversationStats?.avg_messages_per_convo || '0'),
        },
        shards: {
          total: parseInt(shardStats?.total_shards || '0', 10),
          public: parseInt(shardStats?.public_shards || '0', 10),
          private: parseInt(shardStats?.private_shards || '0', 10),
          createdToday: parseInt(shardStats?.shards_today || '0', 10),
          executions: {
            total: parseInt(shardStats?.total_executions || '0', 10),
            today: parseInt(shardStats?.executions_today || '0', 10),
          },
          hitRate: parseFloat(shardStats?.hit_rate || '0'),
        },
        tokens: {
          totalUsed: parseInt(tokenStats?.total_tokens_used || '0', 10),
          usedToday: parseInt(tokenStats?.tokens_today || '0', 10),
          saved: parseInt(tokenStats?.tokens_saved || '0', 10),
          byokUsage: parseInt(tokenStats?.byok_usage || '0', 10),
          bundleUsage: parseInt(tokenStats?.bundle_usage || '0', 10),
          usageByTier: usageByTier?.map(t => ({
            tier: t.tier,
            totalUsed: parseInt(t.total_used || '0', 10),
            userCount: parseInt(t.user_count || '0', 10),
          })) || [],
        },
        byok: {
          totalKeys: parseInt(apiKeyStats?.total_keys || '0', 10),
          openaiKeys: parseInt(apiKeyStats?.openai_keys || '0', 10),
          anthropicKeys: parseInt(apiKeyStats?.anthropic_keys || '0', 10),
          googleKeys: parseInt(apiKeyStats?.google_keys || '0', 10),
          xaiKeys: parseInt(apiKeyStats?.xai_keys || '0', 10),
          ollamaKeys: parseInt(apiKeyStats?.ollama_keys || '0', 10),
          usersWithByok: parseInt(apiKeyStats?.users_with_byok || '0', 10),
        },
        revenue: {
          bundlesSold: parseInt(bundleStats?.total_bundles_sold || '0', 10),
          bundlesToday: parseInt(bundleStats?.bundles_today || '0', 10),
          bundleRevenueCents: parseInt(bundleStats?.total_revenue_cents || '0', 10),
          activeBundleUsers: parseInt(bundleStats?.active_bundle_users || '0', 10),
          totalSubscriptions: parseInt(subscriptionStats?.total_subscriptions || '0', 10),
          activeSubscriptions: parseInt(subscriptionStats?.active_subscriptions || '0', 10),
          mrrCents: parseInt(subscriptionStats?.mrr_cents || '0', 10),
        },
        environmental: {
          tokensSaved: tokensSaved,
          waterMlSaved: waterMlFromDb,
          powerWhSaved: Math.round(powerWhFromDb * 100) / 100,
          carbonGSaved: Math.round(carbonGFromDb * 100) / 100,
        },
        demo: {
          totalSessions: parseInt(demoStats?.total_sessions || '0', 10),
          sessionsToday: parseInt(demoStats?.sessions_today || '0', 10),
          activeSessions: parseInt(demoStats?.active_sessions || '0', 10),
          conversions: parseInt(demoStats?.conversions || '0', 10),
          llm: {
            callsThisHour: globalDemoStats.llmCallsThisHour,
            callsToday: globalDemoStats.llmCallsToday,
            maxPerHour: MAX_LLM_CALLS_PER_HOUR,
            maxPerDay: MAX_LLM_CALLS_PER_DAY,
            shardOnlyMode: globalDemoStats.shardOnlyMode,
          },
        },
        systemHealth,
        linkClicks,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get platform metrics');
      reply.code(500);
      return { error: 'Failed to get platform metrics' };
    }
  });

  // ===========================================
  // CONVERT DEMO TO USER
  // ===========================================

  app.post('/api/v1/demo/convert', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      sessionToken: string;
      userId: string;
    } | undefined;

    if (!body?.sessionToken || !body.userId) {
      reply.code(400);
      return { error: 'sessionToken and userId are required' };
    }

    try {
      // Update demo session to mark as converted
      const result = await query(`
        UPDATE demo_sessions SET
          converted_to_user_id = $1,
          converted_at = NOW()
        WHERE session_token = $2
          AND converted_to_user_id IS NULL
        RETURNING id, total_tokens_saved, total_water_ml_saved, total_power_wh_saved, total_carbon_g_saved
      `, [body.userId, body.sessionToken]);

      if (result.length === 0) {
        reply.code(404);
        return { error: 'Session not found or already converted' };
      }

      // Transfer environmental stats to user's tenant
      const session = result[0] as {
        id: string;
        total_tokens_saved: number;
        total_water_ml_saved: number;
        total_power_wh_saved: number;
        total_carbon_g_saved: number;
      };

      await query(`
        UPDATE tenants SET
          total_tokens_saved = total_tokens_saved + $1,
          total_water_ml_saved = total_water_ml_saved + $2,
          total_power_wh_saved = total_power_wh_saved + $3,
          total_carbon_g_saved = total_carbon_g_saved + $4
        WHERE id = $5
      `, [
        session.total_tokens_saved,
        session.total_water_ml_saved,
        session.total_power_wh_saved,
        session.total_carbon_g_saved,
        body.userId,
      ]);

      // Increment conversion counter
      await query(`
        UPDATE global_counters
        SET counter_value = counter_value + 1, last_updated = NOW()
        WHERE counter_name = 'total_demo_conversions'
      `);

      logger.info({ sessionId: session.id, userId: body.userId }, 'Demo session converted');

      return {
        success: true,
        environmentalTransferred: {
          tokensSaved: session.total_tokens_saved,
          waterMlSaved: session.total_water_ml_saved,
          powerWhSaved: session.total_power_wh_saved,
          carbonGSaved: session.total_carbon_g_saved,
        },
      };
    } catch (err) {
      logger.error({ err }, 'Failed to convert demo session');
      reply.code(500);
      return { error: 'Failed to convert session' };
    }
  });

  // ===========================================
  // LINK CLICK TRACKING
  // ===========================================

  const VALID_LINK_NAMES = ['home', 'our-solution', 'about', 'help', 'signup', 'login', 'terms', 'privacy'] as const;
  type LinkName = typeof VALID_LINK_NAMES[number];

  // Track a link click
  app.post('/api/v1/demo/track-click', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { link?: string } | undefined;
    const linkName = body?.link?.toLowerCase();

    if (!linkName || !VALID_LINK_NAMES.includes(linkName as LinkName)) {
      reply.code(400);
      return { error: 'Invalid link name' };
    }

    try {
      const redis = getRedis();
      const key = `demo:linkclicks:${linkName}`;
      const todayKey = `demo:linkclicks:${linkName}:${new Date().toISOString().slice(0, 10)}`;

      // Increment total and today's count
      await redis.incr(key);
      await redis.incr(todayKey);
      await redis.expire(todayKey, 86400 * 7); // Keep daily stats for 7 days

      return { success: true };
    } catch (err) {
      // Silently fail for tracking - non-critical
      logger.warn({ err, link: linkName }, 'Failed to track link click');
      return { success: true };
    }
  });

  // Get link click stats (for admin metrics)
  app.get('/api/v1/demo/link-clicks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const redis = getRedis();
      const clicks: Record<string, number> = {};

      for (const linkName of VALID_LINK_NAMES) {
        const count = await redis.get(`demo:linkclicks:${linkName}`);
        clicks[linkName] = parseInt(count || '0', 10);
      }

      return { clicks };
    } catch (err) {
      logger.warn({ err }, 'Failed to get link click stats');
      return {
        clicks: Object.fromEntries(VALID_LINK_NAMES.map(name => [name, 0])),
      };
    }
  });
}
