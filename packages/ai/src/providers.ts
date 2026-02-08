/**
 * Multi-Provider AI Support
 *
 * Supports:
 * - OpenAI (GPT-4o, GPT-5, o1, o3)
 * - Anthropic (Claude Sonnet, Opus, Haiku)
 * - Google (Gemini Pro, Flash, Ultra)
 * - xAI (Grok)
 * - Ollama (Local models - Llama, Mistral, Phi, etc.)
 * - LM Studio (Local models via OpenAI-compatible API)
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { createLogger } from '@substrate/observability';

let _logger: ReturnType<typeof createLogger> | null = null;
function getLogger() {
  if (!_logger) _logger = createLogger({ component: 'ai-providers' });
  return _logger;
}

// ===========================================
// PROVIDER TYPES
// ===========================================

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'ollama' | 'lmstudio';

export interface ProviderConfig {
  openai?: {
    apiKey: string;
    organizationId?: string;
  };
  anthropic?: {
    apiKey: string;
  };
  google?: {
    apiKey: string;
  };
  xai?: {
    apiKey: string;
  };
  deepseek?: {
    apiKey: string;
  };
  ollama?: {
    baseUrl?: string; // Default: http://localhost:11434
  };
  lmstudio?: {
    baseUrl?: string; // Default: http://localhost:1234
  };
}

export interface ModelInfo {
  provider: AIProvider;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  isReasoning?: boolean;
  isEmbedding?: boolean;
  isFast?: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

// ===========================================
// MODEL REGISTRY (Updated January 2026)
// ===========================================

export const MODELS: Record<string, ModelInfo> = {
  // ===== OpenAI Models (January 2026) =====

  // GPT-5 Series (Latest flagship)
  'gpt-5': {
    provider: 'openai',
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    contextWindow: 256000,
    maxOutput: 32768,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
  },
  'gpt-5-mini': {
    provider: 'openai',
    modelId: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    contextWindow: 128000,
    maxOutput: 16384,
    isFast: true,
    costPer1kInput: 0.0003,
    costPer1kOutput: 0.001,
  },

  // GPT-4 Series (Still available)
  'gpt-4o': {
    provider: 'openai',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutput: 16384,
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
  },
  'gpt-4o-mini': {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutput: 16384,
    isFast: true,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
  'gpt-4.1': {
    provider: 'openai',
    modelId: 'gpt-4.1',
    displayName: 'GPT-4.1 (Code)',
    contextWindow: 1047552,
    maxOutput: 32768,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.008,
  },

  // o-Series Reasoning Models
  'o3': {
    provider: 'openai',
    modelId: 'o3',
    displayName: 'o3',
    contextWindow: 200000,
    maxOutput: 100000,
    isReasoning: true,
    costPer1kInput: 0.01,
    costPer1kOutput: 0.04,
  },
  'o3-pro': {
    provider: 'openai',
    modelId: 'o3-pro',
    displayName: 'o3 Pro',
    contextWindow: 200000,
    maxOutput: 100000,
    isReasoning: true,
    costPer1kInput: 0.02,
    costPer1kOutput: 0.08,
  },
  'o4-mini': {
    provider: 'openai',
    modelId: 'o4-mini',
    displayName: 'o4 Mini',
    contextWindow: 200000,
    maxOutput: 100000,
    isReasoning: true,
    isFast: true,
    costPer1kInput: 0.0011,
    costPer1kOutput: 0.0044,
  },
  'o1': {
    provider: 'openai',
    modelId: 'o1',
    displayName: 'o1',
    contextWindow: 200000,
    maxOutput: 100000,
    isReasoning: true,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.06,
  },

  // ===== Anthropic Models (January 2026) =====

  // Claude 4.5 Series (Latest)
  'claude-opus-4-5': {
    provider: 'anthropic',
    modelId: 'claude-opus-4-5-20251101',
    displayName: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutput: 64000,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.025,
  },
  'claude-sonnet-4-5': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5-20250929',
    displayName: 'Claude Sonnet 4.5',
    contextWindow: 1000000, // 1M context preview
    maxOutput: 64000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  'claude-haiku-4-5': {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200000,
    maxOutput: 64000,
    isFast: true,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.005,
  },

  // Claude 4 Series (Legacy but available)
  'claude-sonnet-4': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    contextWindow: 1000000, // 1M context preview
    maxOutput: 64000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },

  // ===== Google Models (January 2026) =====

  // Gemini 3 Series (Latest)
  'gemini-3-pro': {
    provider: 'google',
    modelId: 'gemini-3.0-pro',
    displayName: 'Gemini 3 Pro',
    contextWindow: 2000000,
    maxOutput: 16384,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
  },
  'gemini-3-flash': {
    provider: 'google',
    modelId: 'gemini-3.0-flash',
    displayName: 'Gemini 3 Flash',
    contextWindow: 1000000,
    maxOutput: 8192,
    isFast: true,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
  },
  'gemini-3-deep-think': {
    provider: 'google',
    modelId: 'gemini-3.0-deep-think',
    displayName: 'Gemini 3 Deep Think',
    contextWindow: 1000000,
    maxOutput: 32768,
    isReasoning: true,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.004,
  },

  // Gemini 2.5 (Legacy but stable)
  'gemini-2.5-pro': {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 2000000,
    maxOutput: 8192,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
  },

  // ===== xAI Models (January 2026) =====

  // Grok 4 Series (Latest)
  'grok-4': {
    provider: 'xai',
    modelId: 'grok-4',
    displayName: 'Grok 4',
    contextWindow: 131072,
    maxOutput: 32768,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  'grok-4.1-fast': {
    provider: 'xai',
    modelId: 'grok-4-1-fast-reasoning',
    displayName: 'Grok 4.1 Fast',
    contextWindow: 131072,
    maxOutput: 32768,
    isFast: true,
    isReasoning: true,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.01,
  },
  'grok-code': {
    provider: 'xai',
    modelId: 'grok-code-fast-1',
    displayName: 'Grok Code',
    contextWindow: 131072,
    maxOutput: 32768,
    isFast: true,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.01,
  },

  // Grok 3 Series
  'grok-3': {
    provider: 'xai',
    modelId: 'grok-3',
    displayName: 'Grok 3',
    contextWindow: 131072,
    maxOutput: 32768,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.01,
  },
  'grok-3-mini': {
    provider: 'xai',
    modelId: 'grok-3-mini',
    displayName: 'Grok 3 Mini',
    contextWindow: 131072,
    maxOutput: 16384,
    isFast: true,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.005,
  },

  // Grok 2 (Legacy)
  'grok-2-vision': {
    provider: 'xai',
    modelId: 'grok-2-vision-1212',
    displayName: 'Grok 2 Vision',
    contextWindow: 32768,
    maxOutput: 8192,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.01,
  },

  // ===== DeepSeek Models (via API) =====
  'deepseek-v3': {
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek V3.2',
    contextWindow: 64000,
    maxOutput: 8192,
    costPer1kInput: 0.00014,
    costPer1kOutput: 0.00028,
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    modelId: 'deepseek-reasoner',
    displayName: 'DeepSeek Reasoner',
    contextWindow: 64000,
    maxOutput: 8192,
    isReasoning: true,
    costPer1kInput: 0.00055,
    costPer1kOutput: 0.00219,
  },

  // ===== Ollama Local Models (Free) =====
  'llama3.3': {
    provider: 'ollama',
    modelId: 'llama3.3',
    displayName: 'Llama 3.3 70B',
    contextWindow: 128000,
    maxOutput: 8192,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
  'llama3.2': {
    provider: 'ollama',
    modelId: 'llama3.2',
    displayName: 'Llama 3.2 3B',
    contextWindow: 128000,
    maxOutput: 8192,
    isFast: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
  'mistral': {
    provider: 'ollama',
    modelId: 'mistral',
    displayName: 'Mistral 7B',
    contextWindow: 32000,
    maxOutput: 8192,
    isFast: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
  'mixtral': {
    provider: 'ollama',
    modelId: 'mixtral',
    displayName: 'Mixtral 8x7B',
    contextWindow: 32000,
    maxOutput: 8192,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
  'phi4': {
    provider: 'ollama',
    modelId: 'phi4',
    displayName: 'Phi-4 14B',
    contextWindow: 16000,
    maxOutput: 4096,
    isFast: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
  'qwen2.5': {
    provider: 'ollama',
    modelId: 'qwen2.5',
    displayName: 'Qwen 2.5 7B',
    contextWindow: 128000,
    maxOutput: 8192,
    isFast: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
  'deepseek-r1-local': {
    provider: 'ollama',
    modelId: 'deepseek-r1',
    displayName: 'DeepSeek R1 (Local)',
    contextWindow: 64000,
    maxOutput: 8192,
    isReasoning: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
  'codellama': {
    provider: 'ollama',
    modelId: 'codellama',
    displayName: 'Code Llama 7B',
    contextWindow: 16000,
    maxOutput: 4096,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  },
};

// ===========================================
// PROVIDER CLIENTS
// ===========================================

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let googleClient: GoogleGenerativeAI | null = null;
let xaiClient: OpenAI | null = null; // xAI uses OpenAI-compatible API
let deepseekClient: OpenAI | null = null; // DeepSeek uses OpenAI-compatible API
let ollamaClient: OpenAI | null = null; // Ollama uses OpenAI-compatible API
let lmstudioClient: OpenAI | null = null; // LM Studio uses OpenAI-compatible API

let providerConfig: ProviderConfig = {};

/**
 * Initialize all AI providers
 */
