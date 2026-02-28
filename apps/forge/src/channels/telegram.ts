/**
 * Telegram Channel Provider
 * Handles Telegram Bot API webhooks and message replies.
 */

import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

export class TelegramProvider implements ChannelProvider {
  type = 'telegram' as const;

  /**
   * Verify Telegram webhook using the secret token header.
   * Telegram sends X-Telegram-Bot-Api-Secret-Token if configured via setWebhook.
   */
  verifyWebhook(headers: Record<string, string>, _body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const expectedSecret = config.config['webhook_secret'] as string | undefined;
    if (!expectedSecret) {
      // If no secret configured, accept all (Telegram doesn't require signature verification)
      return { valid: true };
    }

    const providedSecret = headers['x-telegram-bot-api-secret-token'];
    if (!providedSecret || providedSecret !== expectedSecret) {
      return { valid: false };
    }

    return { valid: true };
  }

  handleChallenge(): ChannelVerifyResult | null {
    return null; // Telegram has no challenge mechanism
  }

  /**
   * Parse a Telegram Update into a message.
   */
  parseMessage(body: unknown): ChannelInboundMessage | null {
    const update = body as Record<string, unknown>;

    // Handle regular messages
    const message = update['message'] as Record<string, unknown> | undefined;
    if (!message) return null;

    const text = message['text'] as string | undefined;
    if (!text || text.trim().length === 0) return null;

    // Ignore bot commands that are just /start etc.
    if (text === '/start' || text === '/help') return null;

    // Strip /ask command prefix if present
    const cleanText = text.replace(/^\/ask\s+/i, '').trim();
    if (cleanText.length === 0) return null;

    const chat = message['chat'] as Record<string, unknown> | undefined;
    const from = message['from'] as Record<string, unknown> | undefined;

    return {
      text: cleanText,
      externalMessageId: String(message['message_id'] ?? ''),
      externalChannelId: String(chat?.['id'] ?? ''),
      externalUserId: String(from?.['id'] ?? ''),
      metadata: {
        chat_type: chat?.['type'],
        first_name: from?.['first_name'],
        username: from?.['username'],
        update_id: update['update_id'],
      },
    };
  }

  /**
   * Send a reply via Telegram Bot API sendMessage.
   */
  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const botToken = config.config['bot_token'] as string | undefined;
    if (!botToken) throw new Error('Telegram bot_token not configured');

    // Get the chat ID from the original message
    const { query } = await import('../database.js');
    const msgRow = await query<{ external_channel_id: string | null }>(
      `SELECT external_channel_id FROM channel_messages WHERE id = $1`,
      [message.channelMessageId],
    );
    const chatId = msgRow[0]?.external_channel_id;
    if (!chatId) throw new Error('No chat ID found for Telegram reply');

    // Split long messages
    const chunks = this.splitMessage(message.text);

    for (const chunk of chunks) {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        const result = await response.json() as { ok: boolean; description?: string };
        // Retry without Markdown if it fails (malformed markdown)
        if (result.description?.includes('parse')) {
          const retryResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
            }),
          });
          if (!retryResponse.ok) {
            throw new Error(`Telegram API error: ${response.status}`);
          }
        } else {
          throw new Error(`Telegram API error: ${response.status} - ${result.description}`);
        }
      }
    }
  }

  /**
   * Register the webhook URL with Telegram's Bot API.
   */
  static async registerWebhook(botToken: string, webhookUrl: string, secret?: string): Promise<void> {
    const params: Record<string, unknown> = {
      url: webhookUrl,
      allowed_updates: ['message'],
    };
    if (secret) {
      params['secret_token'] = secret;
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const result = await response.json() as { ok: boolean; description?: string };
      throw new Error(`Telegram setWebhook failed: ${result.description}`);
    }
  }

  private splitMessage(text: string): string[] {
    if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline
      let splitAt = remaining.lastIndexOf('\n', MAX_TELEGRAM_MESSAGE_LENGTH);
      if (splitAt < MAX_TELEGRAM_MESSAGE_LENGTH / 2) {
        // No good newline, split at space
        splitAt = remaining.lastIndexOf(' ', MAX_TELEGRAM_MESSAGE_LENGTH);
      }
      if (splitAt < MAX_TELEGRAM_MESSAGE_LENGTH / 2) {
        // No good split point, hard split
        splitAt = MAX_TELEGRAM_MESSAGE_LENGTH;
      }
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }
    return chunks;
  }
}
