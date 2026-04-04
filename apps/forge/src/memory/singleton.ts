/**
 * Memory Manager Singleton
 * Lazily initializes a shared MemoryManager instance for all Forge subsystems.
 */

import { Redis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import type { IRedisAdapter } from '@askalf/redis-adapter';
import { query, queryOne } from '../database.js';
import { MemoryManager } from './manager.js';
import { generateEmbedding } from './embeddings.js';

let manager: MemoryManager | null = null;
let redisClient: RedisType | null = null;
let redisAdapterClient: IRedisAdapter | null = null;

/**
 * Initialize the global MemoryManager singleton.
 * Call once during server startup after database is initialized.
 */
export async function initMemoryManager(redisUrl: string): Promise<void>;
export async function initMemoryManager(adapter: IRedisAdapter): Promise<void>;
export async function initMemoryManager(urlOrAdapter: string | IRedisAdapter): Promise<void> {
  if (manager) return;

  if (typeof urlOrAdapter === 'string') {
    redisClient = new Redis(urlOrAdapter, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keyPrefix: 'forge:mem:',
    });
    await redisClient.connect();
    manager = new MemoryManager(query, queryOne, redisClient, generateEmbedding);
  } else {
    redisAdapterClient = urlOrAdapter;
    // MemoryManager expects a Redis-like client. The adapter implements the same interface.
    manager = new MemoryManager(query, queryOne, urlOrAdapter as unknown as RedisType, generateEmbedding);
  }

  console.log('[Memory] MemoryManager singleton initialized');
}

/**
 * Get the global MemoryManager instance.
 * Throws if not yet initialized via initMemoryManager().
 */
export function getMemoryManager(): MemoryManager {
  if (!manager) {
    throw new Error('MemoryManager not initialized — call initMemoryManager() first');
  }
  return manager;
}

/**
 * Get the Redis client used by the memory subsystem.
 */
export function getMemoryRedis(): RedisType | null {
  return redisClient;
}

/**
 * Gracefully close the memory subsystem.
 */
export async function closeMemoryManager(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  manager = null;
}
