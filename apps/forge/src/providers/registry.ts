/**
 * Provider Registry
 * Central registry for managing LLM provider adapters.
 * Handles registration, lookup, initialization from environment, and model discovery.
 */

import type { IProviderAdapter, ModelInfo } from './interface.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { GoogleAdapter } from './adapters/google.js';
import { OllamaAdapter } from './adapters/ollama.js';
import { CustomAdapter } from './adapters/custom.js';

export interface RegistryConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleAiKey?: string;
  ollamaBaseUrl?: string;
  customProviders?: Array<{
    name: string;
    baseUrl: string;
    apiKey?: string;
    defaultModel?: string;
    supportsEmbeddings?: boolean;
  }>;
}

/** Cached model-to-provider mapping entry. */
interface ModelProviderEntry {
  providerId: string;
  model: ModelInfo;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, IProviderAdapter>();
  private modelCache: ModelProviderEntry[] | null = null;

  /**
   * Register a provider adapter under a given name.
   * If a provider with the same name already exists, it is replaced.
   */
  register(name: string, adapter: IProviderAdapter): void {
    this.providers.set(name, adapter);
    this.modelCache = null; // Invalidate cache when providers change
  }

  /**
   * Get a registered provider by name.
   * Returns undefined if not found.
   */
  get(name: string): IProviderAdapter | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers as an array of [name, adapter] pairs.
   */
  getAll(): Array<[string, IProviderAdapter]> {
    return Array.from(this.providers.entries());
  }

  /**
   * Remove a provider from the registry.
   * Returns true if the provider existed and was removed.
   */
  remove(name: string): boolean {
    const removed = this.providers.delete(name);
    if (removed) {
      this.modelCache = null;
    }
    return removed;
  }

  /**
   * Check whether a provider is registered.
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Number of registered providers.
   */
  get size(): number {
    return this.providers.size;
  }

  /**
   * Initialize default providers based on available configuration / environment variables.
   * Only providers whose API keys or endpoints are provided will be registered.
   */
  async initializeDefaults(config: RegistryConfig): Promise<void> {
    const initPromises: Array<Promise<void>> = [];

    // Anthropic
    if (config.anthropicApiKey) {
      const adapter = new AnthropicAdapter();
      initPromises.push(
        adapter.initialize({ apiKey: config.anthropicApiKey }).then(() => {
          this.register('anthropic', adapter);
        }),
      );
    }

    // OpenAI
    if (config.openaiApiKey) {
      const adapter = new OpenAIAdapter();
      initPromises.push(
        adapter.initialize({ apiKey: config.openaiApiKey }).then(() => {
          this.register('openai', adapter);
        }),
      );
    }

    // Google AI
    if (config.googleAiKey) {
      const adapter = new GoogleAdapter();
      initPromises.push(
        adapter.initialize({ apiKey: config.googleAiKey }).then(() => {
          this.register('google', adapter);
        }),
      );
    }

    // Ollama (always try to register if base URL is available or use default)
    if (config.ollamaBaseUrl !== undefined) {
      const adapter = new OllamaAdapter();
      initPromises.push(
        adapter.initialize({ baseUrl: config.ollamaBaseUrl }).then(() => {
          this.register('ollama', adapter);
        }),
      );
    }

    // Custom providers
    if (config.customProviders) {
      for (const cp of config.customProviders) {
        const adapter = new CustomAdapter(cp.name);
        initPromises.push(
          adapter.initialize({
            name: cp.name,
            baseUrl: cp.baseUrl,
            apiKey: cp.apiKey,
            defaultModel: cp.defaultModel,
            supportsEmbeddings: cp.supportsEmbeddings,
          }).then(() => {
            this.register(cp.name, adapter);
          }),
        );
      }
    }

    // Wait for all initializations, but don't fail the entire registry if one provider fails.
    const results = await Promise.allSettled(initPromises);

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[ProviderRegistry] Failed to initialize a provider:', result.reason);
      }
    }
  }

  /**
   * List models available from a specific provider.
   * Throws if the provider is not registered.
   */
  async getModelsForProvider(name: string): Promise<ModelInfo[]> {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider "${name}" is not registered`);
    }
    return provider.listModels();
  }

  /**
   * Find which provider handles a given model ID.
   * Searches all registered providers' model lists.
   * Returns the provider name and model info, or undefined if not found.
   */
  async findModelProvider(
    modelId: string,
  ): Promise<{ providerName: string; model: ModelInfo } | undefined> {
    // Check well-known prefixes first for fast lookup without API calls
    const quickMatch = this.quickModelLookup(modelId);
    if (quickMatch) {
      const provider = this.providers.get(quickMatch);
      if (provider) {
        return {
          providerName: quickMatch,
          model: { id: modelId, name: modelId },
        };
      }
    }

    // Build or use cached model-to-provider mapping
    if (!this.modelCache) {
      await this.refreshModelCache();
    }

    if (this.modelCache) {
      const entry = this.modelCache.find((e) => e.model.id === modelId);
      if (entry) {
        return {
          providerName: entry.providerId,
          model: entry.model,
        };
      }
    }

    return undefined;
  }

  /**
   * Quick prefix-based lookup for well-known model families.
   */
  private quickModelLookup(modelId: string): string | undefined {
    const lower = modelId.toLowerCase();

    // Anthropic Claude models
    if (lower.startsWith('claude-')) {
      return 'anthropic';
    }

    // OpenAI models
    if (
      lower.startsWith('gpt-') ||
      lower.startsWith('o1') ||
      lower.startsWith('o3') ||
      lower.startsWith('o4') ||
      lower.startsWith('text-embedding-') ||
      lower.startsWith('dall-e')
    ) {
      return 'openai';
    }

    // Google Gemini models
    if (lower.startsWith('gemini-')) {
      return 'google';
    }

    return undefined;
  }

  /**
   * Refresh the cached model-to-provider mapping by querying all providers.
   */
  private async refreshModelCache(): Promise<void> {
    const entries: ModelProviderEntry[] = [];

    const promises = Array.from(this.providers.entries()).map(
      async ([providerName, adapter]) => {
        try {
          const models = await adapter.listModels();
          for (const model of models) {
            entries.push({ providerId: providerName, model });
          }
        } catch {
          // Skip providers that fail to list models
        }
      },
    );

    await Promise.allSettled(promises);
    this.modelCache = entries;
  }
}
