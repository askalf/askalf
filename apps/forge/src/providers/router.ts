/**
 * Intelligent Provider Router
 * Selects the best provider for a request based on model compatibility,
 * capability matching, cost optimization, and fallback chains.
 */

import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from './interface.js';
import type { ProviderRegistry } from './registry.js';

/** Provider capabilities for routing decisions. */
export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  supportsVision: boolean;
}

/** Known capabilities for built-in provider types. */
const KNOWN_CAPABILITIES: Record<string, ProviderCapabilities> = {
  anthropic: {
    supportsTools: true,
    supportsStreaming: true,
    supportsEmbeddings: false,
    supportsVision: true,
  },
  openai: {
    supportsTools: true,
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
  },
  google: {
    supportsTools: true,
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
  },
  ollama: {
    supportsTools: true,
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: false,
  },
  custom: {
    supportsTools: true,
    supportsStreaming: true,
    supportsEmbeddings: false,
    supportsVision: false,
  },
};

/** Cost tiers for providers (lower = cheaper). Used for cost-optimized routing. */
const PROVIDER_COST_TIER: Record<string, number> = {
  ollama: 0,      // Free (local)
  google: 1,      // Generally cheaper
  openai: 2,      // Mid-range
  anthropic: 3,   // Premium
  custom: 1,      // Unknown, assume cheap
};

/** Preferences for provider selection. */
export interface RoutingPreferences {
  /** Preferred provider name (try this first). */
  preferredProvider?: string;

  /** Ordered list of provider names to try as fallbacks. */
  fallbackChain?: string[];

  /** Whether to optimize for cost (pick cheapest capable provider). */
  costOptimized?: boolean;

  /** Required capabilities that the provider must support. */
  requiredCapabilities?: Partial<ProviderCapabilities>;

  /** Maximum number of fallback attempts before giving up. */
  maxRetries?: number;
}

/** Result of a provider selection. */
export interface RoutingResult {
  providerName: string;
  adapter: IProviderAdapter;
}

/** Error thrown when no suitable provider can be found. */
export class NoProviderError extends Error {
  constructor(
    message: string,
    public readonly attemptedProviders: string[],
  ) {
    super(message);
    this.name = 'NoProviderError';
  }
}

export class ProviderRouter {
  private readonly registry: ProviderRegistry;

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  /**
   * Select the best provider for the given request and preferences.
   * Considers model compatibility, capabilities, cost, and availability.
   */
  async selectProvider(
    request: CompletionRequest,
    preferences?: RoutingPreferences,
  ): Promise<RoutingResult> {
    const prefs = preferences ?? {};

    // Determine required capabilities from the request
    const requiredCaps: Partial<ProviderCapabilities> = {
      ...prefs.requiredCapabilities,
    };

    if (request.tools && request.tools.length > 0) {
      requiredCaps.supportsTools = true;
    }
    if (request.stream === true) {
      requiredCaps.supportsStreaming = true;
    }

    // Step 1: If a model is specified, try to find its natural provider
    if (request.model) {
      const modelProvider = await this.registry.findModelProvider(request.model);
      if (modelProvider) {
        const adapter = this.registry.get(modelProvider.providerName);
        if (adapter && this.meetsCapabilities(adapter, requiredCaps)) {
          return { providerName: modelProvider.providerName, adapter };
        }
      }
    }

    // Step 2: Try the preferred provider
    if (prefs.preferredProvider) {
      const adapter = this.registry.get(prefs.preferredProvider);
      if (adapter && this.meetsCapabilities(adapter, requiredCaps)) {
        return { providerName: prefs.preferredProvider, adapter };
      }
    }

    // Step 3: Try the fallback chain
    if (prefs.fallbackChain) {
      for (const name of prefs.fallbackChain) {
        const adapter = this.registry.get(name);
        if (adapter && this.meetsCapabilities(adapter, requiredCaps)) {
          return { providerName: name, adapter };
        }
      }
    }

    // Step 4: Cost-optimized selection among all available providers
    if (prefs.costOptimized) {
      const result = this.selectCheapest(requiredCaps);
      if (result) {
        return result;
      }
    }

    // Step 5: Return any available provider that meets capabilities
    const allProviders = this.registry.getAll();
    for (const [name, adapter] of allProviders) {
      if (this.meetsCapabilities(adapter, requiredCaps)) {
        return { providerName: name, adapter };
      }
    }

    const attemptedProviders = allProviders.map(([name]) => name);
    throw new NoProviderError(
      `No provider found that meets the required capabilities for model "${request.model ?? 'unspecified'}"`,
      attemptedProviders,
    );
  }

  /**
   * Execute a completion with automatic fallback.
   * Tries providers in order until one succeeds.
   */
  async completeWithFallback(
    request: CompletionRequest,
    preferences?: RoutingPreferences,
  ): Promise<CompletionResponse & { providerName: string }> {
    const prefs = preferences ?? {};
    const maxRetries = prefs.maxRetries ?? 2;
    const chain = this.buildFallbackChain(request, prefs);
    const attemptedProviders: string[] = [];
    const errors: Error[] = [];

    for (let i = 0; i < Math.min(chain.length, maxRetries + 1); i++) {
      const entry = chain[i];
      if (!entry) continue;

      const { providerName, adapter } = entry;
      attemptedProviders.push(providerName);

      try {
        const response = await adapter.complete(request);
        return { ...response, providerName };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        console.warn(
          `[ProviderRouter] Provider "${providerName}" failed:`,
          error.message,
        );
      }
    }

    throw new NoProviderError(
      `All providers failed for model "${request.model ?? 'unspecified'}". ` +
      `Errors: ${errors.map((e) => e.message).join('; ')}`,
      attemptedProviders,
    );
  }

