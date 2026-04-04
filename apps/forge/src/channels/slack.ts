/**
 * Slack Channel Provider
 * Handles Slack Events API webhooks, signature verification, and message replies.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class SlackProvider implements ChannelProvider {
  type = 'slack' as const;

  /**
   * Verify Slack webhook signature using HMAC-SHA256.
   * See: https://api.slack.com/authentication/verifying-requests-from-slack
   */
  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const signingSecret = config.config['signing_secret'] as string | undefined;
    if (!signingSecret) return { valid: false };

    const timestamp = headers['x-slack-request-timestamp'];
    const slackSignature = headers['x-slack-signature'];
    if (!timestamp || !slackSignature) return { valid: false };

    // Prevent replay attacks (5 minute window)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return { valid: false };

    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const sigBase = `v0:${timestamp}:${rawBody}`;
    const expected = 'v0=' + createHmac('sha256', signingSecret).update(sigBase).digest('hex');

    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(slackSignature);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false };
    }

    return { valid: true };
  }

  /**
   * Handle Slack url_verification challenge.
   */
  handleChallenge(_headers: Record<string, string>, body: unknown): ChannelVerifyResult | null {
    const payload = body as Record<string, unknown>;
    if (payload['type'] === 'url_verification') {
      return {
        valid: true,
        challengeResponse: { challenge: payload['challenge'] },
      };
    }
    return null;
  }

  /**
   * Parse a Slack Events API callback into a message.
   */
  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Only handle event_callback type
    if (payload['type'] !== 'event_callback') return null;

    const event = payload['event'] as Record<string, unknown> | undefined;
    if (!event) return null;

    // Only handle message events (not subtypes like bot_message, message_changed, etc.)
    if (event['type'] !== 'message' || event['subtype']) return null;

    // Ignore bot messages to prevent loops
    if (event['bot_id']) return null;

    const text = event['text'] as string | undefined;
    if (!text || text.trim().length === 0) return null;

    return {
      text: text.trim(),
      externalMessageId: event['ts'] as string | undefined,
      externalChannelId: event['channel'] as string | undefined,
      externalUserId: event['user'] as string | undefined,
      metadata: {
        team: payload['team_id'],
        event_id: payload['event_id'],
      },
    };
  }

  /**
   * Send a reply to Slack via chat.postMessage API.
   */
  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const botToken = config.config['bot_token'] as string | undefined;
    if (!botToken) throw new Error('Slack bot_token not configured');

    // Get the channel ID from the original message
    const { query } = await import('../database.js');
    const msgRow = await query<{ external_channel_id: string | null }>(
      `SELECT external_channel_id FROM channel_messages WHERE id = $1`,
      [message.channelMessageId],
    );
    const channelId = msgRow[0]?.external_channel_id;
    if (!channelId) throw new Error('No channel ID found for reply');

    // Truncate to Slack's 40k char limit (with buffer)
    const text = message.text.length > 39_000 ? message.text.substring(0, 39_000) + '\n...(truncated)' : message.text;

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { ok: boolean; error?: string };
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }
  }
}
