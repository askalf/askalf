/**
 * SUBSTRATE Metacognition Service
 * Self-reflective AI capabilities for autonomous improvement
 */

import { query, queryOne } from '@substrate/database';

// ============================================
// TYPES
// ============================================

export type MetaEventType =
  | 'reflection'
  | 'strategy_decision'
  | 'learning_proposal'
  | 'correction'
  | 'quality_check'
  | 'confidence_adjustment';

export interface MetaEvent {
  id: string;
  eventType: MetaEventType;
  analysis: Record<string, unknown>;
  tenantId?: string;
  triggerShardId?: string;
  targetShardId?: string;
  traceId?: string;
  sessionId?: string;
  confidence?: number;
  actionTaken?: string;
  outcome?: string;
  success?: boolean;
  processingTimeMs?: number;
  createdAt: Date;
}

export interface QualityMetrics {
  relevance: number;
  completeness: number;
  confidenceAlignment: number;
  responseTimeMs: number;
}

export interface ReflectionResult {
  qualityScore: number;
  metrics: QualityMetrics;
  suggestions: string[];
  flagged: boolean;
  issues: string[];
}

export interface StrategyDecision {
  provider: 'openai' | 'anthropic' | 'google' | 'xai' | 'local';
  model: string;
  reason: string;
  alternativesConsidered: string[];
}

export interface LearningProposal {
  patternDetected: string;
  clusterSize: number;
  similarityScore: number;
  proposedShard: {
    name: string;
    patterns: string[];
    logic: string;
  };
}

// ============================================
// REFLECTION - Analyze response quality
// ============================================

/**
 * Analyze response quality after generation
 */
export async function reflectOnResponse(
  query_text: string,
  response: string,
  options: {
    traceId?: string;
    sessionId?: string;
    tenantId?: string;
    responseTimeMs?: number;
    tokensUsed?: number;
    shardId?: string;
  } = {}
): Promise<ReflectionResult> {
  const startTime = Date.now();

  // Simple heuristic-based quality analysis
  // In production, this could use an LLM for deeper analysis
  const metrics: QualityMetrics = {
    relevance: calculateRelevance(query_text, response),
    completeness: calculateCompleteness(response),
    confidenceAlignment: 0.85, // Would compare stated vs actual confidence
    responseTimeMs: options.responseTimeMs || 0,
  };

  const qualityScore =
    (metrics.relevance + metrics.completeness + metrics.confidenceAlignment) / 3;

  const suggestions: string[] = [];
  const issues: string[] = [];

  if (metrics.relevance < 0.7) {
    issues.push('Response may not fully address the query');
    suggestions.push('Consider rephrasing to directly answer the question');
  }

  if (metrics.completeness < 0.7) {
    issues.push('Response may be incomplete');
    suggestions.push('Add more detail or examples');
  }

  if (response.length < 50 && query_text.length > 100) {
    issues.push('Response is unusually short for query complexity');
    suggestions.push('Provide a more thorough response');
  }

  const flagged = qualityScore < 0.7 || issues.length > 0;

  // Record the reflection event
  await recordMetaEvent('reflection', {
    qualityScore,
    metrics,
    suggestions,
    flagged,
    issues,
    queryLength: query_text.length,
    responseLength: response.length,
  }, {
    traceId: options.traceId,
    sessionId: options.sessionId,
    tenantId: options.tenantId,
    triggerShardId: options.shardId,
    confidence: qualityScore,
    actionTaken: flagged ? 'flagged_for_review' : 'approved',
    outcome: flagged ? 'needs_improvement' : 'quality_acceptable',
    success: !flagged,
    processingTimeMs: Date.now() - startTime,
  });

  return { qualityScore, metrics, suggestions, flagged, issues };
}

/**
 * Calculate relevance score based on keyword overlap
 */
function calculateRelevance(query_text: string, response: string): number {
  const queryWords = new Set(
    query_text.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  );
  const responseWords = response.toLowerCase().split(/\s+/);

  let matches = 0;
  for (const word of responseWords) {
    if (queryWords.has(word)) matches++;
  }

  const coverage = queryWords.size > 0 ? matches / queryWords.size : 0;
  return Math.min(1, coverage * 2); // Scale up, cap at 1
}