export function initializeProviders(config: ProviderConfig): void {
  providerConfig = config;
  const logger = getLogger();

  // OpenAI
  if (config.openai?.apiKey) {
    const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey: config.openai.apiKey };
    if (config.openai.organizationId) opts.organization = config.openai.organizationId;
    openaiClient = new OpenAI(opts);
    logger.info('OpenAI client initialized');
  }

  // Anthropic
  if (config.anthropic?.apiKey) {
    anthropicClient = new Anthropic({ apiKey: config.anthropic.apiKey });
    logger.info('Anthropic client initialized');
  }

  // Google Gemini
  if (config.google?.apiKey) {
    googleClient = new GoogleGenerativeAI(config.google.apiKey);
    logger.info('Google Gemini client initialized');
  }

  // xAI (Grok) - OpenAI-compatible API
  if (config.xai?.apiKey) {
    xaiClient = new OpenAI({
      apiKey: config.xai.apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
    logger.info('xAI (Grok) client initialized');
  }

  // DeepSeek - OpenAI-compatible API
  if (config.deepseek?.apiKey) {
    deepseekClient = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
    logger.info('DeepSeek client initialized');
  }

  // Ollama - Local, no API key needed
  if (config.ollama) {
    const baseUrl = config.ollama.baseUrl || 'http://localhost:11434';
    ollamaClient = new OpenAI({
      apiKey: 'ollama', // Ollama doesn't need a key but OpenAI SDK requires one
      baseURL: `${baseUrl}/v1`,
    });
    logger.info({ baseUrl }, 'Ollama client initialized');
  }

  // LM Studio - Local, no API key needed
  if (config.lmstudio) {
    const baseUrl = config.lmstudio.baseUrl || 'http://localhost:1234';
    lmstudioClient = new OpenAI({
      apiKey: 'lm-studio', // LM Studio doesn't need a key
      baseURL: `${baseUrl}/v1`,
    });
    logger.info({ baseUrl }, 'LM Studio client initialized');
  }
}

/**
 * Check if a provider is available
 */
export function isProviderAvailable(provider: AIProvider): boolean {
  switch (provider) {
    case 'openai':
      return openaiClient !== null;
    case 'anthropic':
      return anthropicClient !== null;
    case 'google':
      return googleClient !== null;
    case 'xai':
      return xaiClient !== null;
    case 'deepseek':
      return deepseekClient !== null;
    case 'ollama':
      return ollamaClient !== null;
    case 'lmstudio':
      return lmstudioClient !== null;
    default:
      return false;
  }
}

/**
 * Get list of available providers
 */
export function getAvailableProviders(): AIProvider[] {
  const providers: AIProvider[] = [];
  if (openaiClient) providers.push('openai');
  if (anthropicClient) providers.push('anthropic');
  if (googleClient) providers.push('google');
  if (xaiClient) providers.push('xai');
  if (deepseekClient) providers.push('deepseek');
  if (ollamaClient) providers.push('ollama');
  if (lmstudioClient) providers.push('lmstudio');
  return providers;
}

/**
 * Get available models for a provider
 */
export function getModelsForProvider(provider: AIProvider): ModelInfo[] {
  return Object.values(MODELS).filter(m => m.provider === provider);
}

// ===========================================
// COMPLETION INTERFACE
// ===========================================

export interface ProviderCompletionOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Complete with a specific provider and model
 */
export async function completeWithProvider(
  prompt: string,
  options: ProviderCompletionOptions
): Promise<string> {
  const modelInfo = MODELS[options.model];
  if (!modelInfo) {
    throw new Error(`Unknown model: ${options.model}`);
  }

  const provider = modelInfo.provider;

  switch (provider) {
    case 'openai':
      return completeOpenAI(prompt, modelInfo.modelId, options);
    case 'anthropic':
      return completeAnthropic(prompt, modelInfo.modelId, options);
    case 'google':
      return completeGoogle(prompt, modelInfo.modelId, options);
    case 'xai':
      return completeXAI(prompt, modelInfo.modelId, options);
    case 'deepseek':
      return completeDeepSeek(prompt, modelInfo.modelId, options);
    case 'ollama':
      return completeOllama(prompt, modelInfo.modelId, options);
    case 'lmstudio':
      return completeLMStudio(prompt, modelInfo.modelId, options);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// ===========================================
// PROVIDER-SPECIFIC COMPLETIONS
// ===========================================

async function completeOpenAI(
  prompt: string,
  modelId: string,
  options: ProviderCompletionOptions
): Promise<string> {
  if (!openaiClient) {
    throw new Error('OpenAI not initialized');
  }

  // Check if this is a reasoning model (o1, o3, o4-mini, etc.) or gpt-5 - they don't support temperature
  const isReasoningModel = modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4');
  const noTemperatureSupport = isReasoningModel || modelId.startsWith('gpt-5');

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  // Reasoning models also don't support system messages - use developer role instead
  if (options.systemPrompt) {
    if (isReasoningModel) {
      messages.push({ role: 'developer' as 'system', content: options.systemPrompt });
    } else {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
  }
  messages.push({ role: 'user', content: prompt });

  // Build request params - some models have limited parameter support
  // Explicitly set stream: false to ensure TypeScript knows we get ChatCompletion
  if (noTemperatureSupport) {
    // Reasoning models and gpt-5 don't support temperature
    const response = await openaiClient.chat.completions.create({
      model: modelId,
      max_completion_tokens: options.maxTokens ?? 4096,
      messages,
      stream: false,
    });
    return response.choices[0]?.message?.content ?? '';
  }

  // Standard models support temperature
  const response = await openaiClient.chat.completions.create({
    model: modelId,
    max_completion_tokens: options.maxTokens ?? 4096,
    messages,
    stream: false,
    temperature: options.temperature ?? 0,
  });

  return response.choices[0]?.message?.content ?? '';
}

async function completeAnthropic(
  prompt: string,
  modelId: string,
  options: ProviderCompletionOptions
): Promise<string> {
  if (!anthropicClient) {
    throw new Error('Anthropic not initialized');
  }

  const params: Parameters<typeof anthropicClient.messages.create>[0] = {
    model: modelId,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0,
    messages: [{ role: 'user', content: prompt }],
  };

  if (options.systemPrompt) {
    params.system = options.systemPrompt;
  }

  const response = await anthropicClient.messages.create(params);
  // Handle response content - extract text from Message response
  if ('content' in response && Array.isArray(response.content)) {
    const textBlock = response.content.find((c: Anthropic.ContentBlock): c is Anthropic.TextBlock => c.type === 'text');
    return textBlock?.text ?? '';
  }
  return '';
}

async function completeGoogle(
  prompt: string,
  modelId: string,
  options: ProviderCompletionOptions
): Promise<string> {
  if (!googleClient) {
    throw new Error('Google Gemini not initialized');
  }

  const modelConfig: Parameters<typeof googleClient.getGenerativeModel>[0] = {
    model: modelId,
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0,
    },
  };
  if (options.systemPrompt) {
    modelConfig.systemInstruction = options.systemPrompt;
  }
  const model = googleClient.getGenerativeModel(modelConfig);

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function completeXAI(
  prompt: string,
  modelId: string,
  options: ProviderCompletionOptions
): Promise<string> {
  if (!xaiClient) {
    throw new Error('xAI (Grok) not initialized');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await xaiClient.chat.completions.create({
    model: modelId,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0,
    messages,
  });

  return response.choices[0]?.message?.content ?? '';
}

async function completeDeepSeek(
  prompt: string,
  modelId: string,
  options: ProviderCompletionOptions
): Promise<string> {
  if (!deepseekClient) {
    throw new Error('DeepSeek not initialized');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await deepseekClient.chat.completions.create({
    model: modelId,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0,
    messages,
  });

  return response.choices[0]?.message?.content ?? '';
}

async function completeOllama(
  prompt: string,
  modelId: string,
  options: ProviderCompletionOptions
): Promise<string> {
  if (!ollamaClient) {
    throw new Error('Ollama not initialized. Make sure Ollama is running locally.');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    const response = await ollamaClient.chat.completions.create({
      model: modelId,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0,
      messages,
    });

    return response.choices[0]?.message?.content ?? '';
  } catch (error) {
    const logger = getLogger();
    logger.error({ error, modelId }, 'Ollama completion failed - is Ollama running?');
    throw new Error(`Ollama completion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function completeLMStudio(
  prompt: string,
  modelId: string,
  options: ProviderCompletionOptions
): Promise<string> {
  if (!lmstudioClient) {
    throw new Error('LM Studio not initialized. Make sure LM Studio is running locally.');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    const response = await lmstudioClient.chat.completions.create({
      model: modelId,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0,
      messages,
    });

    return response.choices[0]?.message?.content ?? '';
  } catch (error) {
    const logger = getLogger();
    logger.error({ error, modelId }, 'LM Studio completion failed - is LM Studio running?');
    throw new Error(`LM Studio completion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ===========================================
// OLLAMA-SPECIFIC UTILITIES
// ===========================================

/**
 * List available Ollama models
 */
export async function listOllamaModels(): Promise<string[]> {
  if (!ollamaClient) {
    return [];
  }

  try {
    const response = await ollamaClient.models.list();
    return response.data.map(m => m.id);
  } catch (error) {
    getLogger().warn({ error }, 'Failed to list Ollama models');
    return [];
  }
}

/**
 * Check if Ollama is running
 */
export async function isOllamaRunning(): Promise<boolean> {
  if (!ollamaClient) return false;

  try {
    await ollamaClient.models.list();
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull an Ollama model
 */
export async function pullOllamaModel(modelName: string): Promise<void> {
  const baseUrl = providerConfig.ollama?.baseUrl || 'http://localhost:11434';

  const response = await fetch(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
  });

  if (!response.ok) {
    throw new Error(`Failed to pull model: ${response.statusText}`);
  }
}

// ===========================================
// EMBEDDING SUPPORT (Multi-Provider)
// ===========================================

export interface EmbeddingOptions {
  provider?: 'openai' | 'ollama';
  model?: string;
  dimensions?: number;
}

/**
 * Generate embeddings with provider choice
 */
export async function generateEmbeddingWithProvider(
  text: string,
  options: EmbeddingOptions = {}
): Promise<number[]> {
  const provider = options.provider || 'openai';

  if (provider === 'openai') {
    if (!openaiClient) {
      throw new Error('OpenAI not initialized for embeddings');
    }

    const response = await openaiClient.embeddings.create({
      model: options.model || 'text-embedding-3-large',
      input: text,
      dimensions: options.dimensions || 1536,
    });

    return response.data[0]?.embedding ?? [];
  }

  if (provider === 'ollama') {
    if (!ollamaClient) {
      throw new Error('Ollama not initialized for embeddings');
    }

    const baseUrl = providerConfig.ollama?.baseUrl || 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || 'nomic-embed-text',
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }

    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

// ===========================================
// PROVIDER HEALTH CHECKS
// ===========================================

export interface ProviderHealth {
  provider: AIProvider;
  available: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Check health of all configured providers
 */
export async function checkProviderHealth(): Promise<ProviderHealth[]> {
  const results: ProviderHealth[] = [];
  const providers = getAvailableProviders();

  for (const provider of providers) {
    const start = Date.now();
    try {
      // Simple ping - just list models or do minimal operation
      switch (provider) {
        case 'openai':
          await openaiClient!.models.list();
          break;
        case 'anthropic':
          // Anthropic doesn't have a models.list, just mark as available
          break;
        case 'google':
          // Google client is synchronous init
          break;
        case 'xai':
          await xaiClient!.models.list();
          break;
        case 'deepseek':
          await deepseekClient!.models.list();
          break;
        case 'ollama':
          await ollamaClient!.models.list();
          break;
        case 'lmstudio':
          await lmstudioClient!.models.list();
          break;
      }

      results.push({
        provider,
        available: true,
        latencyMs: Date.now() - start,
      });
    } catch (error) {
      results.push({
        provider,
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}
