// SUBSTRATE v1: Security Middleware
// Rate limiting, input validation, security headers, CSRF, and prompt injection protection

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCsrf from '@fastify/csrf-protection';
import { query, queryOne } from '@substrate/database';
import { getLogger } from '@substrate/observability';
import {
  InjectionScanner,
  AnomalyDetector,
  type ScanResult,
  type ThreatDetection
} from '@substrate/core';

const logger = getLogger();

// ===========================================
// PROMPT INJECTION SCANNER (SINGLETON)
// ===========================================
const injectionScanner = new InjectionScanner({ strictMode: false, maxInputLength: 50000 });
const anomalyDetector = new AnomalyDetector({ maxSamples: 1000 });

// Track blocked attempts for monitoring
const blockedAttempts = new Map<string, { count: number; lastAttempt: Date; threats: string[] }>();
const MAX_BLOCKED_ENTRIES = 10000;

// Cleanup old blocked attempts every 10 minutes and enforce size limit
setInterval(() => {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [key, value] of blockedAttempts.entries()) {
    if (value.lastAttempt < hourAgo) {
      blockedAttempts.delete(key);
    }
  }
  // Enforce size limit - remove oldest entries if over limit
  if (blockedAttempts.size > MAX_BLOCKED_ENTRIES) {
    const entries = [...blockedAttempts.entries()];
    entries.sort((a, b) => a[1].lastAttempt.getTime() - b[1].lastAttempt.getTime());
    const toRemove = entries.slice(0, blockedAttempts.size - MAX_BLOCKED_ENTRIES);
    toRemove.forEach(([key]) => blockedAttempts.delete(key));
  }
}, 10 * 60 * 1000); // Every 10 minutes

// ===========================================
// RATE LIMITING
// ===========================================

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyGenerator?: (request: FastifyRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  skip?: (request: FastifyRequest) => boolean;
}

// In-memory rate limit store (use Redis in production for multi-instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_LIMIT_ENTRIES = 50000;

// Clean up expired entries periodically and enforce size limit
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
  // Enforce size limit - remove oldest entries if over limit
  if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
    const entries = [...rateLimitStore.entries()];
    entries.sort((a, b) => a[1].resetAt - b[1].resetAt);
    const toRemove = entries.slice(0, rateLimitStore.size - MAX_RATE_LIMIT_ENTRIES);
    toRemove.forEach(([key]) => rateLimitStore.delete(key));
  }
}, 30000); // Clean every 30 seconds

/**
 * Create rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.ip ?? 'unknown',
    skip,
  } = config;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip if configured
    if (skip && skip(request)) {
      return;
    }

    const key = `ratelimit:${keyGenerator(request)}`;
    const now = Date.now();
    const resetAt = now + windowMs;

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      // New window
      entry = { count: 1, resetAt };
      rateLimitStore.set(key, entry);
    } else {
      // Existing window
      entry.count++;
    }

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', maxRequests);
    reply.header('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    reply.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      reply.header('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return reply.code(429).send({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
  };
}

// Helper to check if request is from localhost/internal
function isLocalhost(req: FastifyRequest): boolean {
  const ip = req.ip ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('172.') || ip.startsWith('10.');
}

// Preset rate limiters
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  skip: (req) => req.url === '/health',
});

// Higher rate limit for execute endpoint (core functionality)
export const executeRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 1000, // 1000 requests/minute for executions
  skip: (req) => isLocalhost(req), // No limit for localhost/internal testing
});

export const authRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute (reduced from 15 for dev)
  maxRequests: 200, // Increased for development
});

// Strict rate limit for registration endpoint specifically
export const registerRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 registration attempts per 15 min per IP
});

export const sensitiveRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5,
});

// Trace ingestion rate limit - throttles abuse, not caps
// 60 traces/minute is generous for legitimate use, prevents flooding
export const traceRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60, // 60 traces/minute (1 per second sustained)
  skip: (req) => isLocalhost(req), // No limit for localhost/internal testing
});

// ===========================================
// INPUT VALIDATION
// ===========================================

/**
 * Sanitize string input - removes dangerous characters
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';

  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .trim();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validate UUID format
 */
