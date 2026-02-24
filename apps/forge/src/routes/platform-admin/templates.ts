/**
 * Platform Admin — Template Management
 * CRUD operations for the curated template catalog
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from './utils.js';
import { query, queryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  icon: string | null;
  agent_config: Record<string, unknown>;
  schedule_config: Record<string, unknown> | null;
  estimated_cost_per_run: string | null;
  required_tools: string[];
  is_active: boolean;
  usage_count: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function registerTemplateAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/admin/templates - Create a new template
   */
  app.post(
    '/api/v1/admin/templates',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as {
        name: string;
        category: string;
        description: string;
        icon?: string;
        agentConfig: Record<string, unknown>;
        scheduleConfig?: Record<string, unknown>;
        estimatedCostPerRun?: number;
        requiredTools?: string[];
        sortOrder?: number;
      };

      if (!body.name || !body.category || !body.description || !body.agentConfig) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'name, category, description, and agentConfig are required',
        });
      }

      const id = ulid();
      const slug = slugify(body.name);

      // Check for slug collision
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM forge_agent_templates WHERE slug = $1`,
        [slug],
      );
      const finalSlug = existing ? `${slug}-${id.slice(-6).toLowerCase()}` : slug;

      const template = await queryOne<TemplateRow>(
        `INSERT INTO forge_agent_templates (
          id, name, slug, category, description, icon, agent_config,
          schedule_config, estimated_cost_per_run, required_tools, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          id, body.name, finalSlug, body.category, body.description,
          body.icon ?? null,
          JSON.stringify(body.agentConfig),
          body.scheduleConfig ? JSON.stringify(body.scheduleConfig) : null,
          body.estimatedCostPerRun ?? null,
          body.requiredTools ?? [],
          body.sortOrder ?? 0,
        ],
      );

      return reply.status(201).send(template);
    },
  );

  /**
   * PUT /api/v1/admin/templates/:id - Update a template
   */
  app.put(
    '/api/v1/admin/templates/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<{
        name: string;
        category: string;
        description: string;
        icon: string;
        agentConfig: Record<string, unknown>;
        scheduleConfig: Record<string, unknown>;
        estimatedCostPerRun: number;
        requiredTools: string[];
        isActive: boolean;
        sortOrder: number;
      }>;

      const existing = await queryOne<TemplateRow>(
        `SELECT * FROM forge_agent_templates WHERE id = $1`,
        [id],
      );

      if (!existing) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Template not found',
        });
      }

      const template = await queryOne<TemplateRow>(
        `UPDATE forge_agent_templates SET
          name = COALESCE($2, name),
          category = COALESCE($3, category),
          description = COALESCE($4, description),
          icon = COALESCE($5, icon),
          agent_config = COALESCE($6, agent_config),
          schedule_config = COALESCE($7, schedule_config),
          estimated_cost_per_run = COALESCE($8, estimated_cost_per_run),
          required_tools = COALESCE($9, required_tools),
          is_active = COALESCE($10, is_active),
          sort_order = COALESCE($11, sort_order),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
        [
          id,
          body.name ?? null,
          body.category ?? null,
          body.description ?? null,
          body.icon ?? null,
          body.agentConfig ? JSON.stringify(body.agentConfig) : null,
          body.scheduleConfig ? JSON.stringify(body.scheduleConfig) : null,
          body.estimatedCostPerRun ?? null,
          body.requiredTools ?? null,
          body.isActive ?? null,
          body.sortOrder ?? null,
        ],
      );

      return template;
    },
  );

  /**
   * DELETE /api/v1/admin/templates/:id - Deactivate a template (soft delete)
   */
  app.delete(
    '/api/v1/admin/templates/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const result = await query<TemplateRow>(
        `UPDATE forge_agent_templates SET is_active = false, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id],
      );

      if (result.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Template not found',
        });
      }

      return { message: 'Template deactivated', template: result[0] };
    },
  );
}
