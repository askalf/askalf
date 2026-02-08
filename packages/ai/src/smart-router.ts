/**
 * Smart Router - Intelligent Model Selection
 *
 * Routes queries to the smallest capable model, reducing compute by up to 90%
 * for simple tasks while ensuring complex queries get appropriate processing power.
 *
 * Tiers:
 * - Nano: Simple queries, greetings, basic Q&A (GPT-5 Mini, Claude Haiku, Gemini Flash)
 * - Pro: Standard queries, code help, analysis (GPT-5, Claude Sonnet, Gemini Pro)
 * - Reasoning: Complex problems, math, logic chains (o3, Claude Opus, Deep Think)
 * - Local: Privacy-first, zero cloud (Ollama models when available)
 */

import { MODELS, type ModelInfo, type AIProvider, isProviderAvailable } from './providers.js';

// ===========================================
// ROUTING TIERS
// ===========================================

export type RoutingTier = 'nano' | 'pro' | 'reasoning' | 'local';

export interface RoutingDecision {
  tier: RoutingTier;
  model: string;
  provider: AIProvider;
  reason: string;
  confidence: number; // 0-1, how confident the router is in this decision
  analysisMs: number;
  signals: QuerySignals;
}

export interface QuerySignals {
  // Length and complexity
  tokenEstimate: number;
  sentenceCount: number;
  wordCount: number;

  // Content indicators
  hasCode: boolean;
  hasCodeRequest: boolean;
  hasMath: boolean;
  hasLogicChain: boolean;
  hasCreativeRequest: boolean;
  hasAnalysisRequest: boolean;
  hasSimpleQuestion: boolean;
  isGreeting: boolean;
  isFollowUp: boolean;

  // Complexity markers
  complexityScore: number; // 0-100
  reasoningRequired: boolean;
  multiStepRequired: boolean;
}

// ===========================================
// MODEL PREFERENCES BY TIER
// ===========================================

// Models ranked by preference within each tier (first available is selected)
// NOTE: OpenAI and Anthropic are prioritized first since those are currently the only
// providers with API keys configured. Other providers (Google, xAI, DeepSeek) are
// listed after for when they become available.
// NOTE: gpt-5, gpt-5-mini, and o3-pro require OpenAI organization verification
// and are listed after verified models until verification is complete.
const TIER_MODELS: Record<RoutingTier, string[]> = {
  nano: [
    // OpenAI & Anthropic first
    'gpt-4o-mini',
    'claude-haiku-4-5',
    'o4-mini',
    'gpt-5-mini',
    // Other providers (coming soon)
    'gemini-3-flash',
    'grok-3-mini',
    'deepseek-v3',
  ],
  pro: [
    // OpenAI & Anthropic first
    'claude-sonnet-4-5',
    'claude-sonnet-4',
    'gpt-4o',
    'gpt-4.1',
    'gpt-5',
    // Other providers (coming soon)
    'gemini-3-pro',
    'gemini-2.5-pro',
    'grok-4',
    'grok-3',
  ],
  reasoning: [
    // OpenAI & Anthropic first
    'claude-opus-4-5',
    'o3',
    'o1',
    'o3-pro',
    // Other providers (coming soon)
    'gemini-3-deep-think',
    'grok-4.1-fast',
    'deepseek-reasoner',
  ],
  local: [
    // Zero cloud - local models only (requires Ollama)
    'llama3.3',
    'mixtral',
    'deepseek-r1-local',
    'qwen2.5',
    'llama3.2',
    'phi4',
    'mistral',
  ],
};

// ===========================================
// QUERY ANALYSIS
// ===========================================

