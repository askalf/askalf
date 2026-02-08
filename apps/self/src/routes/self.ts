/**
 * SELF Entity Routes
 * Activate, pause, resume, get status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne, transaction } from '../database.js';
import { requireSelf } from '../middleware/self-auth.js';
import { createSelfAgent, createForgeSession, executeChatTurn } from '../services/self-engine.js';
import { logActivity } from '../services/activity-logger.js';
import { recordHeartbeat } from '../services/heartbeat.js';
import {
  DEFAULT_DAILY_BUDGET_USD,
  DEFAULT_MONTHLY_BUDGET_USD,
  AUTONOMY_LEVELS,
  SELF_DEFAULT_NAME,
} from '@substrate/self-core';
import type { SelfConfig } from '../config.js';

// ============================================
// Row types
// ============================================

interface SelfInstanceRow {
  id: string;
  user_id: string;
  tenant_id: string;
  name: string;
  persona: Record<string, unknown>;
  autonomy_level: number;
  daily_budget_usd: string;
  monthly_budget_usd: string;
  daily_spent_usd: string;
  monthly_spent_usd: string;
  status: string;
  last_heartbeat: string | null;
  heartbeat_interval_ms: number;
  forge_agent_id: string | null;
  actions_taken: number;
  approvals_requested: number;
  conversations: number;
  total_cost_usd: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// Route Registration
// ============================================

export async function selfRoutes(app: FastifyInstance, config: SelfConfig): Promise<void> {
  // ---- GET /api/v1/self ----
  // Get current SELF instance
  app.get('/api/v1/self', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const self = await queryOne<SelfInstanceRow>(
      `SELECT * FROM self_instances WHERE id = $1`,
      [request.selfId],
    );

    if (!self) {
      return reply.status(404).send({ error: 'SELF not found' });
    }

    return reply.send({ self: formatSelf(self) });
  });

  // ---- POST /api/v1/self/activate ----
  // First-run activation: creates SELF instance + forge agent + first conversation
  app.post('/api/v1/self/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId;
    // For SELF-independent users, tenantId may not exist yet — use userId as tenant
    const tenantId = request.tenantId || userId;

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Check if already activated
    if (request.selfId) {
      const existing = await queryOne<SelfInstanceRow>(
        `SELECT * FROM self_instances WHERE id = $1`,
        [request.selfId],
      );
      if (existing) {
        return reply.status(409).send({
          error: 'Already Activated',
          message: 'SELF is already activated for this user',
          self: formatSelf(existing),
        });
      }
    }

    const body = request.body as { name?: string; autonomy_level?: number } | undefined;
    const selfName = body?.name ?? SELF_DEFAULT_NAME;
    const autonomyLevel = body?.autonomy_level ?? AUTONOMY_LEVELS.BALANCED;

    // Validate autonomy level
    if (autonomyLevel < 1 || autonomyLevel > 5) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'autonomy_level must be between 1 and 5',
      });
    }

    const selfId = ulid();

    // Create forge agent
    const forgeAgentId = await createSelfAgent({
      ownerId: userId,
      selfName,
    });

    // Create forge session for the first conversation
    const forgeSessionId = await createForgeSession(forgeAgentId, userId);

    // Create SELF instance
    await query(
      `INSERT INTO self_instances
       (id, user_id, tenant_id, name, autonomy_level, daily_budget_usd, monthly_budget_usd,
        status, forge_agent_id, heartbeat_interval_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, 300000)`,
      [
        selfId, userId, tenantId, selfName, autonomyLevel,
        DEFAULT_DAILY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD, forgeAgentId,
      ],
    );

    // Create first conversation
    const conversationId = ulid();
    await query(
      `INSERT INTO self_conversations (id, self_id, user_id, title, forge_session_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, selfId, userId, 'Welcome', forgeSessionId],
    );

    // Increment conversation count
    await query(
      `UPDATE self_instances SET conversations = 1, updated_at = NOW() WHERE id = $1`,
      [selfId],
    );

    // Generate welcome message
    const userDisplayName = request.userDisplayName;
    const welcomeInput = userDisplayName
      ? `The user just activated you. Their display name is "${userDisplayName}". Greet them warmly and introduce yourself. Ask what they'd like you to call them and what you can help with first.`
      : `The user just activated you. Greet them warmly and introduce yourself. Ask what they'd like you to call them and what you can help with first.`;

    const result = await executeChatTurn({
      agentId: forgeAgentId,
      sessionId: forgeSessionId,
      ownerId: userId,
      input: welcomeInput,
      config,
    });

    // Save the welcome message as a "self" message (not a user message)
    const welcomeMessageId = ulid();
    await query(
      `INSERT INTO self_messages (id, conversation_id, role, content, tokens_used, cost_usd)
       VALUES ($1, $2, 'self', $3, $4, $5)`,
      [welcomeMessageId, conversationId, result.output, result.inputTokens + result.outputTokens, result.cost],
    );

    // Update budget tracking
    await query(
      `UPDATE self_instances
       SET daily_spent_usd = daily_spent_usd + $1,
           monthly_spent_usd = monthly_spent_usd + $1,
           total_cost_usd = total_cost_usd + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [result.cost, selfId],
    );

    // Log activity
    await logActivity({
      selfId,
      userId,
      type: 'system',
      title: 'SELF activated',
      body: `${selfName} is now active and ready to help.`,
      importance: 8,
      executionId: result.executionId,
      costUsd: result.cost,
      tokensUsed: result.inputTokens + result.outputTokens,
    });

    await recordHeartbeat(selfId);

    // Fetch the created instance
    const selfInstance = await queryOne<SelfInstanceRow>(
      `SELECT * FROM self_instances WHERE id = $1`,
      [selfId],
    );

    return reply.status(201).send({
      self: formatSelf(selfInstance!),
      conversation: {
        id: conversationId,
        self_id: selfId,
        title: 'Welcome',
        forge_session_id: forgeSessionId,
      },
      welcome_message: {
        id: welcomeMessageId,
        conversation_id: conversationId,
        role: 'self',
        content: result.output,
        tokens_used: result.inputTokens + result.outputTokens,
        cost_usd: result.cost,
      },
    });
  });

  // ---- POST /api/v1/self/pause ----
  app.post('/api/v1/self/pause', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    await query(
      `UPDATE self_instances SET status = 'paused', updated_at = NOW() WHERE id = $1`,
      [request.selfId],
    );

    await logActivity({
      selfId: request.selfId!,
      userId: request.userId!,
      type: 'system',
      title: 'SELF paused',
      body: 'SELF has been paused by user. Proactive actions are suspended.',
      importance: 6,
    });

    return reply.send({ status: 'paused' });
  });

  // ---- POST /api/v1/self/resume ----
  app.post('/api/v1/self/resume', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    await query(
      `UPDATE self_instances SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [request.selfId],
    );

    await recordHeartbeat(request.selfId!);

    await logActivity({
      selfId: request.selfId!,
      userId: request.userId!,
      type: 'system',
      title: 'SELF resumed',
      body: 'SELF is back online and active.',
      importance: 6,
    });

    return reply.send({ status: 'active' });
  });

  // ---- GET /api/v1/self/status ----
  app.get('/api/v1/self/status', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const self = await queryOne<SelfInstanceRow>(
      `SELECT * FROM self_instances WHERE id = $1`,
      [request.selfId],
    );

    if (!self) {
      return reply.status(404).send({ error: 'SELF not found' });
    }

    const pendingApprovals = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM self_approvals
       WHERE self_id = $1 AND status = 'pending'`,
      [request.selfId],
    );

    const activeIntegrations = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM self_integrations
       WHERE self_id = $1 AND status = 'connected'`,
      [request.selfId],
    );

    return reply.send({
      status: self.status,
      budget: {
        daily_limit: parseFloat(self.daily_budget_usd),
        daily_spent: parseFloat(self.daily_spent_usd),
        daily_remaining: parseFloat(self.daily_budget_usd) - parseFloat(self.daily_spent_usd),
        monthly_limit: parseFloat(self.monthly_budget_usd),
        monthly_spent: parseFloat(self.monthly_spent_usd),
        monthly_remaining: parseFloat(self.monthly_budget_usd) - parseFloat(self.monthly_spent_usd),
      },
      stats: {
        actions_taken: self.actions_taken,
        approvals_requested: self.approvals_requested,
        conversations: self.conversations,
        total_cost_usd: parseFloat(self.total_cost_usd),
      },
      pending_approvals: parseInt(pendingApprovals?.count ?? '0', 10),
      active_integrations: parseInt(activeIntegrations?.count ?? '0', 10),
      last_heartbeat: self.last_heartbeat,
    });
  });
}

// ============================================
// Helpers
// ============================================

function formatSelf(row: SelfInstanceRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    name: row.name,
    persona: row.persona,
    autonomy_level: row.autonomy_level,
    daily_budget_usd: parseFloat(row.daily_budget_usd),
    monthly_budget_usd: parseFloat(row.monthly_budget_usd),
    daily_spent_usd: parseFloat(row.daily_spent_usd),
    monthly_spent_usd: parseFloat(row.monthly_spent_usd),
    status: row.status,
    last_heartbeat: row.last_heartbeat,
    heartbeat_interval_ms: row.heartbeat_interval_ms,
    forge_agent_id: row.forge_agent_id,
    actions_taken: row.actions_taken,
    approvals_requested: row.approvals_requested,
    conversations: row.conversations,
    total_cost_usd: parseFloat(row.total_cost_usd),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
