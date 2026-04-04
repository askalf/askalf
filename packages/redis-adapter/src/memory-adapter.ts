/**
 * In-Memory Redis Adapter
 *
 * Full Redis API replacement using native JS data structures.
 * Used in standalone/desktop mode — no Redis server needed.
 *
 * - Key/Value: Map with lazy TTL expiry
 * - Pub/Sub: EventEmitter with glob pattern matching
 * - Hashes: Map<string, Map<string, string>>
 * - Sorted Sets: Map<string, Array<{score, member}>>
 * - Lua eval: Direct JS implementation of rate limiter logic
 */

import { EventEmitter } from 'node:events';
import type { IRedisAdapter, RedisMessageHandler, RedisPatternHandler } from './interface.js';

interface StoredValue {
  value: string;
  expiresAt?: number; // Date.now() + ttl
}

interface SortedSetEntry {
  score: number;
  member: string;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export class MemoryRedisAdapter implements IRedisAdapter {
  readonly mode = 'memory' as const;

  private store = new Map<string, StoredValue>();
  private hashes = new Map<string, Map<string, string>>();
  private sortedSets = new Map<string, SortedSetEntry[]>();
  private emitter = new EventEmitter();
  private subscriptions = new Set<string>();
  private patternSubscriptions = new Set<string>();
  private sweepInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.emitter.setMaxListeners(100);
    // Sweep expired keys every 10 seconds
    this.sweepInterval = setInterval(() => this.sweep(), 10_000);
  }

  private sweep() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private isExpired(entry: StoredValue): boolean {
    return !!entry.expiresAt && entry.expiresAt <= Date.now();
  }

  // ── Key/Value ──

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, { value });
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
      if (this.hashes.delete(key)) count++;
      if (this.sortedSets.delete(key)) count++;
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = globToRegex(pattern);
    const result: string[] = [];
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        const entry = this.store.get(key)!;
        if (!this.isExpired(entry)) result.push(key);
      }
    }
    return result;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      const entry = this.store.get(key);
      if (entry && !this.isExpired(entry)) count++;
      else if (this.hashes.has(key)) count++;
      else if (this.sortedSets.has(key)) count++;
    }
    return count;
  }

  // ── Lists ──

  private lists = new Map<string, string[]>();

  async rpush(key: string, ...values: string[]): Promise<number> {
    let list = this.lists.get(key);
    if (!list) { list = []; this.lists.set(key, list); }
    list.push(...values);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key);
    if (!list) return [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }

  // ── Hashes ──

  async hset(key: string, field: string, value: string): Promise<void> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    hash.set(field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let count = 0;
    for (const field of fields) {
      if (hash.delete(field)) count++;
    }
    if (hash.size === 0) this.hashes.delete(key);
    return count;
  }

  // ── TTL ──

  async expire(key: string, seconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() + seconds * 1000;
  }

  async pexpire(key: string, ms: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() + ms;
  }

  // ── Sorted Sets ──

  async zadd(key: string, score: number, member: string): Promise<void> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = [];
      this.sortedSets.set(key, set);
    }
    // Remove existing entry for this member
    const idx = set.findIndex(e => e.member === member);
    if (idx !== -1) set.splice(idx, 1);
    // Insert sorted by score
    const insertIdx = set.findIndex(e => e.score > score);
    if (insertIdx === -1) set.push({ score, member });
    else set.splice(insertIdx, 0, { score, member });
  }

  async zcard(key: string): Promise<number> {
    return this.sortedSets.get(key)?.length ?? 0;
  }

  async zrange(key: string, start: number, stop: number, ..._args: string[]): Promise<string[]> {
    const set = this.sortedSets.get(key);
    if (!set) return [];
    const end = stop === -1 ? set.length : stop + 1;
    return set.slice(start, end).map(e => e.member);
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    const minN = min === '-inf' ? -Infinity : Number(min);
    const maxN = max === '+inf' ? Infinity : Number(max);
    const before = set.length;
    const filtered = set.filter(e => e.score < minN || e.score > maxN);
    this.sortedSets.set(key, filtered);
    return before - filtered.length;
  }

  // ── Pub/Sub ──

  async publish(channel: string, message: string): Promise<void> {
    // Direct subscriptions
    if (this.subscriptions.has(channel)) {
      this.emitter.emit('message', channel, message);
    }
    // Pattern subscriptions
    for (const pattern of this.patternSubscriptions) {
      if (globToRegex(pattern).test(channel)) {
        this.emitter.emit('pmessage', pattern, channel, message);
      }
    }
  }

  async subscribe(channel: string): Promise<void> {
    this.subscriptions.add(channel);
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    for (const ch of channels) this.subscriptions.delete(ch);
  }

  async psubscribe(pattern: string): Promise<void> {
    this.patternSubscriptions.add(pattern);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.emitter.on(event, handler);
  }

  // ── Scripting ──

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    // Implement the sliding window rate limiter logic that's used in the codebase.
    // The Lua script does: ZADD key now member, ZREMRANGEBYSCORE key -inf (now-window), ZCARD key, EXPIRE key window
    if (script.includes('ZADD') || script.includes('zadd')) {
      const key = String(args[0]);
      const now = Number(args[1]);
      const window = Number(args[2]);
      const member = String(args[3] ?? now);

      await this.zremrangebyscore(key, '-inf', now - window);
      await this.zadd(key, now, member);
      const count = await this.zcard(key);
      await this.expire(key, Math.ceil(window / 1000));
      return count;
    }

    // Fallback — log and return 0
    console.warn('[MemoryRedis] Unhandled eval script, returning 0');
    return 0;
  }

  /** Create a duplicate — in memory mode, they share the same backing store. */
  duplicate(): MemoryRedisAdapter {
    const dup = new MemoryRedisAdapter();
    // Share state for pub/sub to work across duplicates
    dup.store = this.store;
    dup.hashes = this.hashes;
    dup.sortedSets = this.sortedSets;
    dup.emitter = this.emitter;
    dup.subscriptions = this.subscriptions;
    dup.patternSubscriptions = this.patternSubscriptions;
    clearInterval(dup.sweepInterval);
    return dup;
  }

  async quit(): Promise<void> {
    clearInterval(this.sweepInterval);
    this.store.clear();
    this.hashes.clear();
    this.sortedSets.clear();
    this.emitter.removeAllListeners();
  }
}
