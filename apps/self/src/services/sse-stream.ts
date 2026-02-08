/**
 * SSE Activity Stream
 * Real-time server-sent events for the SELF activity feed.
 * Uses Redis pub/sub to broadcast activities to connected clients.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';

// ============================================
// Types
// ============================================

interface SSEClient {
  selfId: string;
  reply: FastifyReply;
  lastEventId: string | null;
}

// ============================================
// State
// ============================================

const clients = new Map<string, Set<SSEClient>>();
let subscriber: Redis | null = null;
let publisher: Redis | null = null;

// ============================================
// Initialization
// ============================================

/**
 * Initialize Redis pub/sub for SSE broadcasting
 */
export function initializeSSE(redisUrl: string): void {
  subscriber = new Redis(redisUrl);
  publisher = new Redis(redisUrl);

  subscriber.subscribe('self:activity', (err) => {
    if (err) {
      console.error('[SSE] Failed to subscribe to activity channel:', err);
    }
  });

  subscriber.on('message', (_channel, message) => {
    try {
      const data = JSON.parse(message) as { selfId: string; activity: unknown };
      broadcastToClients(data.selfId, data.activity);
    } catch {
      // Ignore malformed messages
    }
  });
}

/**
 * Publish an activity event to all connected SSE clients for a SELF instance
 */
export function publishActivity(selfId: string, activity: unknown): void {
  if (publisher) {
    void publisher.publish('self:activity', JSON.stringify({ selfId, activity }))
      .catch(() => {});
  }

  // Also broadcast directly to local clients (same process)
  broadcastToClients(selfId, activity);
}

function broadcastToClients(selfId: string, activity: unknown): void {
  const selfClients = clients.get(selfId);
  if (!selfClients || selfClients.size === 0) return;

  const eventData = `data: ${JSON.stringify(activity)}\n\n`;
  const deadClients: SSEClient[] = [];

  for (const client of selfClients) {
    try {
      client.reply.raw.write(eventData);
    } catch {
      deadClients.push(client);
    }
  }

  // Clean up dead clients
  for (const dead of deadClients) {
    selfClients.delete(dead);
  }
  if (selfClients.size === 0) {
    clients.delete(selfId);
  }
}

// ============================================
// Client Management
// ============================================

/**
 * Handle SSE connection for activity stream
 */
export function handleSSEConnection(
  selfId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial comment to establish connection
  reply.raw.write(':ok\n\n');

  const lastEventId = request.headers['last-event-id'] as string | undefined;

  const client: SSEClient = {
    selfId,
    reply,
    lastEventId: lastEventId ?? null,
  };

  // Register client
  if (!clients.has(selfId)) {
    clients.set(selfId, new Set());
  }
  clients.get(selfId)!.add(client);

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      reply.raw.write(':heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      removeClient(selfId, client);
    }
  }, 30000);

  // Clean up on disconnect
  request.raw.on('close', () => {
    clearInterval(heartbeat);
    removeClient(selfId, client);
  });
}

function removeClient(selfId: string, client: SSEClient): void {
  const selfClients = clients.get(selfId);
  if (selfClients) {
    selfClients.delete(client);
    if (selfClients.size === 0) {
      clients.delete(selfId);
    }
  }
}

/**
 * Get count of connected SSE clients
 */
export function getConnectedClientCount(): number {
  let count = 0;
  for (const selfClients of clients.values()) {
    count += selfClients.size;
  }
  return count;
}

/**
 * Clean up all connections
 */
export async function closeSSE(): Promise<void> {
  clients.clear();
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
  if (publisher) {
    await publisher.quit();
    publisher = null;
  }
}
