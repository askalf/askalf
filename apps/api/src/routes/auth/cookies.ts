/**
 * Cookie Configuration and Helpers
 * Manages session cookie settings and domain configuration
 */

export const SESSION_COOKIE_NAME = 'substrate_session';

const isProduction = process.env['NODE_ENV'] === 'production' || process.env['COOKIE_PRODUCTION_MODE'] === 'true';

export const SESSION_COOKIE_OPTIONS: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'none' | 'strict';
  path: string;
  domain?: string;
  maxAge: number;
} = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-origin cookies in production
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Get cookie domain based on request host
 * Share cookie across subdomains in production
 */
export function getCookieDomain(host: string): string | undefined {
  if (!isProduction) return undefined;
  if (host.includes('askalf.org')) return '.askalf.org';
  return undefined;
}