// Patterns for detecting query characteristics
const PATTERNS = {
  // Simple/Nano indicators
  greeting: /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|what'?s?\s+up|yo)\b/i,
  simpleQuestion: /^(what\s+is|who\s+is|when\s+was|where\s+is|how\s+old|what\s+does|define)\s+\w+/i,
  yesNoQuestion: /^(is|are|was|were|do|does|did|can|could|will|would|should)\s+/i,
  shortAnswer: /^(tell\s+me|give\s+me|what'?s)\s+(a|the|your)?\s*(name|time|date|weather)/i,

  // Code indicators
  codeBlock: /```[\s\S]*```/,
  codeKeywords: /\b(function|class|const|let|var|import|export|return|if|else|for|while|async|await|try|catch|def|public|private|void|int|string)\b/,
  codeRequest: /\b(write|create|build|implement|code|program|script|function|class|api|endpoint|component|module)\b.*\b(code|for|that|to|which)\b/i,
  debugRequest: /\b(debug|fix|error|bug|issue|problem|broken|not\s+working|doesn'?t\s+work)\b/i,

  // Math and logic
  mathSymbols: /[+\-*/=<>≤≥≠∑∏∫√π∞±×÷^²³]/,
  mathKeywords: /\b(calculate|compute|solve|equation|formula|derivative|integral|sum|product|proof|theorem|algorithm)\b/i,
  logicKeywords: /\b(if\s+then|therefore|thus|hence|implies|because|since|assuming|given\s+that|prove\s+that|follows\s+that)\b/i,

  // Complex reasoning
  multiStep: /\b(first|then|next|after\s+that|finally|step\s+by\s+step|explain\s+(how|why)|walk\s+me\s+through)\b/i,
  comparison: /\b(compare|contrast|difference\s+between|versus|vs\.?|pros\s+and\s+cons|advantages|disadvantages)\b/i,
  analysis: /\b(analyze|analyse|evaluate|assess|review|examine|investigate|study|research|deep\s+dive)\b/i,
  creative: /\b(write|compose|create|generate|design|imagine|story|poem|essay|article|blog|script|narrative)\b/i,

  // Follow-up indicators
  followUp: /^(and\s+|also\s+|what\s+about|how\s+about|can\s+you\s+also|one\s+more|another\s+question)/i,
  continuation: /^(yes|no|ok|okay|sure|thanks|thank\s+you|got\s+it|i\s+see|makes\s+sense)/i,
};

/**
 * Analyze a query to extract routing signals
 */
export function analyzeQuery(query: string, conversationHistory?: string[]): QuerySignals {
  const words = query.split(/\s+/).filter(w => w.length > 0);
  const sentences = query.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // Estimate tokens (rough: 1 token ≈ 4 characters for English)
  const tokenEstimate = Math.ceil(query.length / 4);

  // Detect patterns
  const hasCode = PATTERNS.codeBlock.test(query) || PATTERNS.codeKeywords.test(query);
  const hasCodeRequest = PATTERNS.codeRequest.test(query) || PATTERNS.debugRequest.test(query);
  const hasMath = PATTERNS.mathSymbols.test(query) || PATTERNS.mathKeywords.test(query);
  const hasLogicChain = PATTERNS.logicKeywords.test(query);
  const hasCreativeRequest = PATTERNS.creative.test(query);
  const hasAnalysisRequest = PATTERNS.analysis.test(query) || PATTERNS.comparison.test(query);
  const hasSimpleQuestion = PATTERNS.simpleQuestion.test(query) || PATTERNS.yesNoQuestion.test(query) || PATTERNS.shortAnswer.test(query);
  const isGreeting = PATTERNS.greeting.test(query);
  const isFollowUp = PATTERNS.followUp.test(query) || PATTERNS.continuation.test(query);
  const multiStepRequired = PATTERNS.multiStep.test(query);

  // Calculate complexity score (0-100)
  let complexityScore = 0;

  // Length factors
  if (tokenEstimate > 500) complexityScore += 25;
  else if (tokenEstimate > 200) complexityScore += 15;
  else if (tokenEstimate > 50) complexityScore += 5;

  // Content factors
  if (hasCode) complexityScore += 15;
  if (hasCodeRequest) complexityScore += 20;
  if (hasMath) complexityScore += 25;
  if (hasLogicChain) complexityScore += 30;
  if (hasCreativeRequest) complexityScore += 15;
  if (hasAnalysisRequest) complexityScore += 20;
  if (multiStepRequired) complexityScore += 25;

  // Simplicity factors (reduce score)
  if (isGreeting) complexityScore -= 30;
  if (hasSimpleQuestion && !hasCodeRequest && !hasMath) complexityScore -= 20;
  if (isFollowUp && words.length < 10) complexityScore -= 10;

  // Normalize to 0-100
  complexityScore = Math.max(0, Math.min(100, complexityScore));

  // Determine if reasoning is required
  const reasoningRequired = hasMath || hasLogicChain || (complexityScore > 60);

  return {
    tokenEstimate,
    sentenceCount: sentences.length,
    wordCount: words.length,
    hasCode,
    hasCodeRequest,
    hasMath,
    hasLogicChain,
    hasCreativeRequest,
    hasAnalysisRequest,
    hasSimpleQuestion,
    isGreeting,
    isFollowUp,
    complexityScore,
    reasoningRequired,
    multiStepRequired,
  };
}

// ===========================================
// TIER SELECTION
// ===========================================

/**
 * Determine the appropriate tier based on query signals
 */
export function selectTier(signals: QuerySignals, preferLocal: boolean = false): { tier: RoutingTier; reason: string; confidence: number } {
  // Local preference overrides everything (privacy mode)
  if (preferLocal) {
    return {
      tier: 'local',
      reason: 'Local mode enabled - zero cloud routing',
      confidence: 1.0,
    };
  }

  // Reasoning tier for complex tasks
  if (signals.reasoningRequired) {
    return {
      tier: 'reasoning',
      reason: signals.hasMath
        ? 'Mathematical problem detected - using reasoning model'
        : signals.hasLogicChain
          ? 'Multi-step logic detected - using reasoning model'
          : 'High complexity query - using reasoning model',
      confidence: 0.9,
    };
  }

  // Pro tier for substantial work
  if (signals.hasCodeRequest || signals.hasAnalysisRequest || signals.hasCreativeRequest) {
    return {
      tier: 'pro',
      reason: signals.hasCodeRequest
        ? 'Code task detected - using standard model'
        : signals.hasAnalysisRequest
          ? 'Analysis request - using standard model'
          : 'Creative request - using standard model',
      confidence: 0.85,
    };
  }

  // Pro tier for longer/complex queries
  if (signals.complexityScore > 40 || signals.tokenEstimate > 200) {
    return {
      tier: 'pro',
      reason: 'Moderate complexity - using standard model',
      confidence: 0.8,
    };
  }

  // Nano tier for simple stuff
  if (signals.isGreeting) {
    return {
      tier: 'nano',
      reason: 'Greeting detected - using fast model',
      confidence: 0.95,
    };
  }

  if (signals.hasSimpleQuestion && signals.wordCount < 15) {
    return {
      tier: 'nano',
      reason: 'Simple question - using fast model',
      confidence: 0.9,
    };
  }

  if (signals.isFollowUp && signals.wordCount < 20) {
    return {
      tier: 'nano',
      reason: 'Short follow-up - using fast model',
      confidence: 0.85,
    };
  }

  // Default to nano for short queries, pro otherwise
  if (signals.wordCount < 25 && signals.complexityScore < 30) {
    return {
      tier: 'nano',
      reason: 'Brief query - using fast model',
      confidence: 0.75,
    };
  }

  // Default to pro for anything else
  return {
    tier: 'pro',
    reason: 'Standard query - using balanced model',
    confidence: 0.7,
  };
}

// ===========================================
// MODEL SELECTION
// ===========================================

export interface RouterOptions {
  preferLocal?: boolean;
  preferredProvider?: AIProvider;
  excludeProviders?: AIProvider[];
  forceTier?: RoutingTier;
}

/**
 * Select the best available model for the given tier
 */
export function selectModel(
  tier: RoutingTier,
  options: RouterOptions = {}
): { model: string; provider: AIProvider } | null {
  const tierModels = TIER_MODELS[tier];

  for (const modelId of tierModels) {
    const modelInfo = MODELS[modelId];
    if (!modelInfo) continue;

    // Check exclusions
    if (options.excludeProviders?.includes(modelInfo.provider)) continue;

    // Check provider preference
    if (options.preferredProvider && modelInfo.provider !== options.preferredProvider) {
      // Still allow if nothing else available
      continue;
    }

    // Check if provider is available
    if (!isProviderAvailable(modelInfo.provider)) continue;

    return {
      model: modelId,
      provider: modelInfo.provider,
    };
  }

  // Try again without provider preference if we had one
  if (options.preferredProvider) {
    for (const modelId of tierModels) {
      const modelInfo = MODELS[modelId];
      if (!modelInfo) continue;
      if (options.excludeProviders?.includes(modelInfo.provider)) continue;
      if (!isProviderAvailable(modelInfo.provider)) continue;

      return {
        model: modelId,
        provider: modelInfo.provider,
      };
    }
  }

  return null;
}

// ===========================================
// MAIN ROUTER FUNCTION
// ===========================================

/**
 * Route a query to the most appropriate model
 *
 * @param query - The user's message
 * @param options - Router configuration options
 * @returns Routing decision with model, tier, and reasoning
 */
export function routeQuery(
  query: string,
  options: RouterOptions = {}
): RoutingDecision {
  const startTime = Date.now();

  // Analyze query
  const signals = analyzeQuery(query);

  // Force tier if specified
  let tierResult: { tier: RoutingTier; reason: string; confidence: number };
  if (options.forceTier) {
    tierResult = {
      tier: options.forceTier,
      reason: `Forced to ${options.forceTier} tier`,
      confidence: 1.0,
    };
  } else {
    tierResult = selectTier(signals, options.preferLocal);
  }

  // Select model for tier
  let modelResult = selectModel(tierResult.tier, options);

  // Fall back to adjacent tier if no model available
  if (!modelResult) {
    const fallbackOrder: Record<RoutingTier, RoutingTier[]> = {
      nano: ['pro', 'reasoning'],
      pro: ['nano', 'reasoning'],
      reasoning: ['pro', 'nano'],
      local: ['nano', 'pro'],
    };

    for (const fallbackTier of fallbackOrder[tierResult.tier]) {
      modelResult = selectModel(fallbackTier, options);
      if (modelResult) {
        tierResult.tier = fallbackTier;
        tierResult.reason += ` (fallback from ${tierResult.tier})`;
        tierResult.confidence *= 0.8;
        break;
      }
    }
  }

  // Final fallback to any available model
  if (!modelResult) {
    for (const tier of ['pro', 'nano', 'reasoning', 'local'] as RoutingTier[]) {
      const fallbackOptions: RouterOptions = {};
      if (options.excludeProviders) {
        fallbackOptions.excludeProviders = options.excludeProviders;
      }
      modelResult = selectModel(tier, fallbackOptions);
      if (modelResult) {
        tierResult.tier = tier;
        tierResult.reason = 'Limited model availability - using fallback';
        tierResult.confidence = 0.5;
        break;
      }
    }
  }

  if (!modelResult) {
    throw new Error('No available models found for routing');
  }

  return {
    tier: tierResult.tier,
    model: modelResult.model,
    provider: modelResult.provider,
    reason: tierResult.reason,
    confidence: tierResult.confidence,
    analysisMs: Date.now() - startTime,
    signals,
  };
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Get human-readable tier name
 */
export function getTierDisplayName(tier: RoutingTier): string {
  const names: Record<RoutingTier, string> = {
    nano: 'Nano',
    pro: 'Pro',
    reasoning: 'Reasoning',
    local: 'Local',
  };
  return names[tier];
}

/**
 * Get tier description
 */
export function getTierDescription(tier: RoutingTier): string {
  const descriptions: Record<RoutingTier, string> = {
    nano: 'Fast, efficient responses for simple queries',
    pro: 'Balanced capability for standard tasks',
    reasoning: 'Maximum capability for complex problems',
    local: 'Privacy-first, zero cloud processing',
  };
  return descriptions[tier];
}

/**
 * Get cost multiplier for tier (relative to nano)
 */
export function getTierCostMultiplier(tier: RoutingTier): number {
  const multipliers: Record<RoutingTier, number> = {
    nano: 1,
    pro: 2,
    reasoning: 10,
    local: 0,
  };
  return multipliers[tier];
}

/**
 * Estimate savings from smart routing vs always using pro
 */
export function estimateSavings(decisions: RoutingDecision[]): {
  totalQueries: number;
  nanoQueries: number;
  proQueries: number;
  reasoningQueries: number;
  localQueries: number;
  estimatedSavingsPercent: number;
} {
  const counts = { nano: 0, pro: 0, reasoning: 0, local: 0 };

  for (const decision of decisions) {
    counts[decision.tier]++;
  }

  // Calculate what it would have cost to use pro for everything
  const totalQueries = decisions.length;
  const withoutRouting = totalQueries * 2; // Pro tier = 2x multiplier
  const withRouting =
    counts.nano * 1 +
    counts.pro * 2 +
    counts.reasoning * 10 +
    counts.local * 0;

  const savings = withoutRouting > 0
    ? ((withoutRouting - withRouting) / withoutRouting) * 100
    : 0;

  return {
    totalQueries,
    nanoQueries: counts.nano,
    proQueries: counts.pro,
    reasoningQueries: counts.reasoning,
    localQueries: counts.local,
    estimatedSavingsPercent: Math.max(0, savings),
  };
}

// Export default router
export default {
  routeQuery,
  analyzeQuery,
  selectTier,
  selectModel,
  getTierDisplayName,
  getTierDescription,
  getTierCostMultiplier,
  estimateSavings,
};
