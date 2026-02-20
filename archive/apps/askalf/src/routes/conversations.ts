/**
 * Ask Alf Conversation Routes
 * CRUD + SSE streaming chat
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { askalfQuery, askalfQueryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { streamChat } from '../engine.js';

const WELCOME_MESSAGE = 'Hey! I\'m Ask Alf — your universal AI chat. Pick a provider and model, or just type and I\'ll route your message to the best one automatically.';

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/askalf/conversations — List user's conversations
   */
  app.get(
    '/api/v1/askalf/conversations',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const conversations = await askalfQuery<{
        id: string;
        title: string | null;
        default_provider: string | null;
        default_model: string | null;
        message_count: number;
        updated_at: string;
      }>(
        `SELECT id, title, default_provider, default_model, message_count, updated_at
         FROM askalf_conversations WHERE user_id = $1
         ORDER BY updated_at DESC LIMIT 50`,
        [userId],
      );

      return reply.send({ conversations });
    },
  );

  /**
   * POST /api/v1/askalf/conversations — Create new conversation
   */
  app.post(
    '/api/v1/askalf/conversations',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const id = ulid();

      await askalfQuery(
        `INSERT INTO askalf_conversations (id, user_id) VALUES ($1, $2)`,
        [id, userId],
      );

      // Insert welcome message
      const welcomeId = ulid();
      await askalfQuery(
        `INSERT INTO askalf_messages (id, conversation_id, role, content, provider, model)
         VALUES ($1, $2, 'assistant', $3, NULL, NULL)`,
        [welcomeId, id, WELCOME_MESSAGE],
      );

      await askalfQuery(
        `UPDATE askalf_conversations SET message_count = 1 WHERE id = $1`,
        [id],
      );

      return reply.status(201).send({
        id,
        welcome: WELCOME_MESSAGE,
      });
    },
  );

  /**
   * GET /api/v1/askalf/conversations/:id/messages — Get messages
   */
  app.get(
    '/api/v1/askalf/conversations/:id/messages',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Verify ownership
      const convo = await askalfQueryOne<{ id: string }>(
        `SELECT id FROM askalf_conversations WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );

      if (!convo) {
        return reply.status(404).send({ error: 'Conversation not found' });
      }

      const messages = await askalfQuery<{
        id: string;
        role: string;
        content: string;
        provider: string | null;
        model: string | null;
        tokens_used: number;
        classified: boolean;
        created_at: string;
      }>(
        `SELECT id, role, content, provider, model, tokens_used, classified, created_at
         FROM askalf_messages WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [id],
      );

      return reply.send({ messages });
    },
  );

  /**
   * PUT /api/v1/askalf/conversations/:id — Rename conversation
   */
  app.put(
    '/api/v1/askalf/conversations/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const { title } = request.body as { title: string };

      if (!title || typeof title !== 'string' || !title.trim()) {
        return reply.status(400).send({ error: 'title is required' });
      }

      const convo = await askalfQueryOne<{ id: string }>(
        `SELECT id FROM askalf_conversations WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );

      if (!convo) {
        return reply.status(404).send({ error: 'Conversation not found' });
      }

      await askalfQuery(
        `UPDATE askalf_conversations SET title = $1, updated_at = now() WHERE id = $2`,
        [title.trim(), id],
      );

      return reply.send({ id, title: title.trim() });
    },
  );

  /**
   * DELETE /api/v1/askalf/conversations/:id — Delete conversation
   */
  app.delete(
    '/api/v1/askalf/conversations/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      await askalfQuery(
        `DELETE FROM askalf_conversations WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );

      return reply.send({ deleted: true });
    },
  );

  /**
   * POST /api/v1/askalf/chat — SSE streaming chat
   * Body: { conversationId?: string, message: string, provider?: string, model?: string }
   */
  app.post(
    '/api/v1/askalf/chat',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        conversationId?: string;
        message: string;
        provider?: string;
        model?: string;
      };

      if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
        return reply.status(400).send({ error: 'message is required' });
      }

      let conversationId = body.conversationId;

      // Auto-create conversation if none provided
      if (!conversationId) {
        conversationId = ulid();
        await askalfQuery(
          `INSERT INTO askalf_conversations (id, user_id) VALUES ($1, $2)`,
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

        await streamChat(userId, conversationId, body.message.trim(), body.provider, body.model, reply);
        return;
      }

      // Verify conversation ownership
      const convo = await askalfQueryOne<{ id: string }>(
        `SELECT id FROM askalf_conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, userId],
      );

      if (!convo) {
        return reply.status(404).send({ error: 'Conversation not found' });
      }

      await streamChat(userId, conversationId, body.message.trim(), body.provider, body.model, reply);
    },
  );

  /**
   * GET /api/v1/askalf/providers — List available providers and models
   */
  app.get(
    '/api/v1/askalf/providers',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { getProviderModels } = await import('../providers/registry.js');
      return reply.send({ providers: getProviderModels() });
    },
  );
}
