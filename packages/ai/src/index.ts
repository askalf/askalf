import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@substrate/observability';

// Import for internal use
import {
  initializeProviders as initProviders,
  completeWithProvider,
  isProviderAvailable,
  getAvailableProviders,
  getModelsForProvider,
  listOllamaModels,
  isOllamaRunning,
  pullOllamaModel,
  generateEmbeddingWithProvider,
  checkProviderHealth,
  MODELS,
  type AIProvider,
  type ProviderConfig,
  type ModelInfo,
  type ProviderCompletionOptions,
  type ProviderHealth,
} from './providers.js';

// Re-export multi-provider support
export * from './providers.js';
export {
  completeWithProvider,
  isProviderAvailable,
  getAvailableProviders,
  getModelsForProvider,
  listOllamaModels,
  isOllamaRunning,
  pullOllamaModel,
  generateEmbeddingWithProvider,
  checkProviderHealth,
  MODELS,
  type AIProvider,
  type ProviderConfig,
  type ModelInfo,
  type ProviderCompletionOptions,
  type ProviderHealth,
};
export { initProviders as initializeProviders };

// Re-export Smart Router
export * from './smart-router.js';
export { default as SmartRouter } from './smart-router.js';

// Re-export Shard Classifier (Layer 3)
export * from './shard-classifier.js';

// Lazy logger initialization to respect LOG_LEVEL=silent
let _logger: ReturnType<typeof createLogger> | null = null;
function getLogger() {
  if (!_logger) _logger = createLogger({ component: 'ai' });
  return _logger;
}

// LLM Clients (legacy - use initializeProviders for multi-provider support)
let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

export interface AIConfig {
  anthropicApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
  openaiOrgId?: string | undefined;
  googleApiKey?: string | undefined;
  xaiApiKey?: string | undefined;
  ollamaBaseUrl?: string | undefined;
  lmstudioBaseUrl?: string | undefined;
}

/**
 * Initialize AI clients (legacy + new providers)
 */
export function initializeAI(config: AIConfig): void {
  // Legacy client init
  if (config.anthropicApiKey) {
    anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    getLogger().info('Anthropic client initialized');
  }

  if (config.openaiApiKey) {
    const openaiOpts: ConstructorParameters<typeof OpenAI>[0] = { apiKey: config.openaiApiKey };
    if (config.openaiOrgId) openaiOpts.organization = config.openaiOrgId;
    openai = new OpenAI(openaiOpts);
    getLogger().info('OpenAI client initialized');
  }

  // Initialize all providers via new system (using already imported function)
  // Build config dynamically to satisfy exactOptionalPropertyTypes
  const providerConfig: ProviderConfig = {
    ollama: { baseUrl: config.ollamaBaseUrl || 'http://localhost:11434' },
  };
  if (config.openaiApiKey) {
    const openaiConf: ProviderConfig['openai'] = { apiKey: config.openaiApiKey };
    if (config.openaiOrgId) openaiConf.organizationId = config.openaiOrgId;
    providerConfig.openai = openaiConf;
  }
  if (config.anthropicApiKey) providerConfig.anthropic = { apiKey: config.anthropicApiKey };
  if (config.googleApiKey) providerConfig.google = { apiKey: config.googleApiKey };
  if (config.xaiApiKey) providerConfig.xai = { apiKey: config.xaiApiKey };
  if (config.lmstudioBaseUrl) providerConfig.lmstudio = { baseUrl: config.lmstudioBaseUrl };

  initProviders(providerConfig);
}

/**
 * Get the Anthropic client
 */
export function getAnthropic(): Anthropic {
  if (!anthropic) {
    throw new Error('Anthropic not initialized. Call initializeAI first.');
  }
  return anthropic;
}

/**
 * Get the OpenAI client
 */
export function getOpenAI(): OpenAI {
  if (!openai) {
    throw new Error('OpenAI not initialized. Call initializeAI first.');
  }
  return openai;
}

// ===========================================
// EMBEDDINGS
// ===========================================

/**
 * Generate embeddings for text using OpenAI
 */
// Embedding model configuration
// Using text-embedding-3-large with dimensions=1536 gives better quality than
// text-embedding-3-small while staying within pgvector's HNSW index limit (2000)
const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1536;

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAI();

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0]?.embedding ?? [];
}

/**
 * Generate embeddings for multiple texts
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const client = getOpenAI();

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data.map(d => d.embedding);
}

// ===========================================
// COMPLETION
// ===========================================

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Generate a completion using Claude (with OpenAI fallback)
 */
