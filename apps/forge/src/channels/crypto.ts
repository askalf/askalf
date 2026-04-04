/**
 * Channel Config Encryption
 * AES-256-GCM encryption for stored bot tokens and secrets.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const hex = process.env['CHANNEL_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) {
    throw new Error('CHANNEL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string. Returns base64-encoded `iv:authTag:ciphertext`.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Pack as iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a string produced by encrypt(). Returns plaintext.
 */
export function decrypt(packed: string): string {
  const key = getEncryptionKey();
  const parts = packed.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0]!, 'base64');
  const authTag = Buffer.from(parts[1]!, 'base64');
  const ciphertext = Buffer.from(parts[2]!, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Encrypt sensitive fields in a config object. Returns a new object with
 * specified fields replaced by encrypted values.
 */
export function encryptConfigFields(config: Record<string, unknown>, sensitiveKeys: string[]): Record<string, unknown> {
  const result = { ...config };
  for (const key of sensitiveKeys) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0) {
      result[key] = encrypt(value);
    }
  }
  return result;
}

/**
 * Decrypt sensitive fields in a config object. Returns a new object with
 * specified fields decrypted.
 */
export function decryptConfigFields(config: Record<string, unknown>, sensitiveKeys: string[]): Record<string, unknown> {
  const result = { ...config };
  for (const key of sensitiveKeys) {
    const value = result[key];
    if (typeof value === 'string' && value.includes(':')) {
      try {
        result[key] = decrypt(value);
      } catch {
        // Leave as-is if decryption fails (might be plaintext during migration)
      }
    }
  }
  return result;
}

/** Keys that are always encrypted for each channel type */
export const SENSITIVE_KEYS: Record<string, string[]> = {
  api: [],
  webhooks: ['webhook_secret'],
  slack: ['bot_token', 'signing_secret'],
  discord: ['bot_token', 'public_key'],
  telegram: ['bot_token'],
  whatsapp: ['access_token', 'app_secret'],
  teams: ['app_password'],
  zapier: ['api_key'],
  n8n: ['api_key'],
  make: ['api_key'],
  email: ['smtp_pass'],
  twilio: ['auth_token'],
  sendgrid: ['api_key'],
  twilio_voice: ['auth_token'],
  zoom: ['client_secret', 'verification_token'],
};
