// SUBSTRATE v1: Password Utilities
// Secure password hashing and validation

import bcrypt from 'bcrypt';
import type { PasswordStrength } from './types.js';

// Cost factor for bcrypt (12 is recommended for production)
const BCRYPT_COST = 12;

// Minimum password requirements
const MIN_PASSWORD_LENGTH = 12;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 * Returns validation result with errors and score
 */
export function validatePasswordStrength(password: string): PasswordStrength {
  const errors: string[] = [];
  let score = 0;

  // Length check
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  } else {
    score += 1;
    if (password.length >= 16) score += 1;
  }

  // Uppercase check
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  } else {
    score += 1;
  }

  // Lowercase check
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  } else {
    score += 0.5;
  }

  // Number check
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  } else {
    score += 0.5;
  }

  // Special character check
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  } else {
    score += 1;
  }

  // Common patterns check
  const commonPatterns = [
    /^123456/,
    /password/i,
    /qwerty/i,
    /^abc123/i,
    /111111/,
    /12345678/,
    /letmein/i,
    /admin/i,
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      errors.push('Password contains a common pattern');
      score = Math.max(0, score - 1);
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    score: Math.min(5, Math.round(score)),
  };
}

/**
 * Check if a password meets minimum requirements
 * (simpler check for login flow, full validation on registration)
 */
export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Generate a secure random token (for password reset, email verification, etc.)
 */
export function generateSecureToken(length: number = 32): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

/**
 * Generate a session token
 * Format: substrate_sess_<random>
 */
export function generateSessionToken(): string {
  return `substrate_sess_${generateSecureToken(48)}`;
}

/**
 * Generate an API key
 * Format: sk_<environment>_<random>
 * Returns both the full key and the prefix for storage
 */
export function generateApiKey(
  environment: 'live' | 'test' = 'live'
): { key: string; prefix: string } {
  const randomPart = generateSecureToken(32);
  const key = `sk_${environment}_${randomPart}`;
  const prefix = key.slice(0, 12); // "sk_live_xxxx" or "sk_test_xxxx"
  return { key, prefix };
}

/**
 * Hash a token for storage (API keys, session tokens)
 * Uses SHA-256
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