export async function complete(
  prompt: string,
  options: CompletionOptions = {}
): Promise<string> {
  // Try Anthropic first if available
  if (anthropic) {
    // Look up the actual API model ID from the registry
    const requestedModel = options.model ?? 'claude-sonnet-4-5';
    const modelInfo = MODELS[requestedModel];
    const apiModelId = modelInfo?.modelId ?? requestedModel;

    const params: Parameters<typeof anthropic.messages.create>[0] = {
      model: apiModelId,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options.systemPrompt) {
      params.system = options.systemPrompt;
    }

    const response = await anthropic.messages.create(params) as Anthropic.Message;
    const textBlock = response.content.find((c): c is Anthropic.TextBlock => c.type === 'text');
    return textBlock?.text ?? '';
  }

  // Fall back to OpenAI if Anthropic not available
  if (openai) {
    getLogger().debug('Using OpenAI fallback for completion');
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    // When falling back, use gpt-4o as reliable default (ignore any Claude model that was requested)
    let fallbackModel = 'gpt-4o';
    if (options.model?.startsWith('gpt-') || options.model?.startsWith('o')) {
      // If an OpenAI model was explicitly requested, look up its API ID
      const modelInfo = MODELS[options.model];
      fallbackModel = modelInfo?.modelId ?? options.model;
    }

    const response = await openai.chat.completions.create({
      model: fallbackModel,
      max_completion_tokens: options.maxTokens ?? 4096,
      messages,
      stream: false,
      ...(fallbackModel.startsWith('gpt-5') ? {} : { temperature: options.temperature ?? 0 }),
    });

    return response.choices[0]?.message?.content ?? '';
  }

  throw new Error('No AI provider initialized. Call initializeAI with anthropicApiKey or openaiApiKey.');
}

// ===========================================
// INTENT EXTRACTION (Core clustering mechanism)
// ===========================================

export interface ExtractedIntent {
  template: string;      // e.g., "convert {amount} {from} to {to}"
  intentName: string;    // e.g., "currency_conversion"
  parameters: Record<string, string>;  // e.g., {amount: "100", from: "USD", to: "EUR"}
  category: string;      // e.g., "transformation"
}

/**
 * Extract the intent template from an input/output pair.
 * This is the KEY function for proper clustering - traces with the same
 * intent template represent the same underlying procedure.
 */
export async function extractIntent(
  input: string,
  output: string
): Promise<ExtractedIntent> {
  const prompt = `Analyze this input/output pair and extract the abstract intent template.

Input: "${input}"
Output: "${output}"

Your task:
1. Identify the ABSTRACT PATTERN - replace specific values with parameter placeholders
2. Name the intent
3. Extract the parameter values
4. Categorize it

Example:
Input: "Convert 100 USD to EUR"
Output: "92.50 EUR"
Result:
{
  "template": "convert {amount} {from_currency} to {to_currency}",
  "intentName": "currency_conversion",
  "parameters": {"amount": "100", "from_currency": "USD", "to_currency": "EUR"},
  "category": "transformation"
}

Another example:
Input: "What is 5 squared?"
Output: "25"
Result:
{
  "template": "calculate square of {number}",
  "intentName": "square_calculation",
  "parameters": {"number": "5"},
  "category": "calculation"
}

IMPORTANT: The template should be ABSTRACT enough that similar requests would have the SAME template.
"Convert 100 USD to EUR" and "Convert 500 GBP to JPY" should both have template "convert {amount} {from_currency} to {to_currency}"

Respond with ONLY valid JSON:`;

  const response = await complete(prompt, {
    systemPrompt: 'You extract abstract intent patterns from concrete examples. Output only valid JSON.',
    temperature: 0,
    maxTokens: 512,
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      template: parsed.template || 'unknown',
      intentName: parsed.intentName || parsed.intent_name || 'unknown',
      parameters: parsed.parameters || {},
      category: parsed.category || 'other',
    };
  } catch (error) {
    getLogger().error({ error, input, output }, 'Failed to extract intent');
    // Return a fallback based on hash (worst case)
    return {
      template: `raw:${input.substring(0, 50)}`,
      intentName: 'unknown',
      parameters: {},
      category: 'other',
    };
  }
}

/**
 * Generate a deterministic hash from an intent template.
 * Traces with the same intent template will have the same hash.
 */
