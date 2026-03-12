/**
 * Channel Provider Registry
 * Central registry for all channel providers.
 */

import type { ChannelProvider, ChannelType } from './types.js';
import { CHANNEL_TYPES } from './types.js';
import { SlackProvider } from './slack.js';
import { DiscordProvider } from './discord.js';
import { TelegramProvider } from './telegram.js';
import { WhatsAppProvider } from './whatsapp.js';
import { TeamsProvider } from './teams.js';
import { ZapierProvider, N8nProvider, MakeProvider } from './automation.js';
import { EmailProvider } from './email-channel.js';
import { TwilioSmsProvider } from './twilio-sms.js';
import { SendGridProvider } from './sendgrid-channel.js';
import { TwilioVoiceProvider } from './twilio-voice.js';
import { ZoomProvider } from './zoom-channel.js';
import { WebhooksProvider } from './webhooks.js';

const providers = new Map<ChannelType, ChannelProvider>();

// Register providers
providers.set('webhooks', new WebhooksProvider());
providers.set('slack', new SlackProvider());
providers.set('discord', new DiscordProvider());
providers.set('telegram', new TelegramProvider());
providers.set('whatsapp', new WhatsAppProvider());
providers.set('teams', new TeamsProvider());
providers.set('zapier', new ZapierProvider());
providers.set('n8n', new N8nProvider());
providers.set('make', new MakeProvider());
providers.set('email', new EmailProvider());
providers.set('twilio', new TwilioSmsProvider());
providers.set('sendgrid', new SendGridProvider());
providers.set('twilio_voice', new TwilioVoiceProvider());
providers.set('zoom', new ZoomProvider());

export function getChannelProvider(type: ChannelType): ChannelProvider | null {
  return providers.get(type) ?? null;
}

export function isValidChannelType(type: string): type is ChannelType {
  return CHANNEL_TYPES.includes(type as ChannelType);
}

export { CHANNEL_TYPES };
export type { ChannelProvider, ChannelType };
