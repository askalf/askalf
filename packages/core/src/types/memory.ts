import { z } from 'zod';

// ===========================================
// TIER 1: PROCEDURAL MEMORY (Logic Shards)
// Crystallized executable skills
// ===========================================

export const ShardLifecycle = z.enum([
  'candidate',    // Just created, unproven
  'testing',      // Being validated against traces
  'shadow',       // A/B testing against parent
  'promoted',     // Active, trusted (success rate > 85%)
  'archived',     // Low confidence, forgotten
  'resurrected',  // Restored from archive
]);
export type ShardLifecycle = z.infer<typeof ShardLifecycle>;

export const KnowledgeType = z.enum([
  'immutable',    // Never changes (math, constants, conversions) — no TTL, no decay
  'temporal',     // Changes over time (API docs, pricing, versions) — has TTL, needs verification
  'contextual',   // Subjective/opinion-based — never auto-promoted
  'procedural',   // How-to knowledge — may need version updates
]);
export type KnowledgeType = z.infer<typeof KnowledgeType>;

export const VerificationStatus = z.enum([
  'unverified',   // Default, never checked
  'verified',     // Passed verification challenge
  'expired',      // Past expires_at, needs re-verification
  'challenged',   // Currently being re-verified
  'failed',       // Failed verification, should not be served
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const ProceduralShardSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().default(1),

  // Executable logic (JavaScript)
  logic: z.string(),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),

  // Pattern matching
  patterns: z.array(z.string()).default([]),
  embedding: z.array(z.number()).optional(),
  patternHash: z.string().optional(),
  intentTemplate: z.string().optional(), // Abstract template for clustering

  // Performance metrics
  confidence: z.number().min(0).max(1).default(0.5),
  executionCount: z.number().default(0),
  successCount: z.number().default(0),
  failureCount: z.number().default(0),
  avgLatencyMs: z.number().default(0),
  tokensSaved: z.number().default(0),

  // Environmental impact - estimated tokens saved per execution
  estimatedTokens: z.number().optional().default(100),

  // Synthesis metadata
  synthesisMethod: z.string().default('manual'),
  synthesisConfidence: z.number().default(0),
  sourceTraceIds: z.array(z.string()).default([]),

  // Lifecycle
  lifecycle: ShardLifecycle.default('candidate'),

  // Knowledge classification (Layer 1)
  knowledgeType: KnowledgeType.default('procedural'),
  category: z.string().optional(),

  // TTL / Expiration (for temporal knowledge)
  expiresAt: z.date().optional(),

  // Verification tracking
  lastVerifiedAt: z.date().optional(),
  verificationCount: z.number().default(0),
  verificationStatus: VerificationStatus.default('unverified'),

  // Source provenance
  sourceUrl: z.string().optional(),
  sourceType: z.string().optional(),

  // Ownership / Multi-tenancy
  ownerId: z.string().nullable().optional(),
  visibility: z.enum(['public', 'private', 'organization']).optional().default('public'),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  lastExecuted: z.date().optional(),
});
export type ProceduralShard = z.infer<typeof ProceduralShardSchema>;

export const ShardExecutionSchema = z.object({
  id: z.string(),
  shardId: z.string(),

  input: z.string(),
  output: z.string().optional(),
  success: z.boolean(),
  error: z.string().optional(),

  executionMs: z.number(),
  tokensSaved: z.number().default(0),
  similarityScore: z.number().optional(),

  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  source: z.enum(['api', 'mcp', 'worker']).default('api'),

  createdAt: z.date(),
});
export type ShardExecution = z.infer<typeof ShardExecutionSchema>;

// ===========================================
// TIER 2: EPISODIC MEMORY (SAO Chains)
// Situation → Action → Outcome
// ===========================================

export const EpisodeValence = z.enum(['positive', 'negative', 'neutral']);
export type EpisodeValence = z.infer<typeof EpisodeValence>;

export const SituationSchema = z.object({
  context: z.string(),
  entities: z.array(z.string()).default([]),
  state: z.record(z.unknown()).default({}),
});
export type Situation = z.infer<typeof SituationSchema>;