export function hashIntentTemplate(template: string): string {
  let hash = 0;
  const normalized = template.toLowerCase().trim();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

// ===========================================
// PROCEDURE SYNTHESIS PROMPTS
// ===========================================

/**
 * Complexity tier for synthesis model selection.
 * - 'simple': short I/O, numeric/formulaic, conversion tasks → mid-tier models
 * - 'complex': long outputs, reasoning, multi-step logic → frontier models
 */
export type SynthesisComplexity = 'simple' | 'complex';

/**
 * Classify trace complexity to select appropriate model tier.
 * Simple: short numeric/formulaic I/O (math, conversions, encoding)
 * Complex: long outputs, reasoning chains, open-ended responses
 */
export function classifyTraceComplexity(
  traces: Array<{ input: string; output: string; reasoning?: string }>
): SynthesisComplexity {
  const avgInputLen = traces.reduce((sum, t) => sum + t.input.length, 0) / traces.length;
  const avgOutputLen = traces.reduce((sum, t) => sum + t.output.length, 0) / traces.length;
  const hasReasoning = traces.some(t => t.reasoning && t.reasoning.length > 100);
  const allOutputsShort = traces.every(t => t.output.length < 200);
  const allNumericish = traces.every(t => /^[\d.\-,\s%$a-fA-F]+$/.test(t.output.trim()) || t.output.trim().length < 100);

  // Complex if: long outputs, reasoning traces, or verbose I/O
  if (hasReasoning || avgOutputLen > 300 || (avgInputLen > 200 && avgOutputLen > 150)) {
    return 'complex';
  }

  // Simple if: short formulaic outputs
  if (allOutputsShort && allNumericish) {
    return 'simple';
  }

  // Default to simple — most shard crystallization is deterministic code
  return 'simple';
}

// Model pairs per complexity tier
const SYNTHESIS_MODELS: Record<SynthesisComplexity, Record<'sonnet' | 'gpt5', string>> = {
  simple: { sonnet: 'claude-sonnet-4-5', gpt5: 'gpt-4.1' },
  complex: { sonnet: 'claude-opus-4-5', gpt5: 'gpt-5' },
};

// Fix pass models per complexity tier
const FIX_MODELS: Record<SynthesisComplexity, Record<'sonnet' | 'gpt5', string>> = {
  simple: { sonnet: 'claude-sonnet-4-5', gpt5: 'gpt-4.1' },
  complex: { sonnet: 'claude-opus-4-5', gpt5: 'gpt-5' },
};

/**
 * Generate a procedure from a cluster of traces (default model)
 */
export async function synthesizeProcedure(
  traces: Array<{ input: string; output: string; reasoning?: string }>
): Promise<{ name: string; logic: string; patterns: string[] }> {
  return synthesizeProcedureWithModel(traces, 'sonnet');
}

/**
 * Generate a procedure from a cluster of traces using a specific model
 */
export async function synthesizeProcedureWithModel(
  traces: Array<{ input: string; output: string; reasoning?: string }>,
  model: 'sonnet' | 'gpt5',
  complexity?: SynthesisComplexity
): Promise<{ name: string; logic: string; patterns: string[] }> {
  const tier = complexity ?? classifyTraceComplexity(traces);
  const examplesText = traces
    .map((t, i) => `Example ${i + 1}:\nInput: ${t.input}\nOutput: ${t.output}`)
    .join('\n\n');

  const prompt = `Analyze these similar request-response pairs and generate a reusable JavaScript procedure.

${examplesText}

Generate a JavaScript function that can handle these types of requests.
The function should be named 'execute' and take a single 'input' parameter (string).
Return the result as a string.

Respond in this exact JSON format:
{
  "name": "descriptive-procedure-name",
  "logic": "function execute(input) { ... return result; }",
  "patterns": ["pattern1", "pattern2"]
}

The patterns should be regex patterns or keywords that identify when this procedure should be used.`;

  const modelId = SYNTHESIS_MODELS[tier][model];

  const response = await completeWithModel(prompt, modelId, {
    systemPrompt: 'You are a code synthesis expert. Generate clean, efficient JavaScript code.',
    temperature: 0,
  });

  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    getLogger().error({ error, model, tier, modelId }, 'Failed to parse synthesized procedure');
    throw error;
  }
}

/**
 * Validation result from testing synthesized procedure
 */
export interface ValidationResult {
  success: boolean;
  error?: string;
  failedInputs?: Array<{ input: string; expected: string; actual: string }>;
}

/**
 * Result from synthesis with validation
 */
export interface SynthesisWithValidationResult {
  name: string;
  logic: string;
  patterns: string[];
  synthesizedBy: 'sonnet' | 'gpt5';
  fixedBy?: 'sonnet' | 'gpt5';
  validationPassed: boolean;
  attempts: number;
  complexity?: SynthesisComplexity;
  parallelRace?: {
    sonnetPassed: boolean;
    gptPassed: boolean;
    winner: 'sonnet' | 'gpt5' | 'none';
    winReason: 'only_valid' | 'production_data' | 'random' | 'both_failed';
    sonnetCodeLength?: number | undefined;
    gptCodeLength?: number | undefined;
    sonnetSuccessRate?: number | undefined;
    gptSuccessRate?: number | undefined;
    complexity?: SynthesisComplexity;
    sonnetModel?: string;
    gptModel?: string;
  };
}

/**
 * Model performance stats from production execution data
 */
export interface ModelStats {
  sonnet: { successes: number; failures: number };
  gpt5: { successes: number; failures: number };
}

/**
 * Synthesize a procedure with validation using HYBRID approach:
 *
 * TIERED PARALLEL SYNTHESIS:
 * - Simple traces (math, conversions): Sonnet 4.5 vs GPT-4.1 (mid-tier)
 * - Complex traces (reasoning, multi-step): Opus 4.5 vs GPT-5 (frontier)
 *
 * 1. Classify trace complexity
 * 2. Run BOTH models in parallel (same tier)
 * 3. Validate both outputs
 * 4. Pick the best:
 *    - If only one passes → that one wins
 *    - If both pass → use production data (fewer failures wins), else random
 *    - If both fail → sequential fix pass with error context
 *
 * This approach is:
 * - Cost-efficient (simple tasks don't burn frontier tokens)
 * - Fair (same-tier models compete)
 * - Data-driven (production execution decides winner)
 */
