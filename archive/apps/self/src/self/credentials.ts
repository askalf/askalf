/**
 * Per-user Credential Injection
 * Checks if user has stored their own Claude API key, falls back to platform key.
 */

import Anthropic from '@anthropic-ai/sdk';
import { selfQueryOne } from '../database.js';
import { decrypt } from '../utils/encryption.js';

interface CredentialRow {
  credential_enc: string;
  status: string;
}

/**
 * Get an Anthropic SDK client for a specific user.
 * Priority: user's own key → platform ANTHROPIC_API_KEY → error
 */
export async function getAnthropicClient(userId: string): Promise<Anthropic> {
  // Check if user has their own Claude credential
  const credential = await selfQueryOne<CredentialRow>(
    `SELECT credential_enc, status FROM user_credentials
     WHERE user_id = $1 AND provider = 'claude' AND status = 'active'`,
    [userId],
  );

  if (credential) {
    try {
      const apiKey = decrypt(credential.credential_enc);
      return new Anthropic({ apiKey });
    } catch {
      // Decryption failed — fall through to platform key
      console.error('[Self] Failed to decrypt user credential, falling back to platform key');
    }
  }

  // Fall back to platform key
  const platformKey = process.env['ANTHROPIC_API_KEY'];
  if (!platformKey) {
    throw new Error('No API key available. User has no credential and no platform key configured.');
  }

  return new Anthropic({ apiKey: platformKey });
}