/**
 * Calculate completeness score based on response structure
 */
function calculateCompleteness(response: string): number {
  let score = 0.5; // Base score

  // Has substance
  if (response.length > 100) score += 0.15;
  if (response.length > 300) score += 0.1;

  // Has structure (sentences)
  const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length >= 2) score += 0.1;
  if (sentences.length >= 4) score += 0.1;

  // Has formatting (lists, paragraphs)
  if (response.includes('\n\n') || response.includes('- ')) score += 0.05;

  return Math.min(1, score);
}

// ============================================
// STRATEGY - Select optimal approach
// ============================================

/**
 * Decide which model to use for a query
 */
export async function selectModel(
  query_text: string,
  options: {
    userTier?: string;
    preferredProvider?: string;
    taskType?: string;
    sessionId?: string;
    tenantId?: string;
  } = {}
): Promise<StrategyDecision> {
  const startTime = Date.now();
  const queryLower = query_text.toLowerCase();

  // Analyze query characteristics
  const isMath = /\b(calculate|compute|solve|equation|math|formula)\b/i.test(query_text);
  const isCode = /\b(code|function|program|debug|syntax|api|javascript|python|typescript)\b/i.test(query_text);
  const isCreative = /\b(write|story|creative|poem|imagine|brainstorm)\b/i.test(query_text);
  const isReasoning = /\b(why|explain|analyze|compare|reason|think through)\b/i.test(query_text);
  const isQuick = query_text.length < 50 || /\b(quick|fast|simple|what is)\b/i.test(query_text);

  let provider: StrategyDecision['provider'] = 'openai';
  let model = 'gpt-4o-mini';
  let reason = 'Default selection for general queries';
  const alternatives: string[] = [];

  if (isMath || isCode) {
    provider = 'openai';
    model = 'gpt-4o';
    reason = 'Math/code queries benefit from GPT-4o precision';
    alternatives.push('claude-sonnet-4', 'gemini-2.0-flash');
  } else if (isCreative) {
    provider = 'anthropic';
    model = 'claude-sonnet-4';
    reason = 'Creative tasks excel with Claude\'s nuanced responses';
    alternatives.push('gpt-4o', 'gemini-2.0-flash');
  } else if (isReasoning) {
    provider = 'openai';
    model = 'o1';
    reason = 'Complex reasoning benefits from o1 model';
    alternatives.push('claude-sonnet-4', 'gpt-4o');
  } else if (isQuick) {
    provider = 'google';
    model = 'gemini-2.0-flash';
    reason = 'Quick queries optimized for speed with Gemini Flash';
    alternatives.push('gpt-4o-mini', 'claude-haiku-4');
  }

  // Tier restrictions
  const tier = options.userTier || 'free';
  if (tier === 'demo' || tier === 'free') {
    // Restrict to lighter models
    if (model === 'gpt-4o') model = 'gpt-4o-mini';
    if (model === 'claude-sonnet-4') model = 'claude-haiku-4';
    if (model === 'o1') model = 'gpt-4o-mini';
  }

  const decision: StrategyDecision = {
    provider,
    model,
    reason,
    alternativesConsidered: alternatives,
  };

  // Record the decision
  await recordMetaEvent('strategy_decision', decision, {
    sessionId: options.sessionId,
    tenantId: options.tenantId,
    confidence: 0.85,
    actionTaken: 'model_selected',
    outcome: `${provider}/${model}`,
    success: true,
    processingTimeMs: Date.now() - startTime,
  });

  return decision;
}

// ============================================
// LEARNING - Identify crystallization patterns
// ============================================

/**
 * Analyze recent traces for crystallization candidates
 */
