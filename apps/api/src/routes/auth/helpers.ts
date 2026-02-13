/**
 * Helper functions for authentication
 */

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

export function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    token += chars[randomValues[i]! % chars.length];
  }
  return token;
}

export function generateSessionToken(): string {
  return generateSecureToken(64);
}

export async function hashToken(token: string): Promise<string> {
  // Use SHA256 for token hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export function detectDeviceType(userAgent?: string): 'desktop' | 'mobile' | 'tablet' | null {
  if (!userAgent) return null;

  const ua = userAgent.toLowerCase();

  if (/ipad|android(?!.*mobile)/.test(ua)) {
    return 'tablet';
  }

  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/.test(ua)) {
    return 'mobile';
  }

  if (/windows|macintosh|linux/.test(ua)) {
    return 'desktop';
  }

  return null;
}
