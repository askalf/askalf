/**
 * Provider Registry — Factory for LLM providers
 */

import type { LLMProvider } from './types.js';
import { claudeProvider } from './claude.js';
import { openaiProvider } from './openai.js';

const providers = new Map<string, LLMProvider>();

providers.set('claude', claudeProvider);
providers.set('openai', openaiProvider);

export function getProvider(id: string): LLMProvider | undefined {
  return providers.get(id);
}

export function getAllProviders(): LLMProvider[] {
  return Array.from(providers.values());
}

export function getProviderModels(): Record<string, { name: string; models: string[]; defaultModel: string }> {
  const result: Record<string, { name: string; models: string[]; defaultModel: string }> = {};
  for (const p of providers.values()) {
    result[p.id] = { name: p.name, models: p.models, defaultModel: p.defaultModel };
  }
  return result;
}