export function isValidUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate ULID format (used by SUBSTRATE IDs)
 */
export function isValidUlid(ulid: string): boolean {
  const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
  return ulidRegex.test(ulid);
}

/**
 * Validate SUBSTRATE ID format (prefix_ulid)
 */
export function isValidSubstrateId(id: string, prefix?: string): boolean {
  const parts = id.split('_');
  if (parts.length < 2) return false;

  const idPrefix = parts.slice(0, -1).join('_');
  const ulid = parts[parts.length - 1];

  if (prefix && idPrefix !== prefix) return false;
  if (!ulid) return false;

  return isValidUlid(ulid);
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validate and sanitize JSON payload
 */
export function validateJsonPayload(
  body: unknown,
  maxSize: number = 1024 * 1024 // 1MB default
): { valid: boolean; error?: string } {
  if (body === null || body === undefined) {
    return { valid: false, error: 'Request body is required' };
  }

  const stringified = JSON.stringify(body);
  if (stringified.length > maxSize) {
    return { valid: false, error: `Request body exceeds maximum size of ${maxSize} bytes` };
  }

  return { valid: true };
}

// ===========================================
// SECURITY HEADERS
// ===========================================

/**
 * Add security headers to all responses
 */
export async function securityHeaders(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Prevent clickjacking
  reply.header('X-Frame-Options', 'SAMEORIGIN');

  // Prevent MIME type sniffing
  reply.header('X-Content-Type-Options', 'nosniff');

  // XSS protection for older browsers
  reply.header('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy (restrict browser features)
  reply.header(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
  );

  // Content Security Policy for API responses
  if (request.url.startsWith('/api/')) {
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'"
    );
  }

  // Don't cache sensitive responses
  if (
    request.url.includes('/auth/') ||
    request.url.includes('/billing/') ||
    request.url.includes('/admin/')
  ) {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
  }
}

// ===========================================
// SQL INJECTION PREVENTION
// ===========================================

/**
 * Validate that a string doesn't contain SQL injection patterns
 */
export function isSqlSafe(input: string): boolean {
  // Common SQL injection patterns
  const dangerousPatterns = [
    /('|")\s*(or|and)\s*('|")/i,
    /;\s*(drop|delete|truncate|update|insert|alter)/i,
    /union\s+(all\s+)?select/i,
    /exec\s*\(/i,
    /xp_/i,
    /--/,
  ];

  return !dangerousPatterns.some((pattern) => pattern.test(input));
}

// ===========================================
// REQUEST VALIDATION MIDDLEWARE
// ===========================================

/**
 * Create input validation middleware
 */
export function validateInput(schema: {
  body?: Record<string, { type: string; required?: boolean; maxLength?: number; pattern?: RegExp }>;
  params?: Record<string, { type: string; pattern?: RegExp }>;
  query?: Record<string, { type: string; maxLength?: number }>;
}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const errors: string[] = [];

    // Validate body
    if (schema.body) {
      const body = request.body as Record<string, unknown> | undefined;

      for (const [field, rules] of Object.entries(schema.body)) {
        const value = body?.[field];

        if (rules.required && (value === undefined || value === null || value === '')) {
          errors.push(`${field} is required`);
          continue;
        }

        if (value !== undefined && value !== null) {
          if (rules.type === 'string' && typeof value !== 'string') {
            errors.push(`${field} must be a string`);
          } else if (rules.type === 'number' && typeof value !== 'number') {
            errors.push(`${field} must be a number`);
          } else if (rules.type === 'boolean' && typeof value !== 'boolean') {
            errors.push(`${field} must be a boolean`);
          } else if (rules.type === 'email' && (typeof value !== 'string' || !isValidEmail(value))) {
            errors.push(`${field} must be a valid email`);
          }

          if (typeof value === 'string') {
            if (rules.maxLength && value.length > rules.maxLength) {
              errors.push(`${field} exceeds maximum length of ${rules.maxLength}`);
            }
            if (rules.pattern && !rules.pattern.test(value)) {
              errors.push(`${field} has invalid format`);
            }
            if (!isSqlSafe(value)) {
              errors.push(`${field} contains invalid characters`);
            }
          }
        }
      }
    }

    // Validate params
    if (schema.params) {
      const params = request.params as Record<string, string> | undefined;

      for (const [field, rules] of Object.entries(schema.params)) {
        const value = params?.[field];

        if (value !== undefined) {
          if (rules.pattern && !rules.pattern.test(value)) {
            errors.push(`Invalid ${field} format`);
          }
          if (!isSqlSafe(value)) {
            errors.push(`${field} contains invalid characters`);
          }
        }
      }
    }

    if (errors.length > 0) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: errors,
      });
    }
  };
}

