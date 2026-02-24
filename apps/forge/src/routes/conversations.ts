/**
 * Forge Conversation Routes
 * Layer 1: Chat conversation management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface ConversationRow {
  id: string;
  owner_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  execution_id: string | null;
  intent: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface ConversationCountRow {
  total: string;
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/conversations - Create a new conversation
   */
  app.post(
    '/api/v1/forge/conversations',
    {
      schema: {
        tags: ['Conversations'],
        summary: 'Create a new conversation',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = (request.body ?? {}) as { title?: string };
      const id = ulid();

      const conversation = await queryOne<ConversationRow>(
        `INSERT INTO forge_conversations (id, owner_id, title)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [id, userId, body.title ?? null],
      );

      return reply.status(201).send(conversation);
    },
  );

  /**
   * GET /api/v1/forge/conversations - List user's conversations
   */
  app.get(
    '/api/v1/forge/conversations',
    {
      schema: {
        tags: ['Conversations'],
        summary: 'List conversations',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as { status?: string; limit?: string; offset?: string };
      const status = qs.status ?? 'active';
      const limit = Math.min(parseInt(qs.limit ?? '50', 10), 100);
      const offset = parseInt(qs.offset ?? '0', 10);

      const conversations = await query<ConversationRow>(
        `SELECT * FROM forge_conversations
         WHERE owner_id = $1 AND status = $2
         ORDER BY updated_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, status, limit, offset],
      );

      const countResult = await query<ConversationCountRow>(
        `SELECT COUNT(*) AS total FROM forge_conversations
         WHERE owner_id = $1 AND status = $2`,
        [userId, status],
      );

      return {
        conversations,
        total: parseInt(countResult[0]?.total ?? '0', 10),
      };
    },
  );

  /**
   * GET /api/v1/forge/conversations/:id - Get conversation with messages
   */
  app.get(
    '/api/v1/forge/conversations/:id',
    {
      schema: {
        tags: ['Conversations'],
        summary: 'Get conversation with messages',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const conversation = await queryOne<ConversationRow>(
        `SELECT * FROM forge_conversations WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!conversation) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Conversation not found',
        });
      }

      const messages = await query<MessageRow>(
        `SELECT * FROM forge_conversation_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [id],
      );

      return { conversation, messages };
    },
  );

  /**
   * POST /api/v1/forge/conversations/:id/messages - Send a message
   */
  app.post(
    '/api/v1/forge/conversations/:id/messages',
    {
      schema: {
        tags: ['Conversations'],
        summary: 'Send a message in a conversation',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        content?: string;
        role?: string;
        executionId?: string;
        intent?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      };

      if (!body.content || body.content.trim().length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Message content is required',
        });
      }

      // Verify conversation exists and belongs to user
      const conversation = await queryOne<ConversationRow>(
        `SELECT * FROM forge_conversations WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!conversation) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Conversation not found',
        });
      }

      const messageId = ulid();
      const message = await queryOne<MessageRow>(
        `INSERT INTO forge_conversation_messages (id, conversation_id, role, content, execution_id, intent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          messageId,
          id,
          body.role ?? 'user',
          body.content.trim(),
          body.executionId ?? null,
          body.intent ? JSON.stringify(body.intent) : null,
          JSON.stringify(body.metadata ?? {}),
        ],
      );

      // Update conversation title if first user message and no title
      if (!conversation.title && (body.role ?? 'user') === 'user') {
        const title = body.content.trim().slice(0, 100);
        void query(
          `UPDATE forge_conversations SET title = $1, updated_at = NOW() WHERE id = $2`,
          [title, id],
        ).catch(() => {});
      } else {
        void query(
          `UPDATE forge_conversations SET updated_at = NOW() WHERE id = $1`,
          [id],
        ).catch(() => {});
      }

      return reply.status(201).send(message);
    },
  );

  /**
   * PATCH /api/v1/forge/conversations/:id - Rename a conversation
   */
  app.patch(
    '/api/v1/forge/conversations/:id',
    {
      schema: {
        tags: ['Conversations'],
        summary: 'Rename a conversation',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { title?: string };

      if (!body.title || body.title.trim().length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Title is required',
        });
      }

      const result = await query<ConversationRow>(
        `UPDATE forge_conversations SET title = $1, updated_at = NOW()
         WHERE id = $2 AND owner_id = $3
         RETURNING *`,
        [body.title.trim(), id, userId],
      );

      if (result.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Conversation not found',
        });
      }

      return result[0];
    },
  );

  /**
   * DELETE /api/v1/forge/conversations/:id - Archive a conversation
   */
  app.delete(
    '/api/v1/forge/conversations/:id',
    {
      schema: {
        tags: ['Conversations'],
        summary: 'Archive a conversation',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const result = await query<ConversationRow>(
        `UPDATE forge_conversations SET status = 'archived', updated_at = NOW()
         WHERE id = $1 AND owner_id = $2
         RETURNING *`,
        [id, userId],
      );

      if (result.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Conversation not found',
        });
      }

      return { message: 'Conversation archived', conversation: result[0] };
    },
  );
}
