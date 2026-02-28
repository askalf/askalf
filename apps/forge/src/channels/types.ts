/**
 * Channel Integration Types
 * Shared interfaces for all channel providers (API, Webhooks, Slack, Discord, Telegram, WhatsApp)
 */

export type ChannelType = 'api' | 'webhooks' | 'slack' | 'discord' | 'telegram' | 'whatsapp';

export const CHANNEL_TYPES: ChannelType[] = ['api', 'webhooks', 'slack', 'discord', 'telegram', 'whatsapp'];

export interface ChannelConfig {
  id: string;
  tenant_id: string;
  user_id: string;
  channel_type: ChannelType;
  name: string;
  is_active: boolean;
  config: Record<string, unknown>;  // encrypted tokens
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChannelInboundMessage {
  text: string;
  externalMessageId?: string;
  externalChannelId?: string;
  externalUserId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundMessage {
  text: string;
  executionId: string;
  channelMessageId: string;
}

export interface ChannelVerifyResult {
  valid: boolean;
  challengeResponse?: string | Record<string, unknown>;
}

/**
 * Interface that every channel provider must implement.
 */
export interface ChannelProvider {
  type: ChannelType;

  /** Verify the inbound webhook signature/token */
  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult;

  /** Parse the inbound webhook body into a message */
  parseMessage(body: unknown): ChannelInboundMessage | null;

  /** Send a reply back to the originating channel */
  sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void>;

  /** Handle platform-specific verification challenges (Slack url_verification, Discord PING, etc.) */
  handleChallenge?(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult | null;
}
