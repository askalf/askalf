/**
 * Team Collaboration Routes
 * Invite members to workspaces, manage roles, share agents across team
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface InviteRecord {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  invited_by: string;
  status: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/forge/team/members — List workspace members
   */
  app.get('/api/v1/forge/team/members', { preHandler: [authMiddleware] }, async (request: FastifyRequest) => {
    const tenantId = request.tenantId || 'selfhosted';
    const members = await query<Record<string, unknown>>(
      `SELECT tm.user_id, tm.role, tm.created_at, u.email, u.name, u.display_name
       FROM tenant_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1
       ORDER BY tm.role ASC, tm.created_at ASC`,
      [tenantId],
    );
    return { members };
  });

  /**
   * POST /api/v1/forge/team/invite — Invite a member to the workspace
   */
  app.post('/api/v1/forge/team/invite', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const tenantId = request.tenantId || 'selfhosted';
    const body = request.body as { email: string; role?: string };

    if (!body.email?.trim()) return reply.status(400).send({ error: 'Email is required' });

    // Verify caller is owner or admin
    const callerRole = await queryOne<{ role: string }>(
      `SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    if (!callerRole || !['owner', 'admin'].includes(callerRole.role)) {
      return reply.status(403).send({ error: 'Only owners and admins can invite members' });
    }

    const role = body.role || 'member';
    if (!['admin', 'member', 'viewer'].includes(role)) {
      return reply.status(400).send({ error: 'Invalid role. Use: admin, member, or viewer' });
    }

    // Check if already a member
    const existingUser = await queryOne<{ id: string }>(
      `SELECT u.id FROM users u JOIN tenant_members tm ON tm.user_id = u.id WHERE u.email = $1 AND tm.tenant_id = $2`,
      [body.email, tenantId],
    );
    if (existingUser) return reply.status(400).send({ error: 'User is already a member of this workspace' });

    // Create invite
    const inviteId = ulid();
    const token = ulid() + ulid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await query(
      `INSERT INTO team_invites (id, tenant_id, email, role, invited_by, status, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
      [inviteId, tenantId, body.email.trim(), role, userId, token, expiresAt.toISOString()],
    );

    // Get workspace name for the invite message
    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);

    return reply.status(201).send({
      invite: {
        id: inviteId,
        email: body.email,
        role,
        expires_at: expiresAt.toISOString(),
        invite_url: `/join?token=${token}`,
      },
      workspace: tenant?.name || 'AskAlf',
    });
  });

  /**
   * POST /api/v1/forge/team/join — Accept an invite
   */
  app.post('/api/v1/forge/team/join', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const body = request.body as { token: string };

    if (!body.token) return reply.status(400).send({ error: 'Invite token required' });

    const invite = await queryOne<InviteRecord>(
      `SELECT * FROM team_invites WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
      [body.token],
    );

    if (!invite) return reply.status(404).send({ error: 'Invite not found, expired, or already used' });

    // Add user to workspace
    await query(
      `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [invite.tenant_id, userId, invite.role],
    );

    // Mark invite as accepted
    await query(
      `UPDATE team_invites SET status = 'accepted' WHERE id = $1`,
      [invite.id],
    );

    return { joined: true, tenant_id: invite.tenant_id, role: invite.role };
  });

  /**
   * PUT /api/v1/forge/team/members/:userId/role — Change member role
   */
  app.put('/api/v1/forge/team/members/:userId/role', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const callerId = request.userId!;
    const tenantId = request.tenantId || 'selfhosted';
    const { userId: targetUserId } = request.params as { userId: string };
    const body = request.body as { role: string };

    if (!['admin', 'member', 'viewer'].includes(body.role)) {
      return reply.status(400).send({ error: 'Invalid role' });
    }

    // Only owner can change roles
    const callerRole = await queryOne<{ role: string }>(
      `SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, callerId],
    );
    if (callerRole?.role !== 'owner') return reply.status(403).send({ error: 'Only workspace owner can change roles' });

    await query(
      `UPDATE tenant_members SET role = $1 WHERE tenant_id = $2 AND user_id = $3`,
      [body.role, tenantId, targetUserId],
    );

    return { updated: true };
  });

  /**
   * DELETE /api/v1/forge/team/members/:userId — Remove member
   */
  app.delete('/api/v1/forge/team/members/:userId', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const callerId = request.userId!;
    const tenantId = request.tenantId || 'selfhosted';
    const { userId: targetUserId } = request.params as { userId: string };

    if (callerId === targetUserId) return reply.status(400).send({ error: 'Cannot remove yourself' });

    const callerRole = await queryOne<{ role: string }>(
      `SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, callerId],
    );
    if (!callerRole || !['owner', 'admin'].includes(callerRole.role)) {
      return reply.status(403).send({ error: 'Only owners and admins can remove members' });
    }

    await query(
      `DELETE FROM tenant_members WHERE tenant_id = $1 AND user_id = $2 AND role != 'owner'`,
      [tenantId, targetUserId],
    );

    return reply.status(204).send();
  });

  /**
   * GET /api/v1/forge/team/invites — List pending invites
   */
  app.get('/api/v1/forge/team/invites', { preHandler: [authMiddleware] }, async (request: FastifyRequest) => {
    const tenantId = request.tenantId || 'selfhosted';
    const invites = await query(
      `SELECT id, email, role, status, expires_at, created_at FROM team_invites WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [tenantId],
    );
    return { invites };
  });
}
