/**
 * Redis Adapter Interface
 *
 * Covers all Redis operations used across the AskAlf codebase:
 * - Key/value (get, set, setex, del)
 * - Hashes (hset, hget, hgetall, hdel)
 * - Pub/Sub (publish, subscribe, psubscribe)
 * - Sorted sets (zadd, zcard, zrange, zremrangebyscore)
 * - TTL (expire, pexpire)
 * - Eval (Lua scripts for rate limiting)
 */

export type RedisMessageHandler = (channel: string, message: string) => void;
export type RedisPatternHandler = (pattern: string, channel: string, message: string) => void;

export interface IRedisAdapter {
  // Key/Value
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  exists(...keys: string[]): Promise<number>;

  // Hashes
  hset(key: string, field: string, value: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;

  // TTL
  expire(key: string, seconds: number): Promise<void>;
  pexpire(key: string, ms: number): Promise<void>;

  // Lists
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;

  // Sorted Sets
  zadd(key: string, score: number, member: string): Promise<void>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number, ...args: string[]): Promise<string[]>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;

  // Pub/Sub
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(...channels: string[]): Promise<void>;
  psubscribe(pattern: string): Promise<void>;
  on(event: 'message', handler: RedisMessageHandler): void;
  on(event: 'pmessage', handler: RedisPatternHandler): void;
  on(event: string, handler: (...args: any[]) => void): void;

  // Scripting
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;

  // Lifecycle
  duplicate(): IRedisAdapter;
  quit(): Promise<void>;

  readonly mode: 'ioredis' | 'memory';
}
