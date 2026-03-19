import { z } from 'zod';

// ===========================================
// EVENT BASE SCHEMA
// ===========================================

export const SubstrateEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  source: z.string(),
  timestamp: z.date(),
  correlationId: z.string().optional(),
  payload: z.record(z.unknown()),
});
export type SubstrateEvent = z.infer<typeof SubstrateEventSchema>;

// ===========================================
// TRACE EVENTS
// ===========================================

export const TraceEventTypes = {
  INGESTED: 'trace.ingested',
  EMBEDDED: 'trace.embedded',
  CLUSTER_READY: 'trace.cluster_ready',
  SYNTHESIZED: 'trace.synthesized',
} as const;

export const TraceIngestedEventSchema = SubstrateEventSchema.extend({
  type: z.literal(TraceEventTypes.INGESTED),
  payload: z.object({
    traceId: z.string(),
    input: z.string(),
    output: z.string(),
    tokensUsed: z.number(),
    sessionId: z.string().optional(),
  }),
});
export type TraceIngestedEvent = z.infer<typeof TraceIngestedEventSchema>;

// ===========================================
// SHARD EVENTS
// ===========================================

export const ShardEventTypes = {
  CREATED: 'shard.created',
  UPDATED: 'shard.updated',
  EXECUTED: 'shard.executed',
  PROMOTED: 'shard.promoted',
  ARCHIVED: 'shard.archived',
  EVOLVED: 'shard.evolved',
} as const;

export const ShardCreatedEventSchema = SubstrateEventSchema.extend({
  type: z.literal(ShardEventTypes.CREATED),
  payload: z.object({
    shardId: z.string(),
    name: z.string(),
    lifecycle: z.string(),
    synthesisMethod: z.string(),
    sourceTraceIds: z.array(z.string()),
  }),
});
export type ShardCreatedEvent = z.infer<typeof ShardCreatedEventSchema>;

export const ShardExecutedEventSchema = SubstrateEventSchema.extend({
  type: z.literal(ShardEventTypes.EXECUTED),
  payload: z.object({
    shardId: z.string(),
    input: z.string(),
    output: z.string(),
    success: z.boolean(),
    executionMs: z.number(),
    tokensSaved: z.number(),
  }),
});
export type ShardExecutedEvent = z.infer<typeof ShardExecutedEventSchema>;

// ===========================================
// METABOLIC EVENTS
// ===========================================

export const MetabolicEventTypes = {
  CRYSTALLIZE_START: 'metabolic.crystallize_start',
  CRYSTALLIZE_COMPLETE: 'metabolic.crystallize_complete',
  EVOLVE_START: 'metabolic.evolve_start',
  EVOLVE_COMPLETE: 'metabolic.evolve_complete',
  PROMOTE_START: 'metabolic.promote_start',
  PROMOTE_COMPLETE: 'metabolic.promote_complete',
  DECAY_START: 'metabolic.decay_start',
  DECAY_COMPLETE: 'metabolic.decay_complete',
} as const;

export const MetabolicCycleEventSchema = SubstrateEventSchema.extend({
  type: z.string(),
  payload: z.object({
    cycle: z.enum(['crystallize', 'evolve', 'promote', 'decay']),
    proceduresAffected: z.number(),
    details: z.record(z.unknown()),
  }),
});
export type MetabolicCycleEvent = z.infer<typeof MetabolicCycleEventSchema>;

// ===========================================
// ECONOMICS EVENTS
// ===========================================

export const EconomicsEventTypes = {
  COST_INCURRED: 'economics.cost_incurred',
  SAVINGS_RECORDED: 'economics.savings_recorded',
} as const;

export const TokenEconomicsEventSchema = SubstrateEventSchema.extend({
  type: z.string(),
  payload: z.object({
    operation: z.string(),
    entityType: z.string(),
    entityId: z.string().optional(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
    tokensSaved: z.number().optional(),
    costSavedUsd: z.number().optional(),
  }),
});
export type TokenEconomicsEvent = z.infer<typeof TokenEconomicsEventSchema>;

// ===========================================
// AUDIT EVENTS
// ===========================================

export const AuditEventTypes = {
  GATE_PASSED: 'audit.gate_passed',
  GATE_FAILED: 'audit.gate_failed',
} as const;

export const AuditGateEventSchema = SubstrateEventSchema.extend({
  type: z.string(),
  payload: z.object({
    gateType: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    decision: z.enum(['pass', 'fail', 'warn']),
    score: z.number().optional(),
    issues: z.array(z.string()).default([]),
  }),
});
export type AuditGateEvent = z.infer<typeof AuditGateEventSchema>;