export async function synthesizeWithValidation(
  traces: Array<{ input: string; output: string; reasoning?: string }>,
  validator: (logic: string) => Promise<ValidationResult>,
  getModelStats?: () => Promise<ModelStats>
): Promise<SynthesisWithValidationResult> {
  const logger = getLogger();

  // Step 0: Classify complexity to select model tier
  const complexity = classifyTraceComplexity(traces);
  const models = SYNTHESIS_MODELS[complexity];
  logger.info({ complexity, anthropic: models.sonnet, openai: models.gpt5 }, 'Synthesis tier selected');

  // Step 1: PARALLEL SYNTHESIS - Run both models simultaneously
  const [sonnetResult, gptResult] = await Promise.allSettled([
    synthesizeProcedureWithModel(traces, 'sonnet', complexity),
    synthesizeProcedureWithModel(traces, 'gpt5', complexity),
  ]);

  // Extract results (handle potential failures)
  const sonnetSynthesis = sonnetResult.status === 'fulfilled' ? sonnetResult.value : null;
  const gptSynthesis = gptResult.status === 'fulfilled' ? gptResult.value : null;

  if (!sonnetSynthesis && !gptSynthesis) {
    logger.error('Both models failed to synthesize');
    throw new Error(`Both models failed to synthesize procedure (tier: ${complexity})`);
  }

  // Step 2: PARALLEL VALIDATION - Validate both outputs
  const [sonnetValidation, gptValidation] = await Promise.all([
    sonnetSynthesis ? validator(sonnetSynthesis.logic) : Promise.resolve({ success: false, error: 'Synthesis failed' }),
    gptSynthesis ? validator(gptSynthesis.logic) : Promise.resolve({ success: false, error: 'Synthesis failed' }),
  ]);

  const sonnetPassed = sonnetValidation.success;
  const gptPassed = gptValidation.success;

  logger.info({
    sonnetPassed,
    gptPassed,
    sonnetCodeLength: sonnetSynthesis?.logic?.length,
    gptCodeLength: gptSynthesis?.logic?.length,
  }, 'Parallel synthesis validation complete');

  // Step 3: PICK THE WINNER
  const parallelRace: SynthesisWithValidationResult['parallelRace'] & {} = {
    sonnetPassed,
    gptPassed,
    winner: 'none',
    winReason: 'both_failed',
    sonnetCodeLength: sonnetSynthesis?.logic?.length,
    gptCodeLength: gptSynthesis?.logic?.length,
    complexity,
    sonnetModel: models.sonnet,
    gptModel: models.gpt5,
  };

  // Case 1: Only Sonnet passed
  if (sonnetPassed && !gptPassed) {
    parallelRace.winner = 'sonnet';
    parallelRace.winReason = 'only_valid';
    logger.info('Winner: Sonnet (only valid solution)');
    return {
      ...sonnetSynthesis!,
      synthesizedBy: 'sonnet',
      validationPassed: true,
      attempts: 1,
      complexity,
      parallelRace,
    };
  }

  // Case 2: Only GPT passed
  if (gptPassed && !sonnetPassed) {
    parallelRace.winner = 'gpt5';
    parallelRace.winReason = 'only_valid';
    logger.info({ model: models.gpt5 }, 'Winner: GPT (only valid solution)');
    return {
      ...gptSynthesis!,
      synthesizedBy: 'gpt5',
      validationPassed: true,
      attempts: 1,
      complexity,
      parallelRace,
    };
  }

  // Case 3: BOTH passed - use production data to pick winner
  if (sonnetPassed && gptPassed) {
    let winner: 'sonnet' | 'gpt5';
    let winReason: 'production_data' | 'random' = 'random';
    let sonnetSuccessRate: number | undefined;
    let gptSuccessRate: number | undefined;

    // Try to get production stats
    if (getModelStats) {
      try {
        const stats = await getModelStats();
        const sonnetTotal = stats.sonnet.successes + stats.sonnet.failures;
        const gptTotal = stats.gpt5.successes + stats.gpt5.failures;

        // Only use stats if we have meaningful data (at least 10 executions each)
        if (sonnetTotal >= 10 && gptTotal >= 10) {
          sonnetSuccessRate = stats.sonnet.successes / sonnetTotal;
          gptSuccessRate = stats.gpt5.successes / gptTotal;

          // Prefer model with higher success rate (fewer failures)
          winner = sonnetSuccessRate >= gptSuccessRate ? 'sonnet' : 'gpt5';
          winReason = 'production_data';
          logger.info({
            winner,
            sonnetSuccessRate: (sonnetSuccessRate * 100).toFixed(1) + '%',
            gptSuccessRate: (gptSuccessRate * 100).toFixed(1) + '%',
          }, 'Both passed - winner by production success rate');
        } else {
          // Not enough data yet - random selection for A/B testing
          winner = Math.random() < 0.5 ? 'sonnet' : 'gpt5';
          logger.info({ winner, sonnetTotal, gptTotal }, 'Both passed - random selection (gathering data)');
        }
      } catch (error) {
        // Stats unavailable - random selection
        winner = Math.random() < 0.5 ? 'sonnet' : 'gpt5';
        logger.warn({ error }, 'Failed to get model stats, using random selection');
      }
    } else {
      // No stats provider - random selection
      winner = Math.random() < 0.5 ? 'sonnet' : 'gpt5';
      logger.info({ winner }, 'Both passed - random selection (no stats provider)');
    }

    parallelRace.winner = winner;
    parallelRace.winReason = winReason;
    parallelRace.sonnetSuccessRate = sonnetSuccessRate;
    parallelRace.gptSuccessRate = gptSuccessRate;

    const winningResult = winner === 'sonnet' ? sonnetSynthesis! : gptSynthesis!;
    return {
      ...winningResult,
      synthesizedBy: winner,
      validationPassed: true,
      attempts: 1,
      complexity,
      parallelRace,
    };
  }

  // Case 4: BOTH FAILED - Sequential fix pass with error context
  logger.info('Both failed validation - attempting sequential fix');

  // Try to fix whichever we have, preferring Sonnet's structure
  const baseResult = sonnetSynthesis || gptSynthesis!;
  const baseValidation = sonnetSynthesis ? sonnetValidation : gptValidation;

  // GPT attempts to fix with error context (using same complexity tier)
  const fixPrompt = buildFixPrompt(baseResult.logic, baseValidation, traces);
  const gptFixModel = FIX_MODELS[complexity].gpt5;

  const fixResponse = await completeWithModel(fixPrompt, gptFixModel, {
    systemPrompt: 'You are an expert debugger. Fix the JavaScript function to pass all test cases. Return only valid JSON with the fixed code.',
    temperature: 0,
  });

  try {
    const jsonMatch = fixResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const fixedResult = JSON.parse(jsonMatch[0]);
      const fixedLogic = fixedResult.logic || fixedResult.code;

      if (fixedLogic) {
        const fixValidation = await validator(fixedLogic);

        if (fixValidation.success) {
          logger.info({ model: gptFixModel }, 'GPT fix pass succeeded');
          return {
            name: baseResult.name,
            logic: fixedLogic,
            patterns: baseResult.patterns,
            synthesizedBy: sonnetSynthesis ? 'sonnet' : 'gpt5',
            fixedBy: 'gpt5',
            validationPassed: true,
            attempts: 2,
            complexity,
            parallelRace,
          };
        }
      }
    }
  } catch (error) {
    logger.error({ error }, 'Fix pass failed');
  }

  // Try Sonnet fix if GPT fix failed and we started with GPT
  if (!sonnetSynthesis && gptSynthesis) {
    try {
      const sonnetFixModel = FIX_MODELS[complexity].sonnet;
      const sonnetFixPrompt = buildFixPrompt(gptSynthesis.logic, gptValidation, traces);
      const sonnetFixResponse = await completeWithModel(sonnetFixPrompt, sonnetFixModel, {
        systemPrompt: 'You are an expert debugger. Fix the JavaScript function to pass all test cases. Return only valid JSON with the fixed code.',
        temperature: 0,
      });

      const jsonMatch = sonnetFixResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const fixedResult = JSON.parse(jsonMatch[0]);
        const fixedLogic = fixedResult.logic || fixedResult.code;

        if (fixedLogic) {
          const fixValidation = await validator(fixedLogic);

          if (fixValidation.success) {
            logger.info({ model: sonnetFixModel }, 'Sonnet fix pass succeeded');
            return {
              name: gptSynthesis.name,
              logic: fixedLogic,
              patterns: gptSynthesis.patterns,
              synthesizedBy: 'gpt5',
              fixedBy: 'sonnet',
              validationPassed: true,
              attempts: 2,
              complexity,
              parallelRace,
            };
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Sonnet fix pass failed');
    }
  }

  // All attempts failed
  logger.warn({ complexity }, 'All synthesis and fix attempts failed');
  return {
    ...baseResult,
    synthesizedBy: sonnetSynthesis ? 'sonnet' : 'gpt5',
    validationPassed: false,
    attempts: 2,
    complexity,
    parallelRace,
  };
}

/**
 * Build the prompt for a model to fix a failed procedure
 */
function buildFixPrompt(
  failedLogic: string,
  validation: ValidationResult,
  traces: Array<{ input: string; output: string }>
): string {
  const examplesText = traces
    .slice(0, 3) // Include a few examples for context
    .map((t, i) => `Example ${i + 1}: Input="${t.input}" → Expected Output="${t.output}"`)
    .join('\n');

  const failuresText = validation.failedInputs
    ?.map((f, i) => `Failure ${i + 1}:\n  Input: "${f.input}"\n  Expected: "${f.expected}"\n  Got: "${f.actual}"`)
    .join('\n') || `Error: ${validation.error}`;

  return `Fix this JavaScript procedure that is failing tests.

ORIGINAL CODE:
\`\`\`javascript
${failedLogic}
\`\`\`

EXPECTED BEHAVIOR:
${examplesText}

FAILURES:
${failuresText}

Fix the code so it handles all cases correctly. The function must be named 'execute' and take a single 'input' parameter.

Respond in JSON format:
{
  "logic": "function execute(input) { ... return result; }",
  "explanation": "brief explanation of the fix"
}`;
}

/**
 * Complete with a specific model (bypasses the default Anthropic-first logic)
 */
async function completeWithModel(
  prompt: string,
  model: string,
  options: CompletionOptions = {}
): Promise<string> {
  // Force OpenAI for gpt-* models
  if (model.startsWith('gpt-') && openai) {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    // GPT-5 doesn't support temperature parameter
    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: options.maxTokens ?? 4096,
      messages,
      stream: false,
      ...(model.startsWith('gpt-5') ? {} : { temperature: options.temperature ?? 0 }),
    });

    return response.choices[0]?.message?.content ?? '';
  }

  // Otherwise use default complete
  return complete(prompt, { ...options, model });
}

