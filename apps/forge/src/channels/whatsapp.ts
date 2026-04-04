/**
 * WhatsApp Channel Provider
 * Handles Meta WhatsApp Cloud API webhooks and message replies.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class WhatsAppProvider implements ChannelProvider {
  type = 'whatsapp' as const;

  /**
   * Verify WhatsApp webhook using HMAC-SHA256 via X-Hub-Signature-256.
   */
  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const appSecret = config.config['app_secret'] as string | undefined;
    if (!appSecret) {
      console.warn('[WhatsApp] WARNING: app_secret not configured — accepting all inbound webhooks without HMAC verification. Set app_secret in channel config to enable signature checks.');
      return { valid: true }; // Allow if no secret (development)
    }

    const signature = headers['x-hub-signature-256'];
    if (!signature) return { valid: false };

    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');

    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false };
    }

    return { valid: true };
  }

  /**
   * Handle Meta webhook verification challenge (GET request with hub.challenge).
   * This is handled separately in the routes since it's a GET, not POST.
   */
  handleChallenge(): ChannelVerifyResult | null {
    return null;
  }

  /**
   * Parse a WhatsApp Cloud API webhook payload into a message.
   */
  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;
    const entry = (payload['entry'] as Array<Record<string, unknown>>)?.[0];
    if (!entry) return null;

    const changes = (entry['changes'] as Array<Record<string, unknown>>)?.[0];
    if (!changes) return null;

    const value = changes['value'] as Record<string, unknown> | undefined;
    if (!value) return null;

    // Only handle messages (not statuses)
    const messages = value['messages'] as Array<Record<string, unknown>> | undefined;
    if (!messages || messages.length === 0) return null;

    const msg = messages[0]!;

    // Only handle text messages
    if (msg['type'] !== 'text') return null;

    const textObj = msg['text'] as Record<string, unknown> | undefined;
    const text = textObj?.['body'] as string | undefined;
    if (!text || text.trim().length === 0) return null;

    const contacts = value['contacts'] as Array<Record<string, unknown>> | undefined;
    const contact = contacts?.[0];

    return {
      text: text.trim(),
      externalMessageId: msg['id'] as string | undefined,
      externalChannelId: (value['metadata'] as Record<string, unknown>)?.['phone_number_id'] as string | undefined,
      externalUserId: msg['from'] as string | undefined,
      metadata: {
        wa_id: contact?.['wa_id'],
        profile_name: (contact?.['profile'] as Record<string, unknown>)?.['name'],
        timestamp: msg['timestamp'],
      },
    };
  }

  /**
   * Send a reply via WhatsApp Cloud API.
   */
  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const accessToken = config.config['access_token'] as string | undefined;
    const phoneNumberId = config.config['phone_number_id'] as string | undefined;
    if (!accessToken || !phoneNumberId) throw new Error('WhatsApp access_token or phone_number_id not configured');

    // Get the sender's phone number from the original message
    const { query } = await import('../database.js');
    const msgRow = await query<{ external_user_id: string | null; external_message_id: string | null }>(
      `SELECT external_user_id, external_message_id FROM channel_messages WHERE id = $1`,
      [message.channelMessageId],
    );
    const recipientPhone = msgRow[0]?.external_user_id;
    if (!recipientPhone) throw new Error('No recipient phone number for WhatsApp reply');

    // Mark original message as read
    const originalMsgId = msgRow[0]?.external_message_id;
    if (originalMsgId) {
      void fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: originalMsgId,
        }),
      }).catch((e) => { if (e) console.debug("[catch]", String(e)); }); // Fire-and-forget
    }

    // Truncate to WhatsApp's 4096 char limit
    const text = message.text.length > 4000 ? message.text.substring(0, 4000) + '\n...(truncated)' : message.text;

    const response = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const result = await response.json() as { error?: { message: string } };
      throw new Error(`WhatsApp API error: ${response.status} - ${result.error?.message ?? 'Unknown'}`);
    }
  }
}
