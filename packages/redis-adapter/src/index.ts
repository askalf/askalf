/**
 * @askalf/redis-adapter
 *
 * Dual-mode Redis adapter for AskAlf.
 * - ioredis mode: connects to a real Redis server (Docker/production)
 * - memory mode: in-process Map/EventEmitter (standalone/desktop)
 *
 * Usage:
 *   const redis = createRedisAdapter({ mode: 'memory' });
 *   await redis.set('key', 'value');
 *   await redis.publish('channel', 'message');
 */

export type { IRedisAdapter, RedisMessageHandler, RedisPatternHandler } from './interface.js';
export { IoRedisAdapter } from './ioredis-adapter.js';
export { MemoryRedisAdapter } from './memory-adapter.js';
export { InMemoryQueue, InMemoryWorker } from './memory-queue.js';
export type { Job, JobData, JobOpts } from './memory-queue.js';

import { IoRedisAdapter } from './ioredis-adapter.js';
import { MemoryRedisAdapter } from './memory-adapter.js';
import type { IRedisAdapter } from './interface.js';

export type RedisAdapterConfig =
  | { mode: 'ioredis'; url: string }
  | { mode: 'memory' };

/**
 * Create a Redis adapter based on the runtime mode.
 * In standalone mode, everything runs in-memory — no Redis server needed.
 */
export function createRedisAdapter(config: RedisAdapterConfig): IRedisAdapter {
  if (config.mode === 'memory') {
    return new MemoryRedisAdapter();
  }
  return new IoRedisAdapter(config.url);
}

/**
 * Auto-detect mode from environment.
 * ASKALF_MODE=standalone → memory
 * Everything else → ioredis (requires REDIS_URL)
 */
export function createRedisAdapterFromEnv(): IRedisAdapter {
  const mode = process.env['ASKALF_MODE'];

  if (mode === 'standalone') {
    return createRedisAdapter({ mode: 'memory' });
  }

  const url = process.env['REDIS_URL'] || 'redis://localhost:6379';
  return createRedisAdapter({ mode: 'ioredis', url });
}
