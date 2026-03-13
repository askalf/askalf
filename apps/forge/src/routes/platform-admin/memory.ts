/**
 * Platform Admin — Fleet memory proxy + Git space proxy + AI review
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/auth.js';
import { reviewStore, reviewStoreSet, REVIEW_SYSTEM_PROMPT, runCliQuery, persistReview, loadReviewFromDb } from './utils.js';
import { query } from '../../database.js';
import { getMetabolicStatus } from '../../memory/metabolic.js';

export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {

  // ------------------------------------------
  // FLEET MEMORY (proxy to /api/v1/forge/fleet/*)
  // ------------------------------------------

  app.get(
    '/api/v1/admin/memory/stats',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/forge/fleet/stats', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).headers(Object.fromEntries(Object.entries(res.headers).filter(([k]) => k.startsWith('content')))).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/memory/search',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as Record<string, string>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(qs)) { if (v) params.set(k, v); }
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/fleet/search?${params.toString()}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/memory/recent',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as Record<string, string>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(qs)) { if (v) params.set(k, v); }
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/fleet/recent?${params.toString()}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/memory/recalls',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as Record<string, string>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(qs)) { if (v) params.set(k, v); }
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/fleet/recalls?${params.toString()}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/memory/store',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/fleet/store', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  // ------------------------------------------
  // BRAIN ACTIVITY — memory consolidation metrics
  // ------------------------------------------

  app.get(
    '/api/v1/admin/memory/brain-activity',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      // 1. Metabolic cycle status
      const cycles = getMetabolicStatus();

      // 2. Memory counts per tier
      const memoryCounts = await query<{ tier: string; count: string }>(
        `SELECT 'procedural' AS tier, COUNT(*)::text AS count FROM forge_procedural_memories
         UNION ALL SELECT 'semantic', COUNT(*)::text FROM forge_semantic_memories
         UNION ALL SELECT 'episodic', COUNT(*)::text FROM forge_episodic_memories`,
      );
      const memory = Object.fromEntries(memoryCounts.map((r) => [r.tier, parseInt(r.count, 10)]));

      // 3. Memories created/merged/pruned in last 24h
      const [created24h] = await Promise.all([
        query<{ tier: string; count: string }>(
          `SELECT 'semantic' AS tier, COUNT(*)::text AS count FROM forge_semantic_memories WHERE created_at > NOW() - INTERVAL '24 hours'
           UNION ALL SELECT 'episodic', COUNT(*)::text FROM forge_episodic_memories WHERE created_at > NOW() - INTERVAL '24 hours'
           UNION ALL SELECT 'procedural', COUNT(*)::text FROM forge_procedural_memories WHERE created_at > NOW() - INTERVAL '24 hours'`,
        ),
      ]);
      const createdLast24h = Object.fromEntries(created24h.map((r) => [r.tier, parseInt(r.count, 10)]));

      // 4. Top 5 most-accessed memories (hot memories)
      const hotMemories = await query<{
        id: string; content: string; access_count: string; importance: string; agent_id: string;
      }>(
        `SELECT id, LEFT(content, 200) AS content, access_count::text, importance::text, agent_id
         FROM forge_semantic_memories
         ORDER BY access_count DESC NULLS LAST
         LIMIT 5`,
      );

      // 5. Memory growth rate — new memories per hour over last 7 days
      const growthTrend = await query<{ hour_bucket: string; count: string }>(
        `SELECT date_trunc('hour', created_at)::text AS hour_bucket, COUNT(*)::text AS count
         FROM (
           SELECT created_at FROM forge_semantic_memories WHERE created_at > NOW() - INTERVAL '7 days'
           UNION ALL SELECT created_at FROM forge_episodic_memories WHERE created_at > NOW() - INTERVAL '7 days'
           UNION ALL SELECT created_at FROM forge_procedural_memories WHERE created_at > NOW() - INTERVAL '7 days'
         ) AS all_memories
         GROUP BY 1 ORDER BY 1`,
      );

      // 6. Cross-agent knowledge transfer count
      const crossAgentRows = await query<{ shared_count: string }>(
        `SELECT COUNT(*)::text AS shared_count
         FROM forge_semantic_memories
         WHERE metadata->>'shared_from' IS NOT NULL`,
      );
      const crossAgentTransfers = parseInt(crossAgentRows[0]?.shared_count || '0', 10);

      return {
        cycles: cycles.map((c) => ({
          ...c,
          status: !c.lastRun ? 'unknown' as const
            : c.lastError ? 'failed' as const
            : (Date.now() - new Date(c.lastRun).getTime()) > c.intervalHours * 3600_000 * 2
              ? 'stale' as const
              : 'healthy' as const,
        })),
        memory,
        activity: {
          created_last_24h: createdLast24h,
          hot_memories: hotMemories.map((m) => ({
            id: m.id,
            content: m.content,
            access_count: parseInt(m.access_count, 10),
            importance: parseFloat(m.importance),
            agent_id: m.agent_id,
          })),
          growth_trend: growthTrend.map((r) => ({
            hour: r.hour_bucket,
            count: parseInt(r.count, 10),
          })),
          cross_agent_transfers: crossAgentTransfers,
        },
      };
    },
  );

  // ------------------------------------------
  // GIT SPACE (proxy to /api/v1/forge/git/*)
  // ------------------------------------------

  app.get(
    '/api/v1/admin/git-space/branches',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/forge/git/branches', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/git-space/diff/:branch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch } = request.params as { branch: string };
      const headers = { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' };
      const encoded = encodeURIComponent(branch);
      const [diffRes, logRes, filesRes] = await Promise.all([
        app.inject({ method: 'GET', url: `/api/v1/forge/git/diff/${encoded}`, headers }),
        app.inject({ method: 'GET', url: `/api/v1/forge/git/log/${encoded}`, headers }),
        app.inject({ method: 'GET', url: `/api/v1/forge/git/files/${encoded}`, headers }),
      ]);
      if (diffRes.statusCode !== 200) {
        return reply.code(diffRes.statusCode).send(diffRes.json());
      }
      const diff = diffRes.json() as Record<string, unknown>;
      const log = logRes.statusCode === 200 ? (logRes.json() as Record<string, unknown>) : {};
      const files = filesRes.statusCode === 200 ? (filesRes.json() as Record<string, unknown>) : {};
      return reply.send({
        ...diff,
        commits: log['commits'] || [],
        files: files['files'] || [],
      });
    },
  );

  app.get(
    '/api/v1/admin/git-space/health/:service',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { service } = request.params as { service: string };
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/git/health/${encodeURIComponent(service)}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/git-space/merge',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/git/merge', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/git-space/deploy',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/git/deploy', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.post(
    '/api/v1/admin/git-space/rebuild',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/forge/git/rebuild', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', 'content-type': 'application/json' }, payload: JSON.stringify(request.body) });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/git-space/rebuild/:builderId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { builderId } = request.params as { builderId: string };
      const res = await app.inject({ method: 'GET', url: `/api/v1/forge/git/rebuild/${encodeURIComponent(builderId)}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.delete(
    '/api/v1/admin/git-space/rebuild/:taskId',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as { taskId: string };
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/forge/git/rebuild/${encodeURIComponent(taskId)}`, headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  app.get(
    '/api/v1/admin/git-space/rebuild/tasks',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/forge/git/rebuild/tasks', headers: { authorization: request.headers.authorization || '', cookie: request.headers.cookie || '' } });
      reply.code(res.statusCode).send(res.json());
    },
  );

  // ------------------------------------------
  // AI CODE REVIEW
  // ------------------------------------------

  app.post(
    '/api/v1/admin/git-space/ai-review',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch, diff } = request.body as { branch?: string; diff?: string };
      if (!diff) {
        return reply.status(400).send({ error: 'diff is required' });
      }

      const reviewId = ulid();
      const initialEntry = { status: 'pending' as const, branch: branch || 'unknown', diff };
      reviewStoreSet(reviewId, initialEntry);
      void persistReview(reviewId, initialEntry);

      void (async () => {
        try {
          const prompt = `${REVIEW_SYSTEM_PROMPT}\n\nBranch: ${branch || 'unknown'}\n\n${diff}`;
          const result = await runCliQuery(prompt, {
            maxTurns: 1,
            timeout: 120_000,
            systemPrompt: 'You are an expert code reviewer. Return only valid JSON, no markdown fences.',
          });

          if (result.isError) {
            throw new Error(result.output || 'CLI execution failed');
          }

          let jsonText = result.output.trim();
          if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          }
          const firstBrace = jsonText.indexOf('{');
          const lastBrace = jsonText.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            jsonText = jsonText.substring(firstBrace, lastBrace + 1);
          }
          const parsed = JSON.parse(jsonText);

          const entry = reviewStore.get(reviewId);
          if (entry) {
            entry.status = 'completed';
            entry.result = {
              summary: parsed.summary || 'Review complete.',
              issues: Array.isArray(parsed.issues) ? parsed.issues : [],
              suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
              approved: Boolean(parsed.approved),
            };
            entry.rawOutput = result.output;
            void persistReview(reviewId, entry);
          }
        } catch (err) {
          console.error(`[AI Review] Failed for ${reviewId}:`, err);
          const entry = reviewStore.get(reviewId);
          if (entry) {
            entry.status = 'failed';
            entry.error = err instanceof Error ? err.message : String(err);
            void persistReview(reviewId, entry);
          }
        }
      })();

      return reply.status(202).send({ review_id: reviewId, status: 'pending', message: 'AI review initiated' });
    },
  );

  app.get(
    '/api/v1/admin/git-space/review-result/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      let entry = reviewStore.get(id);
      if (!entry) {
        entry = await loadReviewFromDb(id) ?? undefined;
      }

      if (!entry) {
        return reply.status(404).send({ error: 'Review not found' });
      }

      if (entry.status === 'pending') {
        return reply.send({ status: 'pending' });
      }

      if (entry.status === 'failed') {
        return reply.send({ status: 'failed', error: entry.error || 'Unknown error' });
      }

      return reply.send({
        status: 'completed',
        summary: entry.result?.summary || '',
        issues: entry.result?.issues || [],
        suggestions: entry.result?.suggestions || [],
        approved: entry.result?.approved ?? true,
      });
    },
  );

  app.post(
    '/api/v1/admin/git-space/ai-review/chat',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { review_id, message } = request.body as { review_id?: string; message?: string };
      if (!review_id || !message) {
        return reply.status(400).send({ error: 'review_id and message are required' });
      }

      let entry = reviewStore.get(review_id);
      if (!entry) {
        entry = await loadReviewFromDb(review_id) ?? undefined;
      }
      if (!entry) {
        return reply.status(404).send({ error: 'Review not found' });
      }

      try {
        let context = '';
        if (entry.diff) {
          context += `Original diff for branch ${entry.branch || 'unknown'}:\n\n${entry.diff}\n\n`;
        }
        if (entry.result) {
          context += `Previous review result:\n${JSON.stringify(entry.result, null, 2)}\n\n`;
        }
        if (entry.rawOutput) {
          context += `Raw review output:\n${entry.rawOutput}\n\n`;
        }

        const prompt = `${context}User follow-up question: ${message}\n\nRespond helpfully about the code review.`;

        const result = await runCliQuery(prompt, {
          maxTurns: 1,
          timeout: 60_000,
          systemPrompt: 'You are an expert code reviewer discussing a previous review. Be concise and helpful.',
        });

        if (result.isError) {
          throw new Error(result.output || 'CLI execution failed');
        }

        return reply.send({ response: result.output });
      } catch (err) {
        request.log.error({ err }, '[AI Review Chat] Failed');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'AI review chat failed' });
      }
    },
  );
}
