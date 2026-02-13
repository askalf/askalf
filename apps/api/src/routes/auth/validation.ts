/**
 * Authentication Validation Helpers
 * Password strength, email normalization, and input validation
 */

import { createHash } from 'crypto';

// Import bcrypt dynamically
let bcrypt: typeof import('bcrypt');

async function loadBcrypt() {
  if (!bcrypt) {
    bcrypt = await import('bcrypt');
  }
  return bcrypt;
}

export async function hashPassword(password: string): Promise<string> {
  const bc = await loadBcrypt();
  return bc.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const bc = await loadBcrypt();
  return bc.compare(password, hash);
}

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return { valid: errors.length === 0, errors };
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function validateEmail(email: string): boolean {
  // RFC 5322 simplified regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function hashEmailForComparison(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}