/**
 * Classify the intent of an input
 */
export async function classifyIntent(
  input: string
): Promise<{ category: string; name: string; confidence: number }> {
  const prompt = `Classify the intent of this user input:

"${input}"

Respond in JSON format:
{
  "category": "category_name",
  "name": "specific_intent_name",
  "confidence": 0.95
}

Categories: calculation, lookup, transformation, generation, analysis, other`;

  const response = await complete(prompt, { temperature: 0, maxTokens: 256 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { category: 'other', name: 'unknown', confidence: 0.5 };
    }
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { category: 'other', name: 'unknown', confidence: 0.5 };
  }
}

// ===========================================
// LESSON EXTRACTION
// ===========================================

export interface LessonInput {
  summary: string;
  situation: Record<string, unknown>;
  action: Record<string, unknown>;
  outcome: Record<string, unknown>;
  type: string;
  existingLessons: string[];
}

export interface LessonOutput {
  lesson: string;
  subject: string;
  confidence: number;
}

/**
 * Extract a lesson from a failed episode.
 * This enables Episodic Memory → Semantic Memory transfer.
 */
export async function extractLesson(input: LessonInput): Promise<LessonOutput> {
  const prompt = `Analyze this failed episode and extract a generalizable lesson.

Episode Summary: "${input.summary}"

Situation: ${JSON.stringify(input.situation)}
Action Taken: ${JSON.stringify(input.action)}
Outcome: ${JSON.stringify(input.outcome)}
Episode Type: ${input.type}

${input.existingLessons.length > 0 ? `Existing lessons already captured:\n${input.existingLessons.map(l => `- ${l}`).join('\n')}\n\nExtract a NEW lesson not covered above.` : ''}

Your task:
1. Identify what went wrong
2. Extract a generalizable principle or lesson
3. Make it applicable beyond this specific case

Respond in JSON format:
{
  "lesson": "A clear, actionable lesson statement",
  "subject": "The main topic/entity this lesson is about",
  "confidence": 0.85
}

The lesson should be:
- General enough to apply to similar situations
- Specific enough to be actionable
- Phrased as a factual statement (not a command)

Example good lesson: "Procedural shards that require live external API data are unreliable because the data changes"
Example bad lesson: "Don't use currency conversion" (too specific, not generalizable)`;

  const response = await complete(prompt, {
    systemPrompt: 'You extract wisdom from failures. Output only valid JSON.',
    temperature: 0.2,
    maxTokens: 512,
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      lesson: parsed.lesson || '',
      subject: parsed.subject || 'system',
      confidence: parsed.confidence ?? 0.7,
    };
  } catch (error) {
    getLogger().error({ error, input: input.summary }, 'Failed to extract lesson');
    return {
      lesson: '',
      subject: 'system',
      confidence: 0,
    };
  }
}

