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

const providers = new Map<ChannelType, ChannelProvider>();

// Register providers
providers.set('slack', new SlackProvider());
providers.set('discord', new DiscordProvider());
providers.set('telegram', new TelegramProvider());
providers.set('whatsapp', new WhatsAppProvider());

export function getChannelProvider(type: ChannelType): ChannelProvider | null {
  return providers.get(type) ?? null;
}

export function isValidChannelType(type: string): type is ChannelType {
  return CHANNEL_TYPES.includes(type as ChannelType);
}

export { CHANNEL_TYPES };
export type { ChannelProvider, ChannelType };