export async function detectPatterns(
  options: {
    tenantId?: string;
    minClusterSize?: number;
    similarityThreshold?: number;
  } = {}
): Promise<LearningProposal[]> {
  const startTime = Date.now();
  const minSize = options.minClusterSize || 5;
  const threshold = options.similarityThreshold || 0.85;

  // Get recent successful traces that haven't been crystallized
  const traces = await query<{
    id: string;
    query: string;
    response: string;
    intent_category: string;
  }>(
    `SELECT id, query, response, intent_category
     FROM reasoning_traces
     WHERE crystallization_status = 'not_crystallized'
       AND success = true
       AND created_at > NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC
     LIMIT 500`
  );

  if (traces.length < minSize) {
    return [];
  }

  // Group by intent category
  const byIntent: Map<string, typeof traces> = new Map();
  for (const trace of traces) {
    const intent = trace.intent_category || 'general';
    if (!byIntent.has(intent)) byIntent.set(intent, []);
    byIntent.get(intent)!.push(trace);
  }

  const proposals: LearningProposal[] = [];

  for (const [intent, group] of byIntent) {
    if (group.length >= minSize) {
      // Find common patterns in queries
      const commonWords = findCommonPatterns(group.map((t) => t.query));

      if (commonWords.length > 0) {
        proposals.push({
          patternDetected: intent,
          clusterSize: group.length,
          similarityScore: threshold,
          proposedShard: {
            name: `auto_${intent}_${Date.now()}`,
            patterns: commonWords.slice(0, 3),
            logic: `Handle ${intent} queries with common pattern: ${commonWords[0]}`,
          },
        });

        // Record the learning proposal
        await recordMetaEvent('learning_proposal', {
          intent,
          clusterSize: group.length,
          patterns: commonWords,
          proposedName: `auto_${intent}`,
        }, {
          tenantId: options.tenantId,
          confidence: threshold,
          actionTaken: 'proposal_created',
          outcome: 'pending_review',
          success: true,
          processingTimeMs: Date.now() - startTime,
        });
      }
    }
  }

  return proposals;
}

/**
 * Find common patterns in a set of queries
 */