/**
 * Improve a procedure based on failure cases
 */
export async function improveProcedure(
  currentLogic: string,
  failures: Array<{ input: string; expected: string; actual: string }>
): Promise<string> {
  const failuresText = failures
    .map((f, i) => `Failure ${i + 1}:\nInput: ${f.input}\nExpected: ${f.expected}\nActual: ${f.actual}`)
    .join('\n\n');

  const prompt = `This procedure is failing on some cases. Improve it.

Current Logic:
\`\`\`javascript
${currentLogic}
\`\`\`

Failure Cases:
${failuresText}

Generate an improved version of the function that handles these cases.
Return only the JavaScript code, no explanation.`;

  const response = await complete(prompt, {
    systemPrompt: 'You are a debugging expert. Fix the code to handle all cases.',
    temperature: 0,
  });

  // Extract code from response
  const codeMatch = response.match(/```(?:javascript)?\n?([\s\S]*?)```/) ??
                    response.match(/function execute[\s\S]*/);

  return codeMatch?.[1] ?? codeMatch?.[0] ?? response;
}

// ===========================================
// CROSS-MODEL VALIDATION FUNCTIONS
// ===========================================

/**
 * Result from procedure evolution with validation
 */
export interface EvolutionWithValidationResult {
  logic: string;
  evolvedBy: 'sonnet' | 'gpt5';
  fixedBy?: 'gpt5';
  validationPassed: boolean;
  attempts: number;
}

/**
 * Evolve a procedure with validation and cross-model fix.
 *
 * Flow:
 * 1. Sonnet improves procedure based on failures
 * 2. Validator tests the improvement
 * 3. If validation fails, GPT-5.2 attempts to fix
 * 4. Returns best result with metadata
 */
export async function improveProcedureWithValidation(
  currentLogic: string,
  failures: Array<{ input: string; expected: string; actual: string }>,
  validator: (logic: string) => Promise<ValidationResult>
): Promise<EvolutionWithValidationResult> {
  const logger = getLogger();

  // Step 1: Sonnet improves
  logger.info('Evolving procedure with Sonnet');
  const sonnetImproved = await improveProcedure(currentLogic, failures);

  // Step 2: Validate Sonnet's improvement
  const sonnetValidation = await validator(sonnetImproved);

  if (sonnetValidation.success) {
    logger.info('Sonnet evolution passed validation');
    return {
      logic: sonnetImproved,
      evolvedBy: 'sonnet',
      validationPassed: true,
      attempts: 1,
    };
  }

  // Step 3: Sonnet failed - GPT-5.2 attempts fix
  logger.info({ error: sonnetValidation.error }, 'Sonnet evolution failed validation, trying GPT-5.2');

  const gptPrompt = `Fix this JavaScript procedure that is still failing tests after an attempted improvement.

ORIGINAL CODE:
\`\`\`javascript
${currentLogic}
\`\`\`

ATTEMPTED FIX (still failing):
\`\`\`javascript
${sonnetImproved}
\`\`\`

REMAINING FAILURES:
${failures.map((f, i) => `${i + 1}. Input: "${f.input}" Expected: "${f.expected}" Got: "${f.actual}"`).join('\n')}

${sonnetValidation.error ? `Error: ${sonnetValidation.error}` : ''}

Generate a working version. Return only the JavaScript function named 'execute'.`;

  const gptResponse = await completeWithModel(gptPrompt, 'gpt-5.2', {
    systemPrompt: 'You are an expert debugger. Return only valid JavaScript code.',
    temperature: 0,
  });

  const codeMatch = gptResponse.match(/```(?:javascript)?\n?([\s\S]*?)```/) ??
                    gptResponse.match(/function execute[\s\S]*/);
  const gptLogic = codeMatch?.[1] ?? codeMatch?.[0] ?? gptResponse;

  // Validate GPT's fix
  const gptValidation = await validator(gptLogic);

  if (gptValidation.success) {
    logger.info('GPT-5.2 evolution fix passed validation');
    return {
      logic: gptLogic,
      evolvedBy: 'sonnet',
      fixedBy: 'gpt5',
      validationPassed: true,
      attempts: 2,
    };
  }

  // Both failed - return Sonnet's attempt
  logger.warn('Both Sonnet and GPT-5.2 failed evolution validation');
  return {
    logic: sonnetImproved,
    evolvedBy: 'sonnet',
    validationPassed: false,
    attempts: 2,
  };
}

