/**
 * COGNITIVE CHECKPOINT SYSTEM
 *
 * Every action must pass through a checkpoint that surfaces relevant knowledge
 * from all memory tiers BEFORE proceeding. This bridges the gap between
 * "having knowledge" and "applying knowledge at the right moment."
 *
 * The checkpoint answers: "What do I know that's relevant to this situation?"
 */

import * as procedural from '../procedural/index.js';
import * as episodic from '../episodic/index.js';
import * as semantic from '../semantic/index.js';
import * as working from '../working/index.js';
import type { TenantContext } from '../procedural/store.js';

// Simple console logger (avoid external dependencies)
const logger = {
  info: (data: Record<string, unknown>, msg: string) => {
    if (process.env['LOG_LEVEL'] === 'debug') {
      console.log(`[checkpoint] ${msg}`, JSON.stringify(data));
    }
  },
  warn: (data: Record<string, unknown>, msg: string) => {
    console.warn(`[checkpoint] ${msg}`, JSON.stringify(data));
  },
  debug: (data: Record<string, unknown>, msg: string) => {
    if (process.env['LOG_LEVEL'] === 'debug') {
      console.log(`[checkpoint:debug] ${msg}`, JSON.stringify(data));
    }
  },
};

export interface CheckpointContext {
  // What shards are relevant (even partial matches)
  relevantShards: Array<{
    id: string;
    name: string;
    confidence: number;
    matchType: 'pattern' | 'semantic' | 'partial';
    matchScore: number;
  }>;

  // What past experiences are relevant
  relevantEpisodes: Array<{
    id: string;
    summary: string;
    lessonsLearned: string[];
    success: boolean;
    importance: number;
  }>;

  // What facts/knowledge applies
  relevantFacts: Array<{
    id: string;
    statement: string;
    confidence: number;
    category: string | null;
  }>;

  // What working contexts are relevant (recent/active)
  relevantContexts: Array<{
    id: string;
    contentType: string;
    summary: string;
    importance: number;
  }>;

  // Synthesized warnings/guidance
  warnings: string[];
  guidance: string[];

  // Should we pause for human review?
  requiresReview: boolean;
  reviewReason?: string;
}

export interface CheckpointOptions {
  tenant?: TenantContext | undefined;
  // Categories to specifically check
  categories?: string[] | undefined;
  // Minimum confidence for including results
  minConfidence?: number | undefined;
  // Include warnings from past failures?
  includeFailureWarnings?: boolean | undefined;
  // Check for destructive/expensive operations?
  checkExpensiveOps?: boolean | undefined;
}

// Patterns that indicate expensive/destructive operations
const EXPENSIVE_OP_PATTERNS = [
  /\b(rebuild|build|deploy|migrate|push|ship)\b/i,
  /\b(delete|drop|truncate|remove|destroy)\b/i,
  /\b(docker|kubernetes|k8s|terraform)\b/i,
  /\b(production|prod|live)\b/i,
];

// Patterns that require extra caution
const CAUTION_PATTERNS = [
  /\b(all|every|entire|complete)\b.*\b(delete|remove|reset)\b/i,
  /\b(force|hard|--force|-f)\b/i,
  /\b(no-?verify|skip-?check|unsafe)\b/i,
];

/**
 * Run a cognitive checkpoint before any action
 *
 * This surfaces relevant knowledge from all memory tiers to inform the action.
 * Call this BEFORE executing shards, calling LLMs, or taking any action.
 */
