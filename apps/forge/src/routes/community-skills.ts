/**
 * Community Skills Library Routes
 * Browse, submit, rate, and install community-shared skill templates.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

export async function communitySkillsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/community/skills — Browse approved community skills
   */
  app.get('/api/v1/forge/community/skills', { preHandler: [authMiddleware] }, async (request) => {
    const qs = request.query as { category?: string; search?: string; sort?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;
    const sort = qs.sort === 'popular' ? 'downloads DESC' : qs.sort === 'rating' ? '(CASE WHEN rating_count > 0 THEN rating_sum::float / rating_count ELSE 0 END) DESC' : 'created_at DESC';

    const conditions = ["visibility IN ('approved', 'featured')", 'is_active = true'];
    const params: unknown[] = [];
    let idx = 1;

    if (qs.category) {
      conditions.push(`category = $${idx}`);
      params.push(qs.category);
      idx++;
    }
    if (qs.search) {
      conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx} OR $${idx + 1} = ANY(tags))`);
      params.push(`%${qs.search}%`, qs.search.toLowerCase());
      idx += 2;
    }

    params.push(limit, offset);
    const skills = await query(
      `SELECT id, name, slug, category, description, icon, required_tools, agent_config,
              downloads, rating_sum, rating_count, featured, author_name, tags, source, created_at,
              CASE WHEN rating_count > 0 THEN ROUND(rating_sum::numeric / rating_count, 1) ELSE 0 END as avg_rating
       FROM forge_agent_templates
       WHERE ${conditions.join(' AND ')}
       ORDER BY featured DESC, ${sort}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM forge_agent_templates WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2),
    );

    return { skills, total: parseInt(countResult?.count ?? '0', 10), limit, offset };
  });

  /**
   * POST /api/v1/forge/community/skills/submit — Submit a skill to the community library
   */
  app.post('/api/v1/forge/community/skills/submit', { preHandler: [authMiddleware] }, async (request, reply) => {
    const userId = request.userId!;
    const body = request.body as {
      name?: string; description?: string; category?: string;
      agent_config?: Record<string, unknown>; required_tools?: string[];
      tags?: string[]; author_name?: string;
    };

    if (!body.name || !body.description || !body.category) {
      return reply.status(400).send({ error: 'name, description, and category are required' });
    }

    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const id = `community_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await query(
      `INSERT INTO forge_agent_templates
       (id, name, slug, category, description, required_tools, agent_config, tags, author_name,
        submitted_by, visibility, approved, source, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'community', false, 'user', true, 500)`,
      [
        id, body.name, slug, body.category, body.description,
        body.required_tools ?? [], JSON.stringify(body.agent_config ?? {}),
        body.tags ?? [], body.author_name ?? 'Anonymous', userId,
      ],
    );

    return reply.status(201).send({ id, slug, status: 'submitted', message: 'Skill submitted for review' });
  });

  /**
   * POST /api/v1/forge/community/skills/:id/install — Install a community skill to your library
   */
  app.post('/api/v1/forge/community/skills/:id/install', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const skill = await queryOne<{ name: string; slug: string; category: string; description: string; required_tools: string[]; agent_config: string }>(
      `SELECT name, slug, category, description, required_tools, agent_config FROM forge_agent_templates
       WHERE id = $1 AND visibility IN ('approved', 'featured')`,
      [id],
    );

    if (!skill) return reply.status(404).send({ error: 'Skill not found' });

    // Increment download count
    await query(`UPDATE forge_agent_templates SET downloads = downloads + 1 WHERE id = $1`, [id]);

    return { installed: true, skill: { name: skill.name, category: skill.category } };
  });

  /**
   * POST /api/v1/forge/community/skills/:id/rate — Rate a community skill (1-5)
   */
  app.post('/api/v1/forge/community/skills/:id/rate', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { rating?: number };
    const rating = Math.max(1, Math.min(5, Math.round(body.rating ?? 0)));
    if (!rating) return reply.status(400).send({ error: 'rating (1-5) is required' });

    await query(
      `UPDATE forge_agent_templates SET rating_sum = rating_sum + $1, rating_count = rating_count + 1 WHERE id = $2`,
      [rating, id],
    );
    return { ok: true, rating };
  });

  /**
   * POST /api/v1/forge/community/skills/:id/approve — Admin: approve a submitted skill
   */
  app.post('/api/v1/forge/community/skills/:id/approve', { preHandler: [authMiddleware] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { featured?: boolean };

    await query(
      `UPDATE forge_agent_templates SET visibility = $1, approved = true, updated_at = NOW()
       WHERE id = $2`,
      [body.featured ? 'featured' : 'approved', id],
    );
    return { ok: true, visibility: body.featured ? 'featured' : 'approved' };
  });

  /**
   * GET /api/v1/forge/community/skills/pending — Admin: list pending submissions
   */
  app.get('/api/v1/forge/community/skills/pending', { preHandler: [authMiddleware] }, async () => {
    const pending = await query(
      `SELECT id, name, slug, category, description, author_name, tags, submitted_by, created_at
       FROM forge_agent_templates
       WHERE visibility = 'community' AND approved = false
       ORDER BY created_at ASC`,
    );
    return { pending };
  });
}
