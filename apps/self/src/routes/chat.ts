/**
 * Chat Routes
 * Conversations and messages with SELF
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { requireSelf } from '../middleware/self-auth.js';
import { createForgeSession, executeChatTurn } from '../services/self-engine.js';
import { logActivity } from '../services/activity-logger.js';
import { triggerMemoryGather } from '../services/memory-identity.js';
import { recordHeartbeat } from '../services/heartbeat.js';
import type { SelfConfig } from '../config.js';

// ============================================
// Row types
// ============================================

interface ConversationRow {
  id: string;
  self_id: string;
  user_id: string;
  title: string | null;
  forge_session_id: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  actions_taken: Record<string, unknown>[];
  tokens_used: number;
  cost_usd: string;
  created_at: string;
}

interface SelfInstanceRow {
  id: string;
  forge_agent_id: string;
}

function formatConversation(c: ConversationRow) {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    messageCount: 0,
  };
}

function formatMessage(m: MessageRow) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
    metadata: {
      tokensUsed: m.tokens_used,
      cost: parseFloat(m.cost_usd) || 0,
    },
  };
}

// ============================================
// Route Registration
// ============================================

export async function chatRoutes(app: FastifyInstance, config: SelfConfig): Promise<void> {
  // ---- POST /api/v1/self/chat/conversations ----
  // Start a new conversation
  app.post('/api/v1/self/chat/conversations', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const userId = request.userId!;

    const self = await queryOne<SelfInstanceRow>(
      `SELECT id, forge_agent_id FROM self_instances WHERE id = $1`,
      [selfId],
    );

    if (!self?.forge_agent_id) {
      return reply.status(500).send({ error: 'SELF agent not configured' });
    }

    const forgeSessionId = await createForgeSession(self.forge_agent_id, userId);
    const conversationId = ulid();

    const body = request.body as { title?: string } | undefined;

    await query(
      `INSERT INTO self_conversations (id, self_id, user_id, title, forge_session_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, selfId, userId, body?.title ?? null, forgeSessionId],
    );

    await query(
      `UPDATE self_instances SET conversations = conversations + 1, updated_at = NOW() WHERE id = $1`,
      [selfId],
    );

    return reply.status(201).send({
      conversation: {
        id: conversationId,
        title: body?.title ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
      },
    });
  });

  // ---- GET /api/v1/self/chat/conversations ----
  // List conversations
  app.get('/api/v1/self/chat/conversations', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const qs = request.query as { limit?: string; offset?: string };
    const limit = parseInt(qs.limit ?? '20', 10);
    const offset = parseInt(qs.offset ?? '0', 10);

    const [conversations, countResult] = await Promise.all([
      query<ConversationRow>(
        `SELECT id, self_id, user_id, title, forge_session_id, created_at, updated_at
         FROM self_conversations
         WHERE self_id = $1
         ORDER BY updated_at DESC
         LIMIT $2 OFFSET $3`,
        [selfId, limit, offset],
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM self_conversations WHERE self_id = $1`,
        [selfId],
      ),
    ]);

    return reply.send({
      conversations: conversations.map(formatConversation),
      total: parseInt(countResult?.count ?? '0', 10),
    });
  });

  // ---- GET /api/v1/self/chat/conversations/:id ----
  // Get single conversation with messages
  app.get('/api/v1/self/chat/conversations/:id', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const { id: conversationId } = request.params as { id: string };

    const conversation = await queryOne<ConversationRow>(
      `SELECT id, self_id, user_id, title, forge_session_id, created_at, updated_at
       FROM self_conversations
       WHERE id = $1 AND self_id = $2`,
      [conversationId, selfId],
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    const messages = await query<MessageRow>(
      `SELECT id, conversation_id, role, content, actions_taken, tokens_used, cost_usd, created_at
       FROM self_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 100`,
      [conversationId],
    );

    return reply.send({
      conversation: formatConversation(conversation),
      messages: messages.map(formatMessage),
    });
  });

  // ---- POST /api/v1/self/chat/conversations/:id/messages ----
  // Send a message to SELF
  app.post('/api/v1/self/chat/conversations/:id/messages', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const userId = request.userId!;
    const tenantId = request.tenantId || userId;
    const { id: conversationId } = request.params as { id: string };

    const body = request.body as { content?: string } | undefined;
    const content = body?.content;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'content is required and must be a non-empty string',
      });
    }

    // Load conversation
    const conversation = await queryOne<ConversationRow>(
      `SELECT id, self_id, title, forge_session_id FROM self_conversations
       WHERE id = $1 AND self_id = $2`,
      [conversationId, selfId],
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Load SELF instance
    const self = await queryOne<SelfInstanceRow>(
      `SELECT id, forge_agent_id FROM self_instances WHERE id = $1`,
      [selfId],
    );

    if (!self?.forge_agent_id) {
      return reply.status(500).send({ error: 'SELF agent not configured' });
    }

    // Save user message
    const userMessageId = ulid();
    await query(
      `INSERT INTO self_messages (id, conversation_id, role, content)
       VALUES ($1, $2, 'user', $3)`,
      [userMessageId, conversationId, content],
    );

    // Execute through forge engine
    const result = await executeChatTurn({
      agentId: self.forge_agent_id,
      sessionId: conversation.forge_session_id,
      ownerId: userId,
      input: content,
      config,
    });

    // Save SELF response
    const selfMessageId = ulid();
    await query(
      `INSERT INTO self_messages (id, conversation_id, role, content, tokens_used, cost_usd)
       VALUES ($1, $2, 'self', $3, $4, $5)`,
      [selfMessageId, conversationId, result.output, result.inputTokens + result.outputTokens, result.cost],
    );

    // Update conversation timestamp
    await query(
      `UPDATE self_conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId],
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

    // Auto-generate conversation title from first user message if missing
    if (!conversation.title) {
      const titlePreview = content.length > 60 ? content.slice(0, 57) + '...' : content;
      void query(
        `UPDATE self_conversations SET title = $1 WHERE id = $2 AND title IS NULL`,
        [titlePreview, conversationId],
      ).catch(() => {});
    }

    const now = new Date().toISOString();

    // Log activity
    const activityId = await logActivity({
      selfId,
      userId,
      type: 'chat',
      title: `Chat: ${content.length > 50 ? content.slice(0, 47) + '...' : content}`,
      body: result.output.length > 200 ? result.output.slice(0, 197) + '...' : result.output,
      executionId: result.executionId,
      costUsd: result.cost,
      tokensUsed: result.inputTokens + result.outputTokens,
      importance: 3,
    });

    // Trigger memory gathering (async, non-blocking)
    void triggerMemoryGather({
      tenantId,
      userId,
      selfId,
      userMessage: content,
      assistantResponse: result.output,
      sessionId: conversation.forge_session_id,
      executionId: result.executionId,
    }).catch((err) => {
      console.error('[SELF] Memory gather failed:', err);
    });

    // Record heartbeat
    void recordHeartbeat(selfId).catch(() => {});

    return reply.send({
      message: {
        id: userMessageId,
        conversationId,
        role: 'user',
        content,
        createdAt: now,
      },
      reply: {
        id: selfMessageId,
        conversationId,
        role: 'self',
        content: result.output,
        createdAt: now,
        metadata: {
          tokensUsed: result.inputTokens + result.outputTokens,
          cost: result.cost,
        },
      },
      activity_id: activityId,
    });
  });

  // ---- DELETE /api/v1/self/chat/conversations/:id ----
  app.delete('/api/v1/self/chat/conversations/:id', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const { id: conversationId } = request.params as { id: string };

    const conversation = await queryOne<{ id: string }>(
      `SELECT id FROM self_conversations WHERE id = $1 AND self_id = $2`,
      [conversationId, selfId],
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    await query(`DELETE FROM self_messages WHERE conversation_id = $1`, [conversationId]);
    await query(`DELETE FROM self_conversations WHERE id = $1`, [conversationId]);
    await query(
      `UPDATE self_instances SET conversations = GREATEST(conversations - 1, 0), updated_at = NOW() WHERE id = $1`,
      [selfId],
    );

    return reply.send({ ok: true });
  });
}
