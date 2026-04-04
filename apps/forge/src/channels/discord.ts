/**
 * Discord Channel Provider
 * Handles Discord Interactions (webhook-based, no gateway needed).
 * Uses Ed25519 signature verification per Discord's requirements.
 */

import { verify, createPublicKey } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

// Discord interaction types
const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

// Discord interaction response types
const RESPONSE_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
} as const;

export class DiscordProvider implements ChannelProvider {
  type = 'discord' as const;

  /**
   * Verify Discord webhook using Ed25519 signature.
   */
  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const publicKey = config.config['public_key'] as string | undefined;
    if (!publicKey) return { valid: false };

    const signature = headers['x-signature-ed25519'];
    const timestamp = headers['x-signature-timestamp'];
    if (!signature || !timestamp) return { valid: false };

    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);

    try {
      return { valid: this.verifyEd25519(publicKey, signature, timestamp + rawBody) };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Ed25519 verification using Node.js crypto (Node 16+).
   */
  private verifyEd25519(publicKeyHex: string, signatureHex: string, message: string): boolean {
    // Build Ed25519 DER-encoded public key from raw 32-byte key
    const rawKey = Buffer.from(publicKeyHex, 'hex');
    // Ed25519 public key DER header
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const derKey = Buffer.concat([derPrefix, rawKey]);

    const key = createPublicKey({ key: derKey, format: 'der', type: 'spki' });
    const sig = Buffer.from(signatureHex, 'hex');
    const msg = Buffer.from(message);

    return verify(null, msg, key, sig);
  }

  /**
   * Handle Discord PING challenge.
   */
  handleChallenge(_headers: Record<string, string>, body: unknown): ChannelVerifyResult | null {
    const payload = body as Record<string, unknown>;
    if (payload['type'] === INTERACTION_TYPE.PING) {
      return {
        valid: true,
        challengeResponse: { type: RESPONSE_TYPE.PONG },
      };
    }
    return null;
  }

  /**
   * Parse a Discord interaction into a message.
   */
  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;
    const type = payload['type'] as number;

    // Handle slash commands
    if (type === INTERACTION_TYPE.APPLICATION_COMMAND) {
      const data = payload['data'] as Record<string, unknown> | undefined;
      const options = data?.['options'] as Array<{ value: string }> | undefined;
      const text = options?.[0]?.value ?? (data?.['name'] as string) ?? '';
      if (!text) return null;

      const member = payload['member'] as Record<string, unknown> | undefined;
      const user = (member?.['user'] ?? payload['user']) as Record<string, unknown> | undefined;

      return {
        text,
        externalMessageId: payload['id'] as string,
        externalChannelId: payload['channel_id'] as string | undefined,
        externalUserId: user?.['id'] as string | undefined,
        metadata: {
          interaction_token: payload['token'],
          application_id: payload['application_id'],
          guild_id: payload['guild_id'],
          type: 'command',
        },
      };
    }

    return null;
  }

  /**
   * Send a reply to Discord via REST API.
   * Uses interaction webhook follow-up for slash commands.
   */
  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const botToken = config.config['bot_token'] as string | undefined;
    if (!botToken) throw new Error('Discord bot_token not configured');

    // Get interaction metadata from original message
    const { query } = await import('../database.js');
    const msgRow = await query<{ metadata: Record<string, unknown>; external_channel_id: string | null }>(
      `SELECT metadata, external_channel_id FROM channel_messages WHERE id = $1`,
      [message.channelMessageId],
    );

    const metadata = msgRow[0]?.metadata;
    const interactionToken = metadata?.['interaction_token'] as string | undefined;
    const applicationId = metadata?.['application_id'] as string | undefined;

    // Truncate to Discord's 2000 char limit
    const text = message.text.length > 1900 ? message.text.substring(0, 1900) + '\n...(truncated)' : message.text;

    if (interactionToken && applicationId) {
      // Reply via interaction webhook (slash command follow-up)
      const response = await fetch(
        `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        },
      );

      if (!response.ok) {
        // Try creating a follow-up instead
        const followup = await fetch(
          `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
          },
        );
        if (!followup.ok) {
          throw new Error(`Discord API error: ${followup.status}`);
        }
      }
    } else {
      // Fallback: send to channel directly
      const channelId = msgRow[0]?.external_channel_id;
      if (!channelId) throw new Error('No channel ID for Discord reply');

      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: text }),
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }
    }
  }
}