export const ActionSchema = z.object({
  type: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()).default({}),
  reasoning: z.string().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

export const OutcomeSchema = z.object({
  result: z.string(),
  success: z.boolean().optional(),
  effects: z.array(z.string()).default([]),
  metrics: z.record(z.number()).default({}),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const EpisodeSchema = z.object({
  id: z.string(),

  // SAO Structure
  situation: SituationSchema,
  action: ActionSchema,
  outcome: OutcomeSchema,

  // Metadata
  type: z.string(), // task, error, decision, interaction
  summary: z.string(),

  // Learning signals
  success: z.boolean().optional(),
  valence: EpisodeValence.optional(),
  importance: z.number().min(0).max(1).default(0.5),
  lessonsLearned: z.array(z.string()).default([]),

  // Semantic
  embedding: z.array(z.number()).optional(),

  // Linkage
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  relatedShardId: z.string().optional(),
  parentEpisodeId: z.string().optional(),

  metadata: z.record(z.unknown()).default({}),
  timestamp: z.date(),
  createdAt: z.date(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

// ===========================================
// TIER 3: SEMANTIC MEMORY (Truth Store)
// Confidence-weighted knowledge graph
// ===========================================

export const KnowledgeFactSchema = z.object({
  id: z.string(),

  // Triple structure
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  statement: z.string(), // "subject predicate object"

  // Confidence weighting (anti-hallucination)
  confidence: z.number().min(0).max(1).default(0.5),
  accessCount: z.number().default(0),
  verificationCount: z.number().default(0),
  contradictionCount: z.number().default(0),

  // Sources
  sources: z.array(z.string()).default([]),
  evidence: z.array(z.record(z.unknown())).default([]),

  // Semantic
  embedding: z.array(z.number()).optional(),
  category: z.string().optional(),

  // Temporal validity
  validFrom: z.date().optional(),
  validUntil: z.date().optional(),
  isTemporal: z.boolean().default(false),

  // Audit
  agentId: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastAccessed: z.date().optional(),
});
export type KnowledgeFact = z.infer<typeof KnowledgeFactSchema>;

export const KnowledgeRelationType = z.enum([
  'supports',
  'contradicts',
  'requires',
  'implies',
  'derived_from',
  'related_to',
]);
export type KnowledgeRelationType = z.infer<typeof KnowledgeRelationType>;

export const KnowledgeRelationSchema = z.object({
  id: z.string(),
  sourceFactId: z.string(),
  targetFactId: z.string(),
  relationType: KnowledgeRelationType,
  strength: z.number().min(0).max(1).default(0.5),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.date(),
});
export type KnowledgeRelation = z.infer<typeof KnowledgeRelationSchema>;

// ===========================================
// TIER 4: WORKING MEMORY (Context Liquidation)
// Real-time evaporation into high-density facts
// ===========================================

export const WorkingContextStatus = z.enum([
  'raw',         // Just received
  'processing',  // Being liquidated
  'liquidated',  // Facts extracted
  'promoted',    // Facts moved to semantic memory
  'archived',    // Expired or cleaned up
]);
export type WorkingContextStatus = z.infer<typeof WorkingContextStatus>;

export const WorkingContextSchema = z.object({
  id: z.string(),

  // Context window
  sessionId: z.string(),
  agentId: z.string().optional(),

  // Raw context (pre-liquidation)
  rawContent: z.string(),
  contentType: z.string(), // conversation, observation, task

  // Liquidated facts (post-processing)
  extractedFacts: z.array(z.record(z.unknown())).default([]),
  extractedEntities: z.array(z.string()).default([]),
  noiseRemoved: z.array(z.string()).default([]),

  // Processing state
  status: WorkingContextStatus.default('raw'),

  // Metrics
  originalTokens: z.number().optional(),
  liquidatedTokens: z.number().optional(),
  compressionRatio: z.number().optional(),

  // Expiration
  ttlSeconds: z.number().default(3600),
  expiresAt: z.date().optional(),

  createdAt: z.date(),
  updatedAt: z.date(),
});
export type WorkingContext = z.infer<typeof WorkingContextSchema>;

// ===========================================
// TRACES (Input to Crystallization)
// ===========================================

export const ReasoningTraceSchema = z.object({
  id: z.string(),

  // Core trace data
  input: z.string(),
  reasoning: z.string().optional(),
  output: z.string(),

  // Pattern detection
  patternHash: z.string(),
  embedding: z.array(z.number()).optional(),

  // Intent classification
  intentCategory: z.string().optional(),
  intentName: z.string().optional(),
  intentConfidence: z.number().optional(),
  outputStructure: z.string().optional(),
  outputPattern: z.string().optional(),

  // Metrics
  tokensUsed: z.number(),
  executionMs: z.number(),
  model: z.string().optional(),

  // Processing state
  synthesized: z.boolean().default(false),
  replayed: z.boolean().default(false),
  attractedToShardId: z.string().optional(),

  // Context
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  source: z.string().default('conversation'),

  timestamp: z.date(),
});
export type ReasoningTrace = z.infer<typeof ReasoningTraceSchema>;
