/**
 * EventBridge — Redis subscriber for forge:events:* channels
 *
 * Listens to Forge's Redis event bus and relays events to
 * the dashboard's WebSocket broadcast system.
 */

import Redis from 'ioredis';

const FORGE_EVENT_CHANNELS = [
  'forge:events:execution',
  'forge:events:agent',
  'forge:events:ticket',
  'forge:events:deploy',
  'forge:events:scheduler',
];

// Events to filter out (noisy, low value)
const FILTERED_EVENT_TYPES = new Set([
  'heartbeat',
  'ping',
  'pong',
  'keepalive',
]);

export class EventBridge {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.subscriber = null;
    this.connected = false;
    this.reconnectTimer = null;
  }

  /** Start listening to Redis event channels */
  async start() {
    const redisUrl = process.env['REDIS_URL'] || 'redis://redis:6379';

    try {
      this.subscriber = new Redis(redisUrl, {
        retryStrategy(times) {
          const delay = Math.min(times * 500, 5000);
          return delay;
        },
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      this.subscriber.on('connect', () => {
        console.log('[EventBridge] Connected to Redis');
        this.connected = true;
      });

      this.subscriber.on('error', (err) => {
        console.error('[EventBridge] Redis error:', err.message);
        this.connected = false;
      });

      this.subscriber.on('close', () => {
        console.log('[EventBridge] Redis connection closed');
        this.connected = false;
      });

      await this.subscriber.connect();

      // Subscribe to forge event channels
      for (const channel of FORGE_EVENT_CHANNELS) {
        await this.subscriber.subscribe(channel);
      }

      // Also subscribe to pattern-based channels
      await this.subscriber.psubscribe('forge:events:*');

      console.log(`[EventBridge] Subscribed to ${FORGE_EVENT_CHANNELS.length} channels + pattern`);

      // Handle incoming messages
      this.subscriber.on('message', (channel, message) => {
        this._handleMessage(channel, message);
      });

      this.subscriber.on('pmessage', (_pattern, channel, message) => {
        this._handleMessage(channel, message);
      });
    } catch (err) {
      console.error('[EventBridge] Failed to connect to Redis:', err.message);
      // Don't crash — dashboard should work without event bridge
    }
  }

  /** Stop the bridge */
  async stop() {
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe();
        await this.subscriber.punsubscribe();
        this.subscriber.disconnect();
      } catch {
        // ignore cleanup errors
      }
      this.subscriber = null;
      this.connected = false;
    }
  }

  /** Check if connected */
  isConnected() {
    return this.connected;
  }

  // ---- Internal ----

  _handleMessage(channel, rawMessage) {
    try {
      const event = JSON.parse(rawMessage);

      // Filter noisy events
      if (FILTERED_EVENT_TYPES.has(event.type)) return;

      // Determine event category from channel name
      const category = channel.replace('forge:events:', '');

      // Broadcast to all connected dashboard WebSocket clients
      this.broadcast('forge_event', {
        category,
        channel,
        ...event,
        receivedAt: Date.now(),
      });
    } catch {
      // Non-JSON message, ignore
    }
  }
}

/** Create and start the event bridge */
export async function createEventBridge(broadcastFn) {
  const bridge = new EventBridge(broadcastFn);
  await bridge.start();
  return bridge;
}