  /**
   * Stream a completion with automatic fallback.
   * Tries providers in order until one succeeds.
   */
  async *streamWithFallback(
    request: CompletionRequest,
    preferences?: RoutingPreferences,
  ): AsyncIterable<StreamChunk & { providerName?: string }> {
    const prefs = preferences ?? {};
    const maxRetries = prefs.maxRetries ?? 2;
    const chain = this.buildFallbackChain(request, prefs);
    const attemptedProviders: string[] = [];
    const errors: Error[] = [];

    for (let i = 0; i < Math.min(chain.length, maxRetries + 1); i++) {
      const entry = chain[i];
      if (!entry) continue;

      const { providerName, adapter } = entry;
      attemptedProviders.push(providerName);

      try {
        for await (const chunk of adapter.stream(request)) {
          yield { ...chunk, providerName };
        }
        return; // Success, stop trying
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        console.warn(
          `[ProviderRouter] Provider "${providerName}" streaming failed:`,
          error.message,
        );
      }
    }

    yield {
      type: 'error',
      error:
        `All providers failed for model "${request.model ?? 'unspecified'}". ` +
        `Errors: ${errors.map((e) => e.message).join('; ')}`,
    };
  }

  /**
   * Get the capabilities of a provider by name or adapter.
   */
  getCapabilities(providerOrName: string | IProviderAdapter): ProviderCapabilities {
    const providerType =
      typeof providerOrName === 'string'
        ? this.registry.get(providerOrName)?.type ?? providerOrName
        : providerOrName.type;

    const known = KNOWN_CAPABILITIES[providerType];
    if (known) {
      return { ...known };
    }

    // Default: assume basic capabilities
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsEmbeddings: false,
      supportsVision: false,
    };
  }

  /**
   * Check if a provider meets the required capabilities.
   */
  private meetsCapabilities(
    adapter: IProviderAdapter,
    required: Partial<ProviderCapabilities>,
  ): boolean {
    const caps = this.getCapabilities(adapter);

    if (required.supportsTools === true && !caps.supportsTools) {
      return false;
    }
    if (required.supportsStreaming === true && !caps.supportsStreaming) {
      return false;
    }
    if (required.supportsEmbeddings === true && !caps.supportsEmbeddings) {
      return false;
    }
    if (required.supportsVision === true && !caps.supportsVision) {
      return false;
    }

    return true;
  }

  /**
   * Select the cheapest provider that meets capabilities.
   */
  private selectCheapest(
    required: Partial<ProviderCapabilities>,
  ): RoutingResult | undefined {
    const allProviders = this.registry.getAll();

    let bestResult: RoutingResult | undefined;
    let bestCost = Infinity;

    for (const [name, adapter] of allProviders) {
      if (!this.meetsCapabilities(adapter, required)) {
        continue;
      }

      const cost = PROVIDER_COST_TIER[adapter.type] ?? 5;
      if (cost < bestCost) {
        bestCost = cost;
        bestResult = { providerName: name, adapter };
      }
    }

    return bestResult;
  }

  /**
   * Build an ordered fallback chain of providers for a request.
   */
  private buildFallbackChain(
    request: CompletionRequest,
    preferences: RoutingPreferences,
  ): RoutingResult[] {
    const chain: RoutingResult[] = [];
    const seen = new Set<string>();

    const requiredCaps: Partial<ProviderCapabilities> = {
      ...preferences.requiredCapabilities,
    };
    if (request.tools && request.tools.length > 0) {
      requiredCaps.supportsTools = true;
    }
    if (request.stream === true) {
      requiredCaps.supportsStreaming = true;
    }

    // Helper to add a provider if it meets capabilities
    const tryAdd = (name: string): void => {
      if (seen.has(name)) return;
      const adapter = this.registry.get(name);
      if (adapter && this.meetsCapabilities(adapter, requiredCaps)) {
        chain.push({ providerName: name, adapter });
        seen.add(name);
      }
    };

    // 1. Preferred provider first
    if (preferences.preferredProvider) {
      tryAdd(preferences.preferredProvider);
    }

    // 2. Natural provider for the model
    if (request.model) {
      const lower = request.model.toLowerCase();
      if (lower.startsWith('claude-')) tryAdd('anthropic');
      else if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) tryAdd('openai');
      else if (lower.startsWith('gemini-')) tryAdd('google');
    }

    // 3. Explicit fallback chain
    if (preferences.fallbackChain) {
      for (const name of preferences.fallbackChain) {
        tryAdd(name);
      }
    }

    // 4. Remaining providers sorted by cost
    const allProviders = this.registry.getAll();
    const sorted = allProviders.sort(([, a], [, b]) => {
      const costA = PROVIDER_COST_TIER[a.type] ?? 5;
      const costB = PROVIDER_COST_TIER[b.type] ?? 5;
      return costA - costB;
    });

    for (const [name] of sorted) {
      tryAdd(name);
    }

    return chain;
  }
}