/**
 * Result from lesson extraction with refinement
 */
export interface LessonWithRefinementResult extends LessonOutput {
  extractedBy: 'sonnet' | 'gpt5';
  refinedBy?: 'gpt5';
}

/**
 * Extract a lesson with cross-model refinement.
 *
 * Flow:
 * 1. Sonnet extracts lesson
 * 2. If confidence < threshold, GPT-5.2 refines/improves it
 * 3. Returns the better lesson
 */
export async function extractLessonWithRefinement(
  input: LessonInput,
  confidenceThreshold: number = 0.75
): Promise<LessonWithRefinementResult> {
  const logger = getLogger();

  // Step 1: Sonnet extracts
  logger.info('Extracting lesson with Sonnet');
  const sonnetLesson = await extractLesson(input);

  if (sonnetLesson.confidence >= confidenceThreshold && sonnetLesson.lesson.length > 20) {
    logger.info({ confidence: sonnetLesson.confidence }, 'Sonnet lesson meets threshold');
    return {
      ...sonnetLesson,
      extractedBy: 'sonnet',
    };
  }

  // Step 2: GPT-5.2 refines
  logger.info({ confidence: sonnetLesson.confidence }, 'Sonnet lesson below threshold, GPT-5.2 refining');

  const refinePrompt = `Improve this lesson extracted from a failed episode.

EPISODE:
Summary: "${input.summary}"
Type: ${input.type}
Outcome: ${JSON.stringify(input.outcome)}

CURRENT LESSON (needs improvement):
"${sonnetLesson.lesson}"
Subject: ${sonnetLesson.subject}
Confidence: ${sonnetLesson.confidence}

The lesson should be:
- More specific and actionable
- Generalizable beyond this specific case
- Phrased as a factual statement

Respond in JSON:
{
  "lesson": "improved lesson statement",
  "subject": "topic",
  "confidence": 0.85,
  "improvement": "what you improved"
}`;

  const gptResponse = await completeWithModel(refinePrompt, 'gpt-5.2', {
    systemPrompt: 'You refine and improve extracted lessons. Output only valid JSON.',
    temperature: 0.1,
  });

  try {
    const jsonMatch = gptResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const gptLesson = JSON.parse(jsonMatch[0]);

    // Use GPT's version if it's better
    if (gptLesson.confidence > sonnetLesson.confidence || gptLesson.lesson.length > sonnetLesson.lesson.length) {
      logger.info({ oldConf: sonnetLesson.confidence, newConf: gptLesson.confidence }, 'GPT-5.2 improved lesson');
      return {
        lesson: gptLesson.lesson,
        subject: gptLesson.subject || sonnetLesson.subject,
        confidence: gptLesson.confidence,
        extractedBy: 'sonnet',
        refinedBy: 'gpt5',
      };
    }
  } catch (e) {
    logger.error({ error: e }, 'GPT-5.2 refinement failed');
  }

  // Fall back to Sonnet's original
  return {
    ...sonnetLesson,
    extractedBy: 'sonnet',
  };
}

/**
 * Result from fact verification with consensus
 */
export interface FactVerificationResult {
  isValid: boolean;
  sonnetConfidence: number;
  gptConfidence: number;
  consensusConfidence: number;
  disagreement?: string;
}

/**
 * Verify a fact using cross-model consensus.
 *
 * Both models must agree the fact is true with high confidence.
 * This prevents hallucinated facts from entering semantic memory.
 */
