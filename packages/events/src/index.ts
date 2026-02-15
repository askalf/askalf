import { Redis } from 'ioredis';
import { SubstrateEvent, ids } from '@substrate/core';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'events' });

export interface EventBusConfig {
  redisUrl: string;
  consumerGroup?: string;
  consumerId?: string;
}

let redis: Redis | null = null;

// Stream names for different event types
export const Streams = {
  TRACES: 'substrate:traces',
  SHARDS: 'substrate:shards',
  EPISODES: 'substrate:episodes',
  FACTS: 'substrate:facts',
  METABOLIC: 'substrate:metabolic',
  ECONOMICS: 'substrate:economics',
  AUDIT: 'substrate:audit',
} as const;

export type StreamName = typeof Streams[keyof typeof Streams];

/**
 * Initialize the event bus
 */
export function initializeEventBus(eventConfig: EventBusConfig): Redis {
  if (redis) {
    return redis;
  }

  redis = new Redis(eventConfig.redisUrl, {
    keepAlive: 30000,
  });

  redis.on('error', (err: Error) => {
    logger.error({ error: err.message }, 'Redis connection error');
  });

  redis.on('connect', () => {
    logger.debug('Connected to Redis for event bus');
  });

  return redis;
}

/**
 * Get the Redis client
 */
export function getEventBus(): Redis {
  if (!redis) {
    throw new Error('Event bus not initialized. Call initializeEventBus first.');
  }
  return redis;
}

/**
 * Publish an event to a stream
 */
export async function publishEvent<T extends SubstrateEvent>(
  stream: StreamName,
  event: Omit<T, 'id' | 'timestamp'>
): Promise<string> {
  const bus = getEventBus();

  const fullEvent: SubstrateEvent = {
    id: ids.event(),
    timestamp: new Date(),
    ...event,
  } as SubstrateEvent;

  // Convert event to flat key-value pairs for Redis XADD
  const args = Object.entries(fullEvent).flatMap(([key, value]) => [
    key,
    typeof value === 'object' ? JSON.stringify(value) : String(value),
  ]);

  const messageId = await bus.xadd(stream, '*', ...args);

  logger.debug({ stream, eventType: event.type, messageId }, 'Event published');

  return messageId ?? '';
}

/**
 * Create a consumer group for a stream
 */
export async function createConsumerGroup(
  stream: StreamName,
  groupName: string
): Promise<void> {
  const bus = getEventBus();

  try {
    await bus.xgroup('CREATE', stream, groupName, '$', 'MKSTREAM');
    logger.info({ stream, groupName }, 'Consumer group created');
  } catch (error) {
    // Group already exists is OK
    if (!(error instanceof Error && error.message.includes('BUSYGROUP'))) {
      throw error;
    }
  }
}

/**
 * Close the event bus connection
 */
export async function closeEventBus(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
