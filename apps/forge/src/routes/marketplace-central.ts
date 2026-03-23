/**
 * Central Marketplace API — Community Skill Submissions with Opus AI Review
 *
 * Public endpoints for browsing, submitting, installing, and rating skills.
 * Admin endpoints for reviewing and approving/rejecting submissions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubmissionRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  system_prompt: string;
  tools: string[];
  model: string;
  author_name: string | null;
  author_email: string | null;
  instance_url: string | null;
  status: string;
  ai_review: Record<string, unknown> | null;
  ai_review_score: string | null;
  reviewer_notes: string | null;
  install_count: number;
  rating_sum: number;
  rating_count: number;
  created_at: string;
  reviewed_at: string | null;
  approved_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reject system prompts that contain obvious injection / jailbreak patterns. */
const INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+all\s+prior/i,
  /ignore\s+above/i,
  /bypass/i,
  /jailbreak/i,
  /disregard\s+(your|all|any)\s+(instructions|rules)/i,
  /pretend\s+you\s+are/i,
  /you\s+are\s+now\s+DAN/i,
  /do\s+anything\s+now/i,
  /override\s+(system|safety)/i,
  /act\s+as\s+if\s+you\s+have\s+no\s+restrictions/i,
];

function containsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** Derive a URL-safe slug from a skill name. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function centralMarketplaceRoutes(app: FastifyInstance): Promise<void> {
  // =========================================================================
  // PUBLIC ENDPOINTS (no auth)
  // =========================================================================

  /**
   * POST /api/v1/public/marketplace/submit — Submit a skill for review
   */
  app.post(
    '/api/v1/public/marketplace/submit',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name?: string;
        slug?: string;
        category?: string;
        description?: string;
        system_prompt?: string;
        tools?: string[];
        model?: string;
        author_name?: string;
        author_email?: string;
        instance_url?: string;
      };

      // --- Validation ---
      if (!body.name || !body.name.trim()) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'name is required',
        });
      }

      if (!body.category || !body.category.trim()) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'category is required',
        });
      }

      if (!body.system_prompt || !body.system_prompt.trim()) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'system_prompt is required',
        });
      }

      if (!body.instance_url || !body.instance_url.trim()) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'instance_url is required',
        });
      }

      // --- Security: reject injection attempts ---
      if (containsInjection(body.system_prompt)) {
        return reply.status(422).send({
          error: 'Security Rejection',
          message: 'system_prompt contains disallowed patterns that resemble prompt injection',
        });
      }

      const id = ulid();
      const slug = body.slug?.trim() || toSlug(body.name);

      // Check slug uniqueness
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM marketplace_submissions WHERE slug = $1`,
        [slug],
      );
      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `A submission with slug '${slug}' already exists`,
        });
      }

      await queryOne<SubmissionRow>(
        `INSERT INTO marketplace_submissions
           (id, name, slug, category, description, system_prompt, tools, model,
            author_name, author_email, instance_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review')
         RETURNING *`,
        [
          id,
          body.name.trim(),
          slug,
          body.category.trim(),
          body.description?.trim() ?? null,
          body.system_prompt.trim(),
          body.tools ?? [],
          body.model ?? 'claude-sonnet-4-6',
          body.author_name?.trim() ?? null,
          body.author_email?.trim() ?? null,
          body.instance_url.trim(),
        ],
      );

      return reply.status(201).send({ id, status: 'pending_review' });
    },
  );

  /**
   * GET /api/v1/public/marketplace/skills — Browse approved skills
   */
  app.get(
    '/api/v1/public/marketplace/skills',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as {
        category?: string;
        search?: string;
        sort?: string;
        limit?: string;
        offset?: string;
      };

      const conditions: string[] = [`status = 'approved'`];
      const params: unknown[] = [];
      let idx = 1;

      if (qs.category) {
        conditions.push(`category = $${idx}`);
        params.push(qs.category);
        idx++;
      }

      if (qs.search) {
        conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
        params.push(`%${qs.search}%`);
        idx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Sort
      const validSorts: Record<string, string> = {
        popular: 'install_count DESC',
        rating: '(CASE WHEN rating_count > 0 THEN rating_sum::float / rating_count ELSE 0 END) DESC',
        recent: 'created_at DESC',
      };
      const orderBy = validSorts[qs.sort ?? ''] ?? 'install_count DESC';

      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

      const [skills, countResult] = await Promise.all([
        query<SubmissionRow>(
          `SELECT id, name, slug, category, description, system_prompt, tools, model,
                  author_name, install_count, rating_sum, rating_count, created_at, approved_at,
                  CASE WHEN rating_count > 0 THEN ROUND(rating_sum::numeric / rating_count, 1) ELSE 0 END AS avg_rating
           FROM marketplace_submissions
           ${whereClause}
           ORDER BY ${orderBy}
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limit, offset],
        ),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM marketplace_submissions ${whereClause}`,
          params,
        ),
      ]);

      const total = parseInt(countResult[0]?.count ?? '0', 10);

      return reply.send({ skills, total, limit, offset });
    },
  );

  /**
   * GET /api/v1/public/marketplace/skills/:id — Get a single approved skill
   */
  app.get(
    '/api/v1/public/marketplace/skills/:id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const skill = await queryOne<SubmissionRow>(
        `SELECT id, name, slug, category, description, system_prompt, tools, model,
                author_name, install_count, rating_sum, rating_count, created_at, approved_at,
                CASE WHEN rating_count > 0 THEN ROUND(rating_sum::numeric / rating_count, 1) ELSE 0 END AS avg_rating
         FROM marketplace_submissions
         WHERE id = $1 AND status = 'approved'`,
        [id],
      );

      if (!skill) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Skill not found',
        });
      }

      return reply.send({ skill });
    },
  );

  /**
   * POST /api/v1/public/marketplace/skills/:id/install — Track install count
   */
  app.post(
    '/api/v1/public/marketplace/skills/:id/install',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const result = await query(
        `UPDATE marketplace_submissions
         SET install_count = install_count + 1
         WHERE id = $1 AND status = 'approved'
         RETURNING id, install_count`,
        [id],
      );

      if (result.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Skill not found',
        });
      }

      return reply.send({ id, install_count: (result[0] as Record<string, unknown>).install_count });
    },
  );

  /**
   * POST /api/v1/public/marketplace/skills/:id/rate — Rate a skill
   */
  app.post(
    '/api/v1/public/marketplace/skills/:id/rate',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { rating?: number; instance_id?: string };

      if (!body.rating || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'rating is required and must be an integer between 1 and 5',
        });
      }

      if (!body.instance_id || !body.instance_id.trim()) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'instance_id is required',
        });
      }

      const skill = await queryOne<SubmissionRow>(
        `SELECT id FROM marketplace_submissions WHERE id = $1 AND status = 'approved'`,
        [id],
      );

      if (!skill) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Skill not found',
        });
      }

      // Accumulate into rating_sum / rating_count
      await query(
        `UPDATE marketplace_submissions
         SET rating_sum = rating_sum + $2,
             rating_count = rating_count + 1
         WHERE id = $1`,
        [id, body.rating],
      );

      const updated = await queryOne<{ rating_sum: number; rating_count: number }>(
        `SELECT rating_sum, rating_count FROM marketplace_submissions WHERE id = $1`,
        [id],
      );

      const avg_rating =
        updated && updated.rating_count > 0
          ? Math.round((updated.rating_sum / updated.rating_count) * 10) / 10
          : 0;

      return reply.send({
        id,
        rating: body.rating,
        avg_rating,
        rating_count: updated?.rating_count ?? 0,
      });
    },
  );

  // =========================================================================
  // ADMIN / AUTHENTICATED ENDPOINTS
  // =========================================================================

  /**
   * GET /api/v1/forge/marketplace/review-queue — List pending submissions
   */
  app.get(
    '/api/v1/forge/marketplace/review-queue',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as { status?: string; limit?: string; offset?: string };
      const status = qs.status ?? 'pending_review';
      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

      const submissions = await query<SubmissionRow>(
        `SELECT * FROM marketplace_submissions
         WHERE status = $1
         ORDER BY created_at ASC
         LIMIT $2 OFFSET $3`,
        [status, limit, offset],
      );

      const countResult = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM marketplace_submissions WHERE status = $1`,
        [status],
      );

      const total = parseInt(countResult?.count ?? '0', 10);

      return reply.send({ submissions, total, limit, offset });
    },
  );

  /**
   * POST /api/v1/forge/marketplace/review/:id/approve — Approve a submission
   */
  app.post(
    '/api/v1/forge/marketplace/review/:id/approve',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { reviewer_notes?: string } | null;

      const submission = await queryOne<SubmissionRow>(
        `SELECT * FROM marketplace_submissions WHERE id = $1`,
        [id],
      );

      if (!submission) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Submission not found',
        });
      }

      if (submission.status === 'approved') {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Submission is already approved',
        });
      }

      const updated = await queryOne<SubmissionRow>(
        `UPDATE marketplace_submissions
         SET status = 'approved',
             reviewer_notes = COALESCE($2, reviewer_notes),
             reviewed_at = NOW(),
             approved_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, body?.reviewer_notes ?? null],
      );

      return reply.send({ submission: updated });
    },
  );

  /**
   * POST /api/v1/forge/marketplace/review/:id/reject — Reject a submission
   */
  app.post(
    '/api/v1/forge/marketplace/review/:id/reject',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { reason?: string; reviewer_notes?: string } | null;

      const submission = await queryOne<SubmissionRow>(
        `SELECT * FROM marketplace_submissions WHERE id = $1`,
        [id],
      );

      if (!submission) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Submission not found',
        });
      }

      if (submission.status === 'rejected') {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Submission is already rejected',
        });
      }

      const notes = body?.reason ?? body?.reviewer_notes ?? null;

      const updated = await queryOne<SubmissionRow>(
        `UPDATE marketplace_submissions
         SET status = 'rejected',
             reviewer_notes = COALESCE($2, reviewer_notes),
             reviewed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, notes],
      );

      return reply.send({ submission: updated });
    },
  );
}