export async function verifyFactWithConsensus(
  statement: string,
  context?: string,
  threshold: number = 0.7
): Promise<FactVerificationResult> {
  const logger = getLogger();

  const verifyPrompt = `Evaluate whether this statement is factually accurate.

Statement: "${statement}"
${context ? `Context: ${context}` : ''}

Consider:
1. Is this objectively true or verifiable?
2. Is it a reasonable generalization (not overly specific)?
3. Could this be a hallucination or misremembering?

Respond in JSON:
{
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

  // Run both models in parallel
  const [sonnetResponse, gptResponse] = await Promise.all([
    complete(verifyPrompt, {
      systemPrompt: 'You are a fact-checker. Be skeptical. Output only valid JSON.',
      temperature: 0,
    }),
    completeWithModel(verifyPrompt, 'gpt-5.2', {
      systemPrompt: 'You are a fact-checker. Be skeptical. Output only valid JSON.',
      temperature: 0,
    }),
  ]);

  let sonnetResult = { isValid: false, confidence: 0, reasoning: '' };
  let gptResult = { isValid: false, confidence: 0, reasoning: '' };

  try {
    const sonnetMatch = sonnetResponse.match(/\{[\s\S]*\}/);
    if (sonnetMatch) sonnetResult = JSON.parse(sonnetMatch[0]);
  } catch (e) {
    logger.error({ error: e }, 'Sonnet fact verification parse failed');
  }

  try {
    const gptMatch = gptResponse.match(/\{[\s\S]*\}/);
    if (gptMatch) gptResult = JSON.parse(gptMatch[0]);
  } catch (e) {
    logger.error({ error: e }, 'GPT fact verification parse failed');
  }

  // Calculate consensus
  const bothAgree = sonnetResult.isValid === gptResult.isValid;
  const avgConfidence = (sonnetResult.confidence + gptResult.confidence) / 2;
  const consensusConfidence = bothAgree ? avgConfidence : avgConfidence * 0.5;

  const isValid = bothAgree && sonnetResult.isValid && consensusConfidence >= threshold;

  logger.info({
    statement: statement.substring(0, 50),
    sonnet: sonnetResult.isValid,
    gpt: gptResult.isValid,
    consensus: consensusConfidence,
    valid: isValid,
  }, 'Fact verification complete');

  const result: FactVerificationResult = {
    isValid,
    sonnetConfidence: sonnetResult.confidence,
    gptConfidence: gptResult.confidence,
    consensusConfidence,
  };

  if (!bothAgree) {
    result.disagreement = `Sonnet: ${sonnetResult.reasoning} | GPT: ${gptResult.reasoning}`;
  }

  return result;
}

/**
 * Result from intent extraction with validation
 */
export interface IntentWithValidationResult extends ExtractedIntent {
  extractedBy: 'sonnet' | 'gpt5';
  validatedBy?: 'gpt5';
  consensusConfidence: number;
}

/**
 * Extract intent with cross-model validation.
 *
 * Flow:
 * 1. Sonnet extracts intent
 * 2. If confidence < threshold, GPT-5.2 validates/corrects
 * 3. Returns validated intent with consensus confidence
 */
export async function extractIntentWithValidation(
  input: string,
  output: string,
  confidenceThreshold: number = 0.7
): Promise<IntentWithValidationResult> {
  const logger = getLogger();

  // Step 1: Sonnet extracts
  const sonnetIntent = await extractIntent(input, output);

  // Quick classification to get confidence
  const classification = await classifyIntent(input);

  if (classification.confidence >= confidenceThreshold) {
    logger.info({ confidence: classification.confidence }, 'Sonnet intent meets threshold');
    return {
      ...sonnetIntent,
      extractedBy: 'sonnet',
      consensusConfidence: classification.confidence,
    };
  }

  // Step 2: GPT-5.2 validates/corrects
  logger.info({ confidence: classification.confidence }, 'Sonnet intent below threshold, GPT-5.2 validating');

  const validatePrompt = `Validate and potentially correct this intent extraction.

Input: "${input}"
Output: "${output}"

Extracted intent:
- Template: "${sonnetIntent.template}"
- Name: "${sonnetIntent.intentName}"
- Category: "${sonnetIntent.category}"
- Parameters: ${JSON.stringify(sonnetIntent.parameters)}

Is this extraction correct? If not, provide the correct extraction.

Respond in JSON:
{
  "isCorrect": true/false,
  "confidence": 0.0-1.0,
  "correctedTemplate": "only if incorrect",
  "correctedIntentName": "only if incorrect",
  "correctedCategory": "only if incorrect",
  "correctedParameters": {}
}`;

  const gptResponse = await completeWithModel(validatePrompt, 'gpt-5.2', {
    systemPrompt: 'You validate intent extractions. Output only valid JSON.',
    temperature: 0,
  });

  try {
    const jsonMatch = gptResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const validation = JSON.parse(jsonMatch[0]);

    if (validation.isCorrect) {
      // GPT agrees - boost confidence
      return {
        ...sonnetIntent,
        extractedBy: 'sonnet',
        validatedBy: 'gpt5',
        consensusConfidence: Math.min(1, (classification.confidence + validation.confidence) / 2 + 0.1),
      };
    } else {
      // GPT disagrees - use GPT's correction
      logger.info('GPT-5.2 corrected intent extraction');
      return {
        template: validation.correctedTemplate || sonnetIntent.template,
        intentName: validation.correctedIntentName || sonnetIntent.intentName,
        category: validation.correctedCategory || sonnetIntent.category,
        parameters: validation.correctedParameters || sonnetIntent.parameters,
        extractedBy: 'sonnet',
        validatedBy: 'gpt5',
        consensusConfidence: validation.confidence,
      };
    }
  } catch (e) {
    logger.error({ error: e }, 'GPT-5.2 intent validation failed');
  }

  // Fall back to Sonnet's original
  return {
    ...sonnetIntent,
    extractedBy: 'sonnet',
    consensusConfidence: classification.confidence,
  };
}