export async function runCheckpoint(
  input: string,
  options: CheckpointOptions = {}
): Promise<CheckpointContext> {
  const {
    tenant,
    minConfidence = 0.3,
    includeFailureWarnings = true,
    checkExpensiveOps = true,
  } = options;

  const startTime = Date.now();
  const context: CheckpointContext = {
    relevantShards: [],
    relevantEpisodes: [],
    relevantFacts: [],
    relevantContexts: [],
    warnings: [],
    guidance: [],
    requiresReview: false,
  };

  // Parallel queries to all 4 memory tiers
  const [shardResults, episodeResults, factResults, contextResults] = await Promise.allSettled([
    // Tier 1: Query procedural memory for relevant shards
    queryRelevantShards(input, tenant, minConfidence),
    // Tier 2: Query episodic memory for relevant experiences
    queryRelevantEpisodes(input, tenant, includeFailureWarnings),
    // Tier 3: Query semantic memory for relevant facts
    queryRelevantFacts(input, tenant, minConfidence),
    // Tier 4: Query working memory for relevant active contexts
    queryRelevantContexts(input, tenant),
  ]);

  // Process shard results
  if (shardResults.status === 'fulfilled') {
    context.relevantShards = shardResults.value;
  } else {
    logger.warn({ err: String(shardResults.reason) }, 'Failed to query procedural memory');
  }

  // Process episode results
  if (episodeResults.status === 'fulfilled') {
    context.relevantEpisodes = episodeResults.value.episodes;
    context.warnings.push(...episodeResults.value.warnings);
    context.guidance.push(...episodeResults.value.guidance);
  } else {
    logger.warn({ err: String(episodeResults.reason) }, 'Failed to query episodic memory');
  }

  // Process fact results
  if (factResults.status === 'fulfilled') {
    context.relevantFacts = factResults.value;
  } else {
    logger.warn({ err: String(factResults.reason) }, 'Failed to query semantic memory');
  }

  // Process working context results
  if (contextResults.status === 'fulfilled') {
    context.relevantContexts = contextResults.value;
  } else {
    logger.warn({ err: String(contextResults.reason) }, 'Failed to query working memory');
  }

  // Check for expensive operations if enabled
  if (checkExpensiveOps) {
    const expensiveCheck = checkForExpensiveOps(input);
    if (expensiveCheck.isExpensive) {
      context.requiresReview = true;
      if (expensiveCheck.reason) {
        context.reviewReason = expensiveCheck.reason;
      }
      context.warnings.push(`⚠️ CHECKPOINT: ${expensiveCheck.reason}`);
      context.guidance.push(
        'Before proceeding, confirm:',
        '1. Have all related changes been batched?',
        '2. Is this the right time for this operation?',
        '3. Are there any pending changes that should be included?'
      );
    }
  }

  // Check for caution patterns
  for (const pattern of CAUTION_PATTERNS) {
    if (pattern.test(input)) {
      context.warnings.push('⚠️ Detected potentially destructive operation pattern');
      context.requiresReview = true;
      context.reviewReason = context.reviewReason || 'Destructive operation detected';
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info({
    input: input.substring(0, 100),
    shards: context.relevantShards.length,
    episodes: context.relevantEpisodes.length,
    facts: context.relevantFacts.length,
    contexts: context.relevantContexts.length,
    warnings: context.warnings.length,
    requiresReview: context.requiresReview,
    elapsedMs: elapsed,
  }, 'Checkpoint complete (4 tiers queried)');

  return context;
}

/**
 * Query procedural memory for relevant shards
 */
async function queryRelevantShards(
  input: string,
  tenant?: TenantContext,
  minConfidence: number = 0.3
): Promise<CheckpointContext['relevantShards']> {
  const results: CheckpointContext['relevantShards'] = [];

  // Try pattern matching first
  try {
    const patternMatches = await procedural.findShardsByPattern(input, tenant);
    for (const shard of patternMatches) {
      if (shard.confidence >= minConfidence) {
        results.push({
          id: shard.id,
          name: shard.name,
          confidence: shard.confidence,
          matchType: 'pattern',
          matchScore: 1.0, // Pattern matches are exact
        });
      }
    }
  } catch (e) {
    logger.debug({ err: String(e) }, 'Pattern matching failed');
  }

  // Also try semantic/embedding matching if available
  try {
    const semanticMatches = await procedural.findSimilarShards(input, 5, tenant);
    for (const match of semanticMatches) {
      // Don't duplicate pattern matches
      if (!results.find(r => r.id === match.id) && match.confidence >= minConfidence) {
        results.push({
          id: match.id,
          name: match.name,
          confidence: match.confidence,
          matchType: 'semantic',
          matchScore: match.confidence, // Use confidence as proxy for similarity
        });
      }
    }
  } catch (e) {
    logger.debug({ err: String(e) }, 'Semantic matching failed');
  }

  return results;
}

/**
 * Query episodic memory for relevant experiences
 */
async function queryRelevantEpisodes(
  input: string,
  tenant?: TenantContext,
  includeFailures: boolean = true
): Promise<{
  episodes: CheckpointContext['relevantEpisodes'];
  warnings: string[];
  guidance: string[];
}> {
  const warnings: string[] = [];
  const guidance: string[] = [];
  const episodes: CheckpointContext['relevantEpisodes'] = [];

  try {
    // Search for similar situations
    const similar = await episodic.findSimilarEpisodes(input, 5, tenant);

    for (const ep of similar) {
      episodes.push({
        id: ep.id,
        summary: ep.summary,
        lessonsLearned: ep.lessonsLearned || [],
        success: ep.success ?? true, // Default to true if undefined
        importance: ep.importance,
      });

      // Extract warnings from failures
      if (ep.success === false && includeFailures) {
        warnings.push(`Past failure: ${ep.summary}`);
        if (ep.lessonsLearned && ep.lessonsLearned.length > 0) {
          guidance.push(...ep.lessonsLearned.map((l: string) => `Lesson: ${l}`));
        }
      }

      // Extract guidance from successes
      if (ep.success === true && ep.lessonsLearned && ep.lessonsLearned.length > 0) {
        guidance.push(...ep.lessonsLearned.map((l: string) => `Best practice: ${l}`));
      }
    }
  } catch (e) {
    logger.debug({ err: String(e) }, 'Episode search failed');
  }

  return { episodes, warnings, guidance };
}

/**
 * Query semantic memory for relevant facts
 */
async function queryRelevantFacts(
  input: string,
  tenant?: TenantContext,
  minConfidence: number = 0.3
): Promise<CheckpointContext['relevantFacts']> {
  const results: CheckpointContext['relevantFacts'] = [];

  try {
    const facts = await semantic.findSimilarFacts(input, 5, tenant);
    for (const fact of facts) {
      if (fact.confidence >= minConfidence) {
        results.push({
          id: fact.id,
          statement: fact.statement,
          confidence: fact.confidence,
          category: fact.category ?? null,
        });
      }
    }
  } catch (e) {
    logger.debug({ err: String(e) }, 'Fact search failed');
  }

  return results;
}

/**
 * Query working memory for relevant active contexts
 */
async function queryRelevantContexts(
  input: string,
  tenant?: TenantContext
): Promise<CheckpointContext['relevantContexts']> {
  const results: CheckpointContext['relevantContexts'] = [];

  try {
    // Pass tenant directly - working memory has compatible TenantContext
    const contexts = await working.findSimilarContexts(input, 5, undefined, tenant);
    for (const ctx of contexts) {
      // Get summary if available, otherwise use truncated raw content
      const ctxRecord = ctx as Record<string, unknown>;
      const summary = (ctxRecord['summary'] as string) || ctx.rawContent.substring(0, 200);
      const importance = (ctxRecord['importance'] as number) ?? 0.5;

      results.push({
        id: ctx.id,
        contentType: ctx.contentType,
        summary,
        importance,
      });
    }
  } catch (e) {
    logger.debug({ err: String(e) }, 'Working context search failed');
  }

  return results;
}

/**
 * Check if the input indicates an expensive operation
 */
function checkForExpensiveOps(input: string): { isExpensive: boolean; reason?: string } {
  for (const pattern of EXPENSIVE_OP_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      return {
        isExpensive: true,
        reason: `Expensive operation detected: "${match[0]}". Have all changes been batched?`,
      };
    }
  }
  return { isExpensive: false };
}

/**
 * Format checkpoint context for injection into prompts
 */
export function formatCheckpointForPrompt(context: CheckpointContext): string {
  const sections: string[] = [];

  if (context.warnings.length > 0) {
    sections.push('## ⚠️ WARNINGS\n' + context.warnings.join('\n'));
  }

  if (context.guidance.length > 0) {
    sections.push('## 📋 GUIDANCE\n' + context.guidance.join('\n'));
  }

  if (context.relevantFacts.length > 0) {
    sections.push(
      '## 📚 RELEVANT KNOWLEDGE\n' +
      context.relevantFacts.map(f => `- ${f.statement}`).join('\n')
    );
  }

  if (context.relevantEpisodes.length > 0) {
    sections.push(
      '## 📖 PAST EXPERIENCES\n' +
      context.relevantEpisodes.map(e =>
        `- ${e.success ? '✓' : '✗'} ${e.summary}`
      ).join('\n')
    );
  }

  if (context.relevantShards.length > 0) {
    sections.push(
      '## ⚡ AVAILABLE PROCEDURES\n' +
      context.relevantShards.map(s =>
        `- ${s.name} (${s.matchType}, confidence: ${(s.confidence * 100).toFixed(0)}%)`
      ).join('\n')
    );
  }

  if (context.relevantContexts.length > 0) {
    sections.push(
      '## 🧠 ACTIVE CONTEXT\n' +
      context.relevantContexts.map(c =>
        `- [${c.contentType}] ${c.summary} (importance: ${(c.importance * 100).toFixed(0)}%)`
      ).join('\n')
    );
  }

  if (sections.length === 0) {
    return '';
  }

  return '---\n# COGNITIVE CHECKPOINT\n' + sections.join('\n\n') + '\n---\n';
}

/**
 * Check if a checkpoint requires human review before proceeding
 */
export function requiresHumanReview(context: CheckpointContext): boolean {
  return context.requiresReview;
}

/**
 * Get the review reason if review is required
 */
export function getReviewReason(context: CheckpointContext): string | undefined {
  return context.reviewReason;
}
