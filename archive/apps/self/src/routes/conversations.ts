/**
 * Self Conversation Routes
 * CRUD + SSE streaming chat
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { selfQuery, selfQueryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { streamSelfConversation, getWelcomeMessage } from '../self/engine.js';

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/self/conversations — List user's conversations
   */
  app.get(
    '/api/v1/self/conversations',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const conversations = await selfQuery<{
        id: string;
        title: string | null;
        summary: string | null;
        message_count: number;
        updated_at: string;
      }>(
        `SELECT id, title, summary, message_count, updated_at
         FROM self_conversations WHERE user_id = $1
         ORDER BY updated_at DESC LIMIT 50`,
        [userId],
      );

      return reply.send({ conversations });
    },
  );

  /**
   * POST /api/v1/self/conversations — Create new conversation
   */
  app.post(
    '/api/v1/self/conversations',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const id = ulid();

      await selfQuery(
        `INSERT INTO self_conversations (id, user_id) VALUES ($1, $2)`,
        [id, userId],
      );

      // Insert welcome message
      const welcomeId = ulid();
      await selfQuery(
        `INSERT INTO self_messages (id, conversation_id, role, content)
         VALUES ($1, $2, 'assistant', $3)`,
        [welcomeId, id, getWelcomeMessage()],
      );

      await selfQuery(
        `UPDATE self_conversations SET message_count = 1 WHERE id = $1`,
        [id],
      );

      return reply.status(201).send({
        id,
        welcome: getWelcomeMessage(),
      });
    },
  );

  /**
   * GET /api/v1/self/conversations/:id/messages — Get messages
   */
  app.get(
    '/api/v1/self/conversations/:id/messages',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Verify ownership
      const convo = await selfQueryOne<{ id: string }>(
        `SELECT id FROM self_conversations WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );

      if (!convo) {
        return reply.status(404).send({ error: 'Conversation not found' });
      }

      const messages = await selfQuery<{
        id: string;
        role: string;
        content: string;
        tool_calls: unknown[];
        actions: unknown[];
        created_at: string;
      }>(
        `SELECT id, role, content, tool_calls, actions, created_at
         FROM self_messages WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [id],
      );

      return reply.send({ messages });
    },
  );

  /**
   * DELETE /api/v1/self/conversations/:id — Delete conversation
   */
  app.delete(
    '/api/v1/self/conversations/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const result = await selfQuery(
        `DELETE FROM self_conversations WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );

      return reply.send({ deleted: true });
    },
  );

  /**
   * POST /api/v1/self/chat — SSE streaming chat
   * Body: { conversationId?: string, message: string }
   * If conversationId is null, auto-creates a new conversation.
   */
  app.post(
    '/api/v1/self/chat',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as { conversationId?: string; message: string };

      if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
        return reply.status(400).send({ error: 'message is required' });
      }

      let conversationId = body.conversationId;

      // Auto-create conversation if none provided
      if (!conversationId) {
        conversationId = ulid();
        await selfQuery(
          `INSERT INTO self_conversations (id, user_id) VALUES ($1, $2)`,
          [conversationId, userId],
        );

        // Send the new conversation ID before streaming
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        reply.raw.write(`event: conversation\ndata: ${JSON.stringify({ id: conversationId })}\n\n`);

        // Stream response (engine handles the rest of SSE)
        await streamSelfConversation(userId, conversationId, body.message.trim(), reply);
        return;
      }

      // Verify conversation ownership
      const convo = await selfQueryOne<{ id: string }>(
        `SELECT id FROM self_conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, userId],
      );

      if (!convo) {
        return reply.status(404).send({ error: 'Conversation not found' });
      }

      // Stream response
      await streamSelfConversation(userId, conversationId, body.message.trim(), reply);
    },
  );
}
