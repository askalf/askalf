/**
 * Redis Sliding Window Rate Limiter
 *
 * Limits:
 *   - Authenticated (Bearer token present): 60 req/min
 *   - Unauthenticated: 20 req/min
 *
 * Bypasses:
 *   - Internal Docker network IPs (172.x, 10.x, 127.0.0.1)
 *   - API keys whose key_prefix matches a known internal service key
 *
 * Response headers added on every non-bypassed request:
 *   X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 */

import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import type { FastifyRequest, FastifyReply } from 'fastify';

const AUTHED_LIMIT = 60;   // req/min for authenticated users
const UNAUTHED_LIMIT = 20; // req/min for unauthenticated
const WINDOW_MS = 60_000;  // 1 minute sliding window

/**
 * Atomic sliding window Lua script.
 *
 * KEYS[1]  — Redis key for this identity
 * ARGV[1]  — current timestamp (ms)
 * ARGV[2]  — window size (ms)
 * ARGV[3]  — limit (max requests per window)
 * ARGV[4]  — unique member ID for this request
 *
 * Returns: [allowed (1|0), remaining, resetAtMs]
 */
const SLIDING_WINDOW_LUA = `
local key      = KEYS[1]
local now      = tonumber(ARGV[1])
local window   = tonumber(ARGV[2])
local limit    = tonumber(ARGV[3])
local uid      = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = tonumber(redis.call('ZCARD', key))

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = oldest[2] and math.ceil(tonumber(oldest[2]) + window) or math.ceil(now + window)
  return {0, 0, resetAt}
end

redis.call('ZADD', key, now, uid)
redis.call('PEXPIRE', key, window)
return {1, limit - count - 1, math.ceil(now + window)}
`;

// key_prefix values of known internal service API keys (loaded at startup)
const internalKeyPrefixes = new Set<string>();

let rateLimitRedis: Redis | null = null;

/**
 * Call once in start() after Redis is available.
 * keyPrefixes: key_prefix column values from forge_api_keys for internal keys.
 */
export function initRateLimit(redisUrl: string, keyPrefixes: string[] = []): void {
  for (const p of keyPrefixes) internalKeyPrefixes.add(p);

  rateLimitRedis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    lazyConnect: false,
  });

  rateLimitRedis.on('error', (err: Error) => {
    // Non-fatal — rate limiter fails open
    console.warn('[RateLimit] Redis error:', err.message);
  });
}

export async function closeRateLimitRedis(): Promise<void> {
  if (rateLimitRedis) {
    await rateLimitRedis.quit().catch(() => {});
    rateLimitRedis = null;
  }
}

function isInternalIp(ip: string): boolean {
  return (
    ip.startsWith('172.') ||
    ip.startsWith('10.') ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1'
  );
}

function extractBearer(request: FastifyRequest): string | null {
  const auth = request.headers['authorization'];
  if (typeof auth !== 'string') return null;
  const spaceIdx = auth.indexOf(' ');
  if (spaceIdx === -1 || auth.slice(0, spaceIdx) !== 'Bearer') return null;
  const token = auth.slice(spaceIdx + 1);
  return token || null;
}

function isInternalKey(token: string): boolean {
  for (const prefix of internalKeyPrefixes) {
    if (token.startsWith(prefix)) return true;
  }
  return false;
}

export async function rateLimitHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip health/metrics endpoints
  const url = request.url;
  if (url === '/health' || url === '/metrics' || url.startsWith('/docs')) return;

  const ip = request.ip || 'unknown';

  // Bypass: internal Docker network (service-to-service calls)
  if (isInternalIp(ip)) return;

  const token = extractBearer(request);

  // Bypass: internal service API keys identified by key_prefix
  if (token && isInternalKey(token)) return;

  if (!rateLimitRedis) return; // Fail open if not initialized

  // Authenticated = Bearer token present (token validity checked later by authMiddleware)
  const isAuthed = token !== null;
  const limit = isAuthed ? AUTHED_LIMIT : UNAUTHED_LIMIT;

  // Rate limit key: hash of token for authed (avoids storing raw tokens in Redis), IP for unauthed
  const keyId = isAuthed
    ? 'auth:' + createHash('sha256').update(token).digest('hex').slice(0, 24)
    : 'ip:' + ip;
  const redisKey = `rl:${keyId}`;

  const now = Date.now();
  const uid = `${now}:${Math.random().toString(36).slice(2, 9)}`;

  try {
    const result = await rateLimitRedis.eval(
      SLIDING_WINDOW_LUA,
      1,
      redisKey,
      String(now),
      String(WINDOW_MS),
      String(limit),
      uid,
    ) as [number, number, number];

    const [allowed, remaining, resetAtMs] = result;
    const resetSec = Math.ceil(resetAtMs / 1000);

    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, remaining)));
    reply.header('X-RateLimit-Reset', String(resetSec));

    if (!allowed) {
      const retryAfter = Math.max(1, resetSec - Math.floor(now / 1000));
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter,
      });
    }
  } catch (err) {
    // Fail open — rate limit errors must not block legitimate traffic
    request.log.warn({ err }, '[RateLimit] Redis eval failed, allowing request');
  }
}
