/**
 * Working Memory - Tier 1
 * Redis-backed short-term memory for active agent sessions.
 * Uses Redis hashes keyed by agent + session for fast read/write.
 * Conversation buffers stored as JSON arrays within the hash.
 */

import type { Redis } from 'ioredis';

const MESSAGES_FIELD = '__messages';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export interface WorkingMemoryMessage {
  role: string;
  content: string;
  timestamp: string;
}

export class WorkingMemory {
  private readonly redis: Redis;
  private readonly defaultTtl: number;

  constructor(redis: Redis, defaultTtl: number = DEFAULT_TTL_SECONDS) {
    this.redis = redis;
    this.defaultTtl = defaultTtl;
  }

  /**
   * Build the Redis hash key for an agent's working memory.
   */
  private key(agentId: string, sessionId: string): string {
    return `forge:wm:${agentId}:${sessionId}`;
  }

  /**
   * Set a value in working memory. Optionally override the TTL.
   */
  async set(
    agentId: string,
    sessionId: string,
    field: string,
    value: string,
    ttl?: number,
  ): Promise<void> {
    const k = this.key(agentId, sessionId);
    await this.redis.hset(k, field, value);
    await this.redis.expire(k, ttl ?? this.defaultTtl);
  }

  /**
   * Get a single field from working memory.
   */
  async get(
    agentId: string,
    sessionId: string,
    field: string,
  ): Promise<string | null> {
    return this.redis.hget(this.key(agentId, sessionId), field);
  }

  /**
   * Get all fields from working memory as a record.
   */
  async getAll(
    agentId: string,
    sessionId: string,
  ): Promise<Record<string, string>> {
    return this.redis.hgetall(this.key(agentId, sessionId));
  }

  /**
   * Delete a single field from working memory.
   */
  async delete(
    agentId: string,
    sessionId: string,
    field: string,
  ): Promise<void> {
    await this.redis.hdel(this.key(agentId, sessionId), field);
  }

  /**
   * Clear all fields (destroy the entire session hash).
   */
  async clear(agentId: string, sessionId: string): Promise<void> {
    await this.redis.del(this.key(agentId, sessionId));
  }

  /**
   * Append a message to the conversation buffer within the hash.
   */
  async addMessage(
    agentId: string,
    sessionId: string,
    role: string,
    content: string,
  ): Promise<void> {
    const k = this.key(agentId, sessionId);
    const raw = await this.redis.hget(k, MESSAGES_FIELD);

    const messages: WorkingMemoryMessage[] = raw ? (JSON.parse(raw) as WorkingMemoryMessage[]) : [];

    messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    await this.redis.hset(k, MESSAGES_FIELD, JSON.stringify(messages));
    await this.redis.expire(k, this.defaultTtl);
  }

  /**
   * Retrieve the full conversation buffer for this session.
   */
  async getMessages(
    agentId: string,
    sessionId: string,
  ): Promise<WorkingMemoryMessage[]> {
    const raw = await this.redis.hget(
      this.key(agentId, sessionId),
      MESSAGES_FIELD,
    );
    if (!raw) return [];
    return JSON.parse(raw) as WorkingMemoryMessage[];
  }
}
