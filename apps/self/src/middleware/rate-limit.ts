/**
 * Per-SELF Rate Limiting
 * Prevents individual SELF instances from overwhelming the system.
 * Separate from IP-based rate limiting.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

// ============================================
// Rate Limit Configuration
// ============================================

interface RateLimitBucket {
  count: number;
  resetTime: number;
}

// Per-SELF rate limits
const selfLimits = new Map<string, RateLimitBucket>();
const SELF_RATE_LIMIT = 60;      // 60 requests per minute per SELF
const SELF_RATE_WINDOW = 60000;  // 1 minute

// Per-user chat rate limits (more generous than general)
const chatLimits = new Map<string, RateLimitBucket>();
const CHAT_RATE_LIMIT = 20;       // 20 messages per minute
const CHAT_RATE_WINDOW = 60000;

// Per-user activation rate limit (prevent abuse)
const activationLimits = new Map<string, RateLimitBucket>();
const ACTIVATION_RATE_LIMIT = 3;   // 3 activations per hour
const ACTIVATION_RATE_WINDOW = 3600000;

// Cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of selfLimits) {
    if (now > bucket.resetTime) selfLimits.delete(key);
  }
  for (const [key, bucket] of chatLimits) {
    if (now > bucket.resetTime) chatLimits.delete(key);
  }
  for (const [key, bucket] of activationLimits) {
    if (now > bucket.resetTime) activationLimits.delete(key);
  }
}, 60000);

// ============================================
// Rate Limit Middleware
// ============================================

function checkLimit(
  limits: Map<string, RateLimitBucket>,
  key: string,
  maxRequests: number,
  window: number,
): boolean {
  const now = Date.now();
  const bucket = limits.get(key);

  if (!bucket || now > bucket.resetTime) {
    limits.set(key, { count: 1, resetTime: now + window });
    return true;
  }

  bucket.count++;
  return bucket.count <= maxRequests;
}

/**
 * Rate limit per SELF instance (general API calls)
 */
export async function selfRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const selfId = request.selfId;
  if (!selfId) return;

  if (!checkLimit(selfLimits, selfId, SELF_RATE_LIMIT, SELF_RATE_WINDOW)) {
    reply.status(429).send({
      error: 'Too Many Requests',
      message: 'SELF rate limit exceeded. Please wait before making more requests.',
      retry_after_ms: SELF_RATE_WINDOW,
    });
  }
}

/**
 * Rate limit for chat messages
 */
export async function chatRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.userId;
  if (!userId) return;

  if (!checkLimit(chatLimits, userId, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW)) {
    reply.status(429).send({
      error: 'Too Many Requests',
      message: 'Chat rate limit exceeded. Please wait before sending more messages.',
      retry_after_ms: CHAT_RATE_WINDOW,
    });
  }
}

/**
 * Rate limit for activation (prevent abuse)
 */
export async function activationRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ip = request.ip || 'unknown';

  if (!checkLimit(activationLimits, ip, ACTIVATION_RATE_LIMIT, ACTIVATION_RATE_WINDOW)) {
    reply.status(429).send({
      error: 'Too Many Requests',
      message: 'Too many activation attempts. Please try again later.',
      retry_after_ms: ACTIVATION_RATE_WINDOW,
    });
  }
}
