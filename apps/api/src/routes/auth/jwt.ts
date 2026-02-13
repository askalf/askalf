/**
 * JWT and Token Generation
 * Session token creation, hashing, and encryption
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ulid } from 'ulid';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits

export function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i]! % chars.length];
  }
  return result;
}

export function generateSessionToken(): string {
  return `${ulid()}_${generateSecureToken(16)}`;
}

export async function hashToken(token: string): Promise<string> {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * API Key encryption for secure storage
 */
async function getEncryptionKey() {
  const keySource = process.env['API_KEY_ENCRYPTION_KEY'];
  if (!keySource) {
    throw new Error('API_KEY_ENCRYPTION_KEY environment variable not set');
  }

  // If key is a hex string (64 chars for 256-bit), use it directly
  if (/^[0-9a-f]{64}$/i.test(keySource)) {
    return Buffer.from(keySource, 'hex');
  }

  // Otherwise, derive from string using SHA-256
  const hash = createHash('sha256');
  hash.update(keySource);
  return hash.digest();
}

export async function encryptApiKey(apiKey: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Return iv:authTag:encrypted as a single string
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export async function decryptApiKey(encryptedKey: string): Promise<string> {
  const key = await getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedKey.split(':');

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encrypted key format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
