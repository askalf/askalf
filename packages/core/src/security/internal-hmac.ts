/**
 * Internal service-to-service HMAC-SHA256 request signing.
 *
 * Use this to authenticate requests between forge, dashboard, mcp-tools, and admin-console.
 * All internal services share a secret via the INTERNAL_API_SECRET environment variable.
 *
 * Two modes are supported:
 *   - Static bearer: `Authorization: Bearer <secret>` — for MCP config / CLI-initiated connections
 *   - HMAC signature: `X-Internal-Sig` + `X-Internal-Ts` — for programmatic service calls
 *
 * Signed string format: `METHOD:PATH:UNIX_TIMESTAMP_SECONDS`
 * Replay window: 60 seconds
 */
import { createHmac, timingSafeEqual } from 'crypto';

/** Maximum age of a signed request in seconds before rejection. */
const MAX_AGE_SECONDS = 60;

/**
 * Create HMAC-SHA256 signature headers for a direct service-to-service HTTP call.
 * Add these to your fetch/axios request headers.
 *
 * @example
 * const headers = createInternalHeaders(process.env.INTERNAL_API_SECRET, 'POST', '/api/v1/data');
 * await fetch(url, { headers: { ...headers, 'Content-Type': 'application/json' }, body: ... });
 */
export function createInternalHeaders(
  secret: string,
  method: string,
  path: string,
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = `${method.toUpperCase()}:${path}:${ts}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'X-Internal-Sig': sig,
    'X-Internal-Ts': ts,
  };
}

/**
 * Verify an inbound internal request.
 * Accepts either a static Bearer token or an HMAC signature.
 *
 * @returns true if the request is authenticated, false otherwise.
 */
export function verifyInternalRequest(
  secret: string,
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (!secret) return false;

  const getHeader = (name: string): string | undefined => {
    const val = headers[name.toLowerCase()] ?? headers[name];
    return Array.isArray(val) ? val[0] : val;
  };

  // Mode 1: Static Bearer token (used by MCP config / Claude CLI)
  const authHeader = getHeader('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      if (token.length !== secret.length) return false;
      return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
    } catch {
      return false;
    }
  }

  // Mode 2: HMAC signature (programmatic service-to-service)
  const sig = getHeader('x-internal-sig');
  const ts = getHeader('x-internal-ts');
  if (!sig || !ts) return false;

  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (age > MAX_AGE_SECONDS) return false;

  const payload = `${method.toUpperCase()}:${path}:${ts}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