function findCommonPatterns(queries: string[]): string[] {
  const wordCounts: Map<string, number> = new Map();

  for (const query_text of queries) {
    const words = query_text.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const seen = new Set<string>();
    for (const word of words) {
      if (!seen.has(word)) {
        seen.add(word);
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }
  }

  // Words appearing in >50% of queries
  const threshold = queries.length * 0.5;
  const common: string[] = [];
  for (const [word, count] of wordCounts) {
    if (count >= threshold) {
      common.push(word);
    }
  }

  return common.sort((a, b) => (wordCounts.get(b) || 0) - (wordCounts.get(a) || 0));
}

// ============================================
// CORRECTION - Handle errors and feedback
// ============================================

/**
 * Process user correction or negative feedback
 */
export async function processCorrection(
  shardId: string,
  feedback: {
    type: 'user_correction' | 'negative_feedback' | 'error';
    details: string;
    severity?: 'low' | 'medium' | 'high';
  },
  options: {
    traceId?: string;
    sessionId?: string;
    tenantId?: string;
  } = {}
): Promise<void> {
  const startTime = Date.now();
  const severity = feedback.severity || 'medium';

  // Calculate confidence adjustment
  let adjustment = -0.05;
  if (severity === 'high') adjustment = -0.1;
  if (severity === 'low') adjustment = -0.02;

  // Adjust shard confidence
  if (shardId) {
    await query(`SELECT adjust_shard_confidence($1, $2, $3)`, [
      shardId,
      adjustment,
      `${feedback.type}: ${feedback.details}`,
    ]);
  }

  // Record the correction event
  await recordMetaEvent('correction', {
    type: feedback.type,
    details: feedback.details,
    severity,
    confidenceAdjustment: adjustment,
    shardId,
  }, {
    traceId: options.traceId,
    sessionId: options.sessionId,
    tenantId: options.tenantId,
    triggerShardId: shardId,
    confidence: 1 + adjustment, // New confidence level indicator
    actionTaken: 'confidence_adjusted',
    outcome: `Reduced by ${Math.abs(adjustment)}`,
    success: true,
    processingTimeMs: Date.now() - startTime,
  });
}

// ============================================
// CORE UTILITIES
// ============================================

/**
 * Record a metacognition event
 */
export async function recordMetaEvent(
  eventType: MetaEventType,
  analysis: Record<string, unknown>,
  options: {
    traceId?: string;
    sessionId?: string;
    tenantId?: string;
    triggerShardId?: string;
    targetShardId?: string;
    confidence?: number;
    actionTaken?: string;
    outcome?: string;
    success?: boolean;
    processingTimeMs?: number;
  } = {}
): Promise<string> {
  const result = await queryOne<{ record_metacognition_event: string }>(
    `SELECT record_metacognition_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      eventType,
      JSON.stringify(analysis),
      options.tenantId || null,
      options.triggerShardId || null,
      options.targetShardId || null,
      options.traceId || null,
      options.sessionId || null,
      options.confidence || null,
      options.actionTaken || null,
      options.outcome || null,
      options.success || null,
      options.processingTimeMs || null,
    ]
  );

  return result?.record_metacognition_event || '';
}

/**
 * Get metacognition summary for dashboard
 */
export async function getMetaSummary(hours: number = 24): Promise<{
  events: { type: string; count: number; avgConfidence: number; successRate: number }[];
  totalEvents: number;
  avgQuality: number;
}> {
  const events = await query<{
    event_type: string;
    event_count: string;
    avg_confidence: string | null;
    success_rate: string | null;
  }>(`SELECT * FROM get_metacognition_summary($1)`, [hours]);

  const mapped = events.map((e) => ({
    type: e.event_type,
    count: parseInt(e.event_count, 10),
    avgConfidence: parseFloat(e.avg_confidence || '0'),
    successRate: parseFloat(e.success_rate || '0'),
  }));

  const totalEvents = mapped.reduce((sum, e) => sum + e.count, 0);
  const avgQuality =
    mapped.length > 0
      ? mapped.reduce((sum, e) => sum + e.avgConfidence * e.count, 0) / totalEvents
      : 0;

  return { events: mapped, totalEvents, avgQuality };
}

/**
 * Get recent metacognition events
 */
export async function getRecentEvents(
  limit: number = 50,
  eventType?: MetaEventType
): Promise<MetaEvent[]> {
  let sql = `
    SELECT id, event_type, analysis, tenant_id, trigger_shard_id, target_shard_id,
           trace_id, session_id, confidence, action_taken, outcome, success,
           processing_time_ms, created_at
    FROM metacognition_events
  `;

  const params: unknown[] = [];
  if (eventType) {
    sql += ' WHERE event_type = $1';
    params.push(eventType);
    sql += ' ORDER BY created_at DESC LIMIT $2';
    params.push(limit);
  } else {
    sql += ' ORDER BY created_at DESC LIMIT $1';
    params.push(limit);
  }

  const events = await query<{
    id: string;
    event_type: string;
    analysis: Record<string, unknown>;
    tenant_id: string | null;
    trigger_shard_id: string | null;
    target_shard_id: string | null;
    trace_id: string | null;
    session_id: string | null;
    confidence: number | null;
    action_taken: string | null;
    outcome: string | null;
    success: boolean | null;
    processing_time_ms: number | null;
    created_at: string;
  }>(sql, params);

  return events.map((e) => ({
    id: e.id,
    eventType: e.event_type as MetaEventType,
    analysis: e.analysis,
    tenantId: e.tenant_id || undefined,
    triggerShardId: e.trigger_shard_id || undefined,
    targetShardId: e.target_shard_id || undefined,
    traceId: e.trace_id || undefined,
    sessionId: e.session_id || undefined,
    confidence: e.confidence || undefined,
    actionTaken: e.action_taken || undefined,
    outcome: e.outcome || undefined,
    success: e.success || undefined,
    processingTimeMs: e.processing_time_ms || undefined,
    createdAt: new Date(e.created_at),
  }));
}

export default {
  reflectOnResponse,
  selectModel,
  detectPatterns,
  processCorrection,
  recordMetaEvent,
  getMetaSummary,
  getRecentEvents,
};
