/**
 * Tenant (Workspace) Routes
 * Create, list, switch, and manage workspaces (Alf Personal / Alf Business)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function tenantRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/forge/tenants — List workspaces for current user
   */
  app.get(
    '/api/v1/forge/tenants',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const userId = request.userId!;
      const tenants = await query<Record<string, unknown>>(
        `SELECT t.*, tm.role
         FROM tenants t
         JOIN tenant_members tm ON tm.tenant_id = t.id
         WHERE tm.user_id = $1 AND t.status = 'active'
         ORDER BY t.created_at ASC`,
        [userId],
      );
      return { tenants };
    },
  );

  /**
   * POST /api/v1/forge/tenants — Create a new workspace
   */
  app.post(
    '/api/v1/forge/tenants',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        name: string;
        type?: string;
        icon?: string;
        use_case?: string;
      };

      if (!body.name?.trim()) {
        return reply.status(400).send({ error: 'Workspace name is required' });
      }

      // Limit to 5 workspaces per user
      const countResult = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM tenant_members WHERE user_id = $1`,
        [userId],
      );
      if (parseInt(countResult?.count || '0') >= 5) {
        return reply.status(400).send({ error: 'Maximum 5 workspaces per user' });
      }

      const id = `ws_${ulid()}`;
      const slug = slugify(body.name);

      // Create tenant
      await query(
        `INSERT INTO tenants (id, user_id, name, slug, type, icon, use_case, tier, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'selfhosted', 'active')`,
        [id, userId, body.name.trim(), slug, body.type || 'user', body.icon || null, body.use_case || null],
      );

      // Add user as owner
      await query(
        `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, userId],
      );

      return reply.status(201).send({
        tenant: { id, name: body.name.trim(), slug, type: body.type || 'user', use_case: body.use_case, icon: body.icon },
      });
    },
  );

  /**
   * PUT /api/v1/forge/tenants/:id — Update workspace
   */
  app.put(
    '/api/v1/forge/tenants/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; icon?: string; use_case?: string; budget_limit_daily?: number; budget_limit_monthly?: number };

      // Verify ownership
      const member = await queryOne<{ role: string }>(
        `SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (!member || !['owner', 'admin'].includes(member.role)) {
        return reply.status(403).send({ error: 'Not authorized to modify this workspace' });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      const add = (col: string, val: unknown) => { sets.push(`${col} = $${idx}`); params.push(val); idx++; };

      if (body.name !== undefined) add('name', body.name);
      if (body.icon !== undefined) add('icon', body.icon);
      if (body.use_case !== undefined) add('use_case', body.use_case);
      if (body.budget_limit_daily !== undefined) add('budget_limit_daily', body.budget_limit_daily);
      if (body.budget_limit_monthly !== undefined) add('budget_limit_monthly', body.budget_limit_monthly);

      if (sets.length === 0) return reply.status(400).send({ error: 'No fields to update' });
      sets.push('updated_at = NOW()');

      const tenant = await queryOne(
        `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        [...params, id],
      );

      return { tenant };
    },
  );

  /**
   * DELETE /api/v1/forge/tenants/:id — Delete workspace (soft)
   */
  app.delete(
    '/api/v1/forge/tenants/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Can't delete the default tenant
      if (id === 'selfhosted') {
        return reply.status(400).send({ error: 'Cannot delete the default workspace' });
      }

      // Verify ownership
      const member = await queryOne<{ role: string }>(
        `SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (member?.role !== 'owner') {
        return reply.status(403).send({ error: 'Only the owner can delete a workspace' });
      }

      await query(`UPDATE tenants SET status = 'archived', updated_at = NOW() WHERE id = $1`, [id]);
      // Archive all agents in this workspace
      await query(`UPDATE forge_agents SET status = 'archived', deleted_at = NOW() WHERE tenant_id = $1`, [id]);

      return reply.status(204).send();
    },
  );

  /**
   * POST /api/v1/forge/tenants/:id/switch — Set active workspace
   * Updates the user's current_tenant preference
   */
  app.post(
    '/api/v1/forge/tenants/:id/switch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Verify membership
      const member = await queryOne<{ role: string }>(
        `SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (!member) {
        return reply.status(403).send({ error: 'Not a member of this workspace' });
      }

      // Update user's active tenant
      await query(
        `UPDATE users SET tenant_id = $1, updated_at = NOW() WHERE id = $2`,
        [id, userId],
      );

      const tenant = await queryOne(
        `SELECT * FROM tenants WHERE id = $1`,
        [id],
      );

      return { switched: true, tenant };
    },
  );
}
