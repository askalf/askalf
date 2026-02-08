/**
 * Forge In-Memory Rate Limiter
 * Per-IP or per-userId sliding window rate limiting
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

interface RateLimitEntry {
  timestamps: number[];
  lastCleanup: number;
}

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

/**
 * Creates an in-memory rate limiter that returns a Fastify onRequest hook.
 * Tracks requests per IP or per authenticated userId.
 * Returns 429 when the limit is exceeded.
 */
export function createRateLimiter(opts: RateLimiterOptions): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void> {
  const store = new Map<string, RateLimitEntry>();
  const { windowMs, maxRequests } = opts;

  // Periodic cleanup of expired entries every 60 seconds
  const cleanupIntervalMs = 60_000;
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      // Remove timestamps older than the window
      entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, cleanupIntervalMs);

  // Ensure the timer does not prevent process exit
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Use userId if authenticated, otherwise fall back to IP
    const identifier =
      (request as FastifyRequest & { userId?: string }).userId ??
      request.ip ??
      'unknown';

    const now = Date.now();

    let entry = store.get(identifier);
    if (!entry) {
      entry = { timestamps: [], lastCleanup: now };
      store.set(identifier, entry);
    }

    // Clean this entry's old timestamps
    if (now - entry.lastCleanup > cleanupIntervalMs) {
      entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
      entry.lastCleanup = now;
    }

    // Count requests in the current window
    const windowStart = now - windowMs;
    const recentTimestamps = entry.timestamps.filter((ts) => ts > windowStart);

    if (recentTimestamps.length >= maxRequests) {
      const oldestInWindow = recentTimestamps[0];
      const retryAfterMs = oldestInWindow
        ? windowMs - (now - oldestInWindow)
        : windowMs;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      reply
        .status(429)
        .header('Retry-After', String(retryAfterSeconds))
        .header('X-RateLimit-Limit', String(maxRequests))
        .header('X-RateLimit-Remaining', '0')
        .header('X-RateLimit-Reset', String(Math.ceil((now + retryAfterMs) / 1000)))
        .send({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
          retryAfter: retryAfterSeconds,
        });
      return;
    }

    // Record this request
    entry.timestamps = [...recentTimestamps, now];

    // Set rate limit headers
    const remaining = maxRequests - entry.timestamps.length;
    reply.header('X-RateLimit-Limit', String(maxRequests));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header(
      'X-RateLimit-Reset',
      String(Math.ceil((now + windowMs) / 1000)),
    );
  };
}