// ===========================================
// CSRF PROTECTION
// ===========================================

/**
 * CSRF protection configuration
 */
export const csrfConfig = {
  // Cookie-based CSRF (Double Submit Cookie pattern)
  cookieOpts: {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: process.env['NODE_ENV'] === 'production' ? 'none' as const : 'lax' as const,
    path: '/',
    signed: true,
    // Share cookie across subdomains in production for cross-origin dashboard
    // Note: Domain is set dynamically in auth.ts based on request host
    ...(process.env['NODE_ENV'] === 'production' ? { domain: '.askalf.org' } : {}),
  },
  // Session-based is more secure but we use cookie-based for stateless API
  sessionPlugin: '@fastify/cookie',
};

/**
 * Routes that require CSRF protection (state-changing operations)
 * These are checked against both URL and method
 */
const CSRF_PROTECTED_ROUTES = [
  // Auth routes (state changing)
  { method: 'POST', pattern: /^\/api\/v1\/auth\/(register|login|logout|change-password|reset-password|verify-email|resend-verification)$/ },
  // Session management
  { method: 'POST', pattern: /^\/api\/v1\/auth\/sessions/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/auth\/sessions/ },
  // User data modification
  { method: 'POST', pattern: /^\/api\/v1\/(traces|episodes|facts|contexts)/ },
  { method: 'PUT', pattern: /^\/api\/v1\// },
  { method: 'DELETE', pattern: /^\/api\/v1\// },
  // Metabolic operations
  { method: 'POST', pattern: /^\/api\/v1\/metabolic/ },
  // Tenant/billing modifications
  { method: 'POST', pattern: /^\/api\/v1\/tenants/ },
  { method: 'PUT', pattern: /^\/api\/v1\/tenants/ },
  { method: 'POST', pattern: /^\/api\/v1\/billing/ },
  // API key management
  { method: 'POST', pattern: /^\/api\/v1\/api-keys/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/api-keys/ },
];

/**
 * Routes exempt from CSRF (read-only or special handling)
 */
const CSRF_EXEMPT_ROUTES = [
  /^\/health/,
  /^\/metrics/,
  /^\/api\/v1\/auth\/me$/, // Read-only
  /^\/api\/v1\/auth\/csrf-token$/, // Token generation
  /^\/api\/v1\/auth\/login$/, // Login doesn't need CSRF (no session to protect yet, has rate limiting + lockout)
  /^\/api\/v1\/auth\/register$/, // Register doesn't need CSRF (no session to protect yet, has rate limiting)
  /^\/api\/v1\/auth\/logout$/, // Logout exempt - requires valid session cookie, user explicitly clicked logout
  /^\/api\/v1\/auth\/forgot-password$/, // Public endpoint, rate limited, no state change risk
  /^\/api\/v1\/auth\/verify-email$/, // Token-based verification from email link, token itself is proof of intent
  /^\/api\/v1\/auth\/resend-verification$/, // Requires valid session cookie, rate limited
  /^\/api\/v1\/stats$/,
  /^\/api\/v1\/shards$/, // GET list is read-only
  /^\/api\/v1\/execute$/, // Execute uses API key auth, may be called by external systems
  /^\/api\/v1\/execute\/batch$/,
  /^\/api\/v1\/billing\/webhook/, // Stripe webhooks have their own signature verification
  /^\/api\/v1\/sigil\//, // SIGIL bridge endpoints (public demo)
  /^\/api\/v1\/conversations/, // Chat conversations - session auth + SameSite cookie is sufficient
  /^\/api\/v1\/connectors/, // AI connectors - session auth + SameSite cookie is sufficient
  /^\/api\/v1\/chat\//, // Chat messages - session auth + SameSite cookie is sufficient
  /^\/api\/v1\/credits\//, // Credit status - session auth
  /^\/api\/v1\/bundles\//, // Bundle operations - session auth
  /^\/api\/v1\/billing\/checkout$/, // Stripe checkout - session auth, redirects to Stripe
  /^\/api\/v1\/billing\/portal$/, // Stripe portal - session auth, redirects to Stripe
  /^\/api\/v1\/plans$/, // Plans list - read-only
];

/**
 * Check if a route requires CSRF protection
 */
export function requiresCsrf(method: string, url: string): boolean {
  // Strip query params
  const path = url.split('?')[0] ?? url;

  // Check exemptions first
  if (CSRF_EXEMPT_ROUTES.some(pattern => pattern.test(path))) {
    return false;
  }

  // Check if route matches a protected pattern
  return CSRF_PROTECTED_ROUTES.some(route =>
    route.method === method && route.pattern.test(path)
  );
}

/**
 * Validate CSRF token from request
 * Token can be in:
 * - X-CSRF-Token header
 * - x-csrf-token header
 * - _csrf body field
 * - _csrf query param
 */
export function getCsrfToken(request: FastifyRequest): string | undefined {
  // Check headers first (preferred)
  const headerToken = request.headers['x-csrf-token'] as string | undefined;
  if (headerToken) return headerToken;

  // Check body
  const body = request.body as Record<string, unknown> | undefined;
  if (body?.['_csrf'] && typeof body['_csrf'] === 'string') {
    return body['_csrf'];
  }

  // Check query params (least preferred)
  const queryParams = request.query as Record<string, unknown> | undefined;
  if (queryParams?.['_csrf'] && typeof queryParams['_csrf'] === 'string') {
    return queryParams['_csrf'];
  }

  return undefined;
}

// ===========================================
// PROMPT INJECTION PROTECTION
// ===========================================

// Fields to scan for injection attacks
const SCANNABLE_FIELDS = [
  'content', 'input', 'prompt', 'query', 'message', 'text',
  'description', 'name', 'sigil', 'title', 'subject', 'body',
  'instructions', 'system_prompt', 'user_message', 'context',
];

// Routes that require injection scanning
const INJECTION_SCAN_ROUTES = [
  /^\/api\/v1\/traces/,
  /^\/api\/v1\/episodes/,
  /^\/api\/v1\/facts/,
  /^\/api\/v1\/contexts/,
  /^\/api\/v1\/execute/,
  /^\/api\/v1\/metabolic/,
  /^\/api\/v1\/sigil/,
  /^\/api\/sigil/,
  /^\/api\/v1\/conversations/,
  /^\/api\/v1\/chat/,
  /^\/api\/v1\/connectors/,
];

/**
 * Scan request body for prompt injection attacks
 */
export function scanForInjection(body: unknown, ip: string): {
  safe: boolean;
  threats: ThreatDetection[];
  riskScore: number;
  sanitizedBody?: unknown;
} {
  if (!body || typeof body !== 'object') {
    return { safe: true, threats: [], riskScore: 0 };
  }

  const allThreats: ThreatDetection[] = [];
  let maxRiskScore = 0;
  const sanitizedBody = JSON.parse(JSON.stringify(body)); // Deep clone

  function scanValue(obj: Record<string, unknown>, key: string): void {
    const value = obj[key];

    if (typeof value === 'string' && SCANNABLE_FIELDS.includes(key.toLowerCase())) {
      const result = injectionScanner.scan(value);
      allThreats.push(...result.threats);
      maxRiskScore = Math.max(maxRiskScore, result.riskScore);

      // Replace with sanitized version
      (sanitizedBody as Record<string, unknown>)[key] = result.sanitized;

      // Record metrics for anomaly detection
      anomalyDetector.record(`input_length_${key}`, value.length);
      anomalyDetector.record('risk_score', result.riskScore);
    } else if (Array.isArray(value)) {
      // Recursively scan array elements
      for (let i = 0; i < value.length; i++) {
        const element = value[i];
        if (typeof element === 'string' && SCANNABLE_FIELDS.includes(key.toLowerCase())) {
          const result = injectionScanner.scan(element);
          allThreats.push(...result.threats);
          maxRiskScore = Math.max(maxRiskScore, result.riskScore);
          anomalyDetector.record(`input_length_${key}`, element.length);
          anomalyDetector.record('risk_score', result.riskScore);
        } else if (typeof element === 'object' && element !== null) {
          for (const nestedKey of Object.keys(element as Record<string, unknown>)) {
            scanValue(element as Record<string, unknown>, nestedKey);
          }
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recursively scan nested objects
      for (const nestedKey of Object.keys(value as Record<string, unknown>)) {
        scanValue(value as Record<string, unknown>, nestedKey);
      }
    }
  }

  for (const key of Object.keys(body as Record<string, unknown>)) {
    scanValue(body as Record<string, unknown>, key);
  }

  // Track suspicious IPs
  if (allThreats.length > 0) {
    const existing = blockedAttempts.get(ip) ?? { count: 0, lastAttempt: new Date(), threats: [] };
    existing.count++;
    existing.lastAttempt = new Date();
    existing.threats = [...new Set([...existing.threats, ...allThreats.map(t => t.type)])].slice(0, 10);
    blockedAttempts.set(ip, existing);

    // Log the attempt
    logger.warn(`[SECURITY] Injection attempt from ${ip}: ${allThreats.map(t => t.type).join(', ')} (risk: ${maxRiskScore})`);
  }

  return {
    safe: maxRiskScore < 50 && !allThreats.some(t => t.severity === 'critical'),
    threats: allThreats,
    riskScore: maxRiskScore,
    sanitizedBody
  };
}

/**
 * Middleware to scan for prompt injection attacks
 */
export async function promptInjectionGuard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const url = request.url.split('?')[0] ?? request.url;
  const method = request.method;

  // Only scan POST/PUT/PATCH requests to sensitive routes
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    return;
  }

  if (!INJECTION_SCAN_ROUTES.some(pattern => pattern.test(url))) {
    return;
  }

  const ip = request.ip ?? 'unknown';

  // Check if IP is a repeat offender
  const history = blockedAttempts.get(ip);
  if (history && history.count >= 5) {
    logger.warn(`[SECURITY] Blocking repeat offender: ${ip} (${history.count} attempts)`);
    return reply.code(403).send({
      error: 'Access Denied',
      message: 'Your IP has been temporarily blocked due to suspicious activity',
      code: 'SECURITY_BLOCK'
    });
  }

  // Scan the request body
  const scanResult = scanForInjection(request.body, ip);

  if (!scanResult.safe) {
    const criticalThreats = scanResult.threats.filter(t => t.severity === 'critical');
    const highThreats = scanResult.threats.filter(t => t.severity === 'high');

    // Log detailed info for security monitoring
    logger.error(`[SECURITY] BLOCKED - IP: ${ip}, URL: ${url}, Risk: ${scanResult.riskScore}, Threats: ${JSON.stringify(scanResult.threats.map(t => ({ type: t.type, severity: t.severity, pattern: t.pattern.slice(0, 50) })))}`);

    return reply.code(400).send({
      error: 'Input Validation Failed',
      message: criticalThreats.length > 0
        ? 'Request contains prohibited content'
        : 'Request contains suspicious patterns',
      code: 'INJECTION_DETECTED',
      details: process.env['NODE_ENV'] !== 'production'
        ? scanResult.threats.map(t => ({ type: t.type, severity: t.severity }))
        : undefined
    });
  }

  // Warn on medium-risk but allow through
  if (scanResult.riskScore > 20) {
    logger.warn(`[SECURITY] Warning - IP: ${ip}, URL: ${url}, Risk: ${scanResult.riskScore}`);
  }
}

/**
 * Get security statistics
 */
export function getSecurityStats(): {
  blockedIPs: number;
  totalBlocks: number;
  topThreats: string[];
  anomalies: { metric: string; baseline: { mean: number; stdDev: number } }[];
} {
  let totalBlocks = 0;
  const threatCounts = new Map<string, number>();

  for (const [_, data] of blockedAttempts) {
    totalBlocks += data.count;
    for (const threat of data.threats) {
      threatCounts.set(threat, (threatCounts.get(threat) ?? 0) + 1);
    }
  }

  const topThreats = [...threatCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([threat]) => threat);

  return {
    blockedIPs: blockedAttempts.size,
    totalBlocks,
    topThreats,
    anomalies: ['input_length_content', 'input_length_prompt', 'risk_score']
      .map(metric => ({ metric, baseline: anomalyDetector.getBaseline(metric) }))
      .filter((a): a is { metric: string; baseline: { mean: number; stdDev: number } } => a.baseline !== null)
  };
}

// ===========================================
// DISPOSABLE EMAIL BLOCKLIST
// ===========================================

export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'tempmail.com', 'temp-mail.org', 'tempmailo.com', 'tempmailaddress.com',
  'guerrillamail.com', 'guerrillamail.org', 'guerrillamail.net', 'guerrillamail.biz',
  'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com',
  '10minutemail.com', '10minutemail.net', '10minmail.com', '10mail.org',
  'throwaway.email', 'throwawaymail.com', 'throam.com',
  'fakeinbox.com', 'fakemailgenerator.com', 'fakemail.net',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'trashmail.com', 'trashmail.net', 'trashmail.org', 'trashmail.me',
  'dispostable.com', 'disposableemailaddresses.com', 'disposable-email.ml',
  'mailnesia.com', 'mailnator.com', 'maildrop.cc',
  'sharklasers.com', 'spam4.me', 'spamgourmet.com',
  'getnada.com', 'nada.email', 'getairmail.com',
  'mohmal.com', 'emailondeck.com', 'mintemail.com',
  'tempinbox.com', 'tempr.email', 'discard.email',
  'mailcatch.com', 'mailscrap.com', 'mailsac.com',
  'burnermail.io', 'imgv.de', 'jetable.org',
  'spamfree24.org', 'spamfree.eu', 'objectmail.com',
  'proxymail.eu', 'rcpt.at', 'trash-mail.at',
  'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
  'einrot.com', 'e4ward.com', 'emailthe.net',
  'incognitomail.com', 'incognitomail.net', 'incognitomail.org',
  'mailexpire.com', 'mailzilla.com', 'mytrashmail.com',
  'no-spam.ws', 'nobulk.com', 'nospamfor.us',
  'oneoffemail.com', 'pookmail.com', 'rtrtr.com',
  'safetymail.info', 'sendspamhere.com', 'sogetthis.com',
  'spam.la', 'spambox.us', 'spamcero.com',
  'spamex.com', 'spamfree24.de', 'spamfree24.eu',
  'tempemail.net', 'tempmail.net', 'tmpmail.org',
]);

