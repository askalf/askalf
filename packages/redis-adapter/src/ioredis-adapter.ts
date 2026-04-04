/**
 * ioredis Adapter — wraps real Redis connection
 * Used in Docker/production mode. This is the existing behavior.
 */

import { Redis } from 'ioredis';
import type { IRedisAdapter, RedisMessageHandler, RedisPatternHandler } from './interface.js';

export class IoRedisAdapter implements IRedisAdapter {
  readonly mode = 'ioredis' as const;
  private client: Redis;

  constructor(url: string, opts?: { lazyConnect?: boolean }) {
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: opts?.lazyConnect,
    });
  }

  // Key/Value
  async get(key: string) { return this.client.get(key); }
  async set(key: string, value: string) { await this.client.set(key, value); }
  async setex(key: string, seconds: number, value: string) { await this.client.setex(key, seconds, value); }
  async del(...keys: string[]) { return this.client.del(...keys); }
  async keys(pattern: string) { return this.client.keys(pattern); }
  async exists(...keys: string[]) { return this.client.exists(...keys); }

  // Lists
  async rpush(key: string, ...values: string[]) { return this.client.rpush(key, ...values); }
  async lrange(key: string, start: number, stop: number) { return this.client.lrange(key, start, stop); }

  // Hashes
  async hset(key: string, field: string, value: string) { await this.client.hset(key, field, value); }
  async hget(key: string, field: string) { return this.client.hget(key, field); }
  async hgetall(key: string) { return this.client.hgetall(key); }
  async hdel(key: string, ...fields: string[]) { return this.client.hdel(key, ...fields); }

  // TTL
  async expire(key: string, seconds: number) { await this.client.expire(key, seconds); }
  async pexpire(key: string, ms: number) { await this.client.pexpire(key, ms); }

  // Sorted Sets
  async zadd(key: string, score: number, member: string) { await this.client.zadd(key, score, member); }
  async zcard(key: string) { return this.client.zcard(key); }
  async zrange(key: string, start: number, stop: number, ...args: string[]) {
    return this.client.zrange(key, start, stop, ...(args as []));
  }
  async zremrangebyscore(key: string, min: number | string, max: number | string) {
    return this.client.zremrangebyscore(key, min, max);
  }

  // Pub/Sub
  async publish(channel: string, message: string) { await this.client.publish(channel, message); }
  async subscribe(channel: string) { await this.client.subscribe(channel); }
  async unsubscribe(...channels: string[]) { await this.client.unsubscribe(...channels); }
  async psubscribe(pattern: string) { await this.client.psubscribe(pattern); }
  on(event: string, handler: (...args: any[]) => void) { this.client.on(event, handler); }

  // Scripting
  async eval(script: string, numKeys: number, ...args: (string | number)[]) {
    return this.client.eval(script, numKeys, ...args);
  }

  /** Create a duplicate connection (needed for pub/sub — Redis requires separate connections). */
  duplicate(): IoRedisAdapter {
    const dup = new IoRedisAdapter('', { lazyConnect: true });
    dup.client = this.client.duplicate();
    return dup;
  }

  async quit() { await this.client.quit(); }
}
