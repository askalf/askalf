/**
 * Notification Routes
 * WebSocket endpoint for real-time push notifications
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireSelf } from '../middleware/self-auth.js';
import { registerWSClient, getWSClientCount } from '../services/notifications.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /api/v1/self/notifications/ws ----
  // WebSocket connection for push notifications
  // Note: Requires @fastify/websocket plugin. For now, provide SSE fallback.
  app.get('/api/v1/self/notifications/stream', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;

    // SSE-based notification stream
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(':connected\n\n');

    // Register this connection for push notifications
    const cleanup = registerWSClient(userId, (data: string) => {
      try {
        reply.raw.write(`data: ${data}\n\n`);
      } catch {
        cleanup();
      }
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(':heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        cleanup();
      }
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      cleanup();
    });
  });

  // ---- GET /api/v1/self/notifications/status ----
  app.get('/api/v1/self/notifications/status', {
    preHandler: [requireSelf],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      connected_clients: getWSClientCount(),
    });
  });
}