// ===========================================
// PER-IP SIGNUP COOLDOWN
// ===========================================

// Track registrations per IP: IP -> { count, windowStart }
const signupTracker = new Map<string, { count: number; windowStart: number }>();
const MAX_SIGNUP_TRACKER_ENTRIES = 10000;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_SIGNUPS_PER_IP = 3; // 3 accounts per IP per hour

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of signupTracker.entries()) {
    if (now - value.windowStart > SIGNUP_WINDOW_MS) {
      signupTracker.delete(key);
    }
  }
  if (signupTracker.size > MAX_SIGNUP_TRACKER_ENTRIES) {
    const entries = [...signupTracker.entries()];
    entries.sort((a, b) => a[1].windowStart - b[1].windowStart);
    const toRemove = entries.slice(0, signupTracker.size - MAX_SIGNUP_TRACKER_ENTRIES);
    toRemove.forEach(([key]) => signupTracker.delete(key));
  }
}, 5 * 60 * 1000);

/**
 * Check if an IP has exceeded the signup cooldown.
 * Returns true if allowed, false if rate limited.
 * Increments the counter on success.
 */
export function checkSignupCooldown(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = signupTracker.get(ip);

  if (!entry || now - entry.windowStart > SIGNUP_WINDOW_MS) {
    // New window
    signupTracker.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= MAX_SIGNUPS_PER_IP) {
    const retryAfterMs = SIGNUP_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

// ===========================================
// REGISTER SECURITY MIDDLEWARE
// ===========================================

/**
 * Register all security middleware on the Fastify instance
 */
export async function registerSecurityMiddleware(app: FastifyInstance): Promise<void> {
  // Register CSRF protection plugin
  await app.register(fastifyCsrf, {
    cookieOpts: csrfConfig.cookieOpts,
    sessionPlugin: '@fastify/cookie',
  });

  // Add security headers to all responses
  app.addHook('onSend', async (request, reply) => {
    await securityHeaders(request, reply);
  });

  // CSRF validation hook for protected routes
  app.addHook('preHandler', async (request, reply) => {
    const method = request.method;
    const url = request.url;

    // Skip CSRF for safe methods (GET, HEAD, OPTIONS)
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return;
    }

    // Skip if request has valid API key (machine-to-machine)
    // API key requests are validated separately and don't need CSRF
    const authHeader = request.headers['authorization'] as string | undefined;
    if (authHeader?.startsWith('Bearer sk_')) {
      return;
    }

    // Check if route requires CSRF
    if (!requiresCsrf(method, url)) {
      return;
    }

    // Validate CSRF token
    try {
      // @fastify/csrf-protection adds csrfProtection method
      await (request as FastifyRequest & { csrfProtection: () => Promise<void> }).csrfProtection();
    } catch (err) {
      return reply.code(403).send({
        error: 'CSRF validation failed',
        message: 'Invalid or missing CSRF token. Get a token from /api/v1/auth/csrf-token',
        code: 'CSRF_INVALID',
      });
    }
  });

  // Log suspicious activity in URLs
  app.addHook('preHandler', async (request) => {
    const ip = request.ip;
    const userAgent = request.headers['user-agent'] ?? 'unknown';

    // Check for suspicious patterns in URL
    const url = request.url;
    const suspiciousPatterns = [
      /\.\.\//, // Directory traversal
      /\.\.[\\\/]/,  // Windows-style directory traversal
      /<script/i, // XSS attempt
      /union.*select/i, // SQL injection
      /exec\s*\(/i, // Code execution
      /\bor\b.*?=.*?--/i, // SQL injection (OR 1=1 --)
      /%00/, // Null byte injection
      /\bwaitfor\b.*?\bdelay\b/i, // SQL time-based injection
      /\bsleep\s*\(/i, // SQL/command sleep injection
      /\|(ls|cat|id|whoami|pwd|uname)\b/i, // Command injection via pipe
      /;\s*(ls|cat|id|whoami|pwd|uname|curl|wget)\b/i, // Command injection via semicolon
      /\$\(|`.*`/, // Command substitution
    ];

    if (suspiciousPatterns.some((p) => p.test(url))) {
      logger.warn(`[SECURITY] Suspicious URL: ${ip} - ${userAgent} - ${url}`);
    }
  });

  // Prompt injection protection for request bodies
  app.addHook('preHandler', promptInjectionGuard);

  logger.info({ component: 'security' }, 'Security middleware initialized');
}
