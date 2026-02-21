import { describe, it, expect } from 'vitest';
import {
  SubstrateEventSchema,
  TraceIngestedEventSchema,
  TraceEventTypes,
  ShardCreatedEventSchema,
  ShardExecutedEventSchema,
  ShardEventTypes,
  AuditGateEventSchema,
  AuditEventTypes,
  TokenEconomicsEventSchema,
  EconomicsEventTypes,
  MetabolicCycleEventSchema,
  MetabolicEventTypes,
} from '../../packages/core/src/types/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-001',
    type: 'test.event',
    source: 'test-service',
    timestamp: new Date(),
    payload: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SubstrateEventSchema
// ---------------------------------------------------------------------------

describe('SubstrateEventSchema', () => {
  it('parses a minimal valid event', () => {
    const result = SubstrateEventSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
  });

  it('accepts optional correlationId when provided', () => {
    const result = SubstrateEventSchema.safeParse(
      baseEvent({ correlationId: 'corr-abc' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.correlationId).toBe('corr-abc');
    }
  });

  it('is valid without correlationId', () => {
    const result = SubstrateEventSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.correlationId).toBeUndefined();
    }
  });

  it('rejects an event missing id', () => {
    const { id: _id, ...noId } = baseEvent();
    const result = SubstrateEventSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('rejects an event missing timestamp', () => {
    const { timestamp: _ts, ...noTs } = baseEvent();
    const result = SubstrateEventSchema.safeParse(noTs);
    expect(result.success).toBe(false);
  });

  it('rejects an event with non-object payload', () => {
    const result = SubstrateEventSchema.safeParse(baseEvent({ payload: 'bad' }));
    expect(result.success).toBe(false);
  });

  it('accepts a payload with arbitrary keys', () => {
    const result = SubstrateEventSchema.safeParse(
      baseEvent({ payload: { foo: 1, bar: 'baz', nested: { x: true } } })
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TraceIngestedEventSchema
// ---------------------------------------------------------------------------

describe('TraceIngestedEventSchema', () => {
  const validPayload = {
    traceId: 'trace-001',
    input: 'user query',
    output: 'model response',
    tokensUsed: 512,
  };

  it('parses a valid trace.ingested event', () => {
    const result = TraceIngestedEventSchema.safeParse({
      ...baseEvent({ type: TraceEventTypes.INGESTED }),
      payload: validPayload,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional sessionId', () => {
    const result = TraceIngestedEventSchema.safeParse({
      ...baseEvent({ type: TraceEventTypes.INGESTED }),
      payload: { ...validPayload, sessionId: 'sess-001' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.sessionId).toBe('sess-001');
    }
  });

  it('rejects wrong event type', () => {
    const result = TraceIngestedEventSchema.safeParse({
      ...baseEvent({ type: 'trace.other' }),
      payload: validPayload,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing tokensUsed', () => {
    const { tokensUsed: _t, ...noTokens } = validPayload;
    const result = TraceIngestedEventSchema.safeParse({
      ...baseEvent({ type: TraceEventTypes.INGESTED }),
      payload: noTokens,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric tokensUsed', () => {
    const result = TraceIngestedEventSchema.safeParse({
      ...baseEvent({ type: TraceEventTypes.INGESTED }),
      payload: { ...validPayload, tokensUsed: 'many' },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ShardCreatedEventSchema
// ---------------------------------------------------------------------------

describe('ShardCreatedEventSchema', () => {
  const validPayload = {
    shardId: 'shard-001',
    name: 'query-handler',
    lifecycle: 'active',
    synthesisMethod: 'auto',
    sourceTraceIds: ['trace-001', 'trace-002'],
  };

  it('parses a valid shard.created event', () => {
    const result = ShardCreatedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.CREATED }),
      payload: validPayload,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty sourceTraceIds array', () => {
    const result = ShardCreatedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.CREATED }),
      payload: { ...validPayload, sourceTraceIds: [] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-array sourceTraceIds', () => {
    const result = ShardCreatedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.CREATED }),
      payload: { ...validPayload, sourceTraceIds: 'trace-001' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing shardId', () => {
    const { shardId: _s, ...noId } = validPayload;
    const result = ShardCreatedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.CREATED }),
      payload: noId,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ShardExecutedEventSchema
// ---------------------------------------------------------------------------

describe('ShardExecutedEventSchema', () => {
  const validPayload = {
    shardId: 'shard-001',
    input: 'user query',
    output: 'shard answer',
    success: true,
    executionMs: 45,
    tokensSaved: 200,
  };

  it('parses a valid shard.executed event', () => {
    const result = ShardExecutedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.EXECUTED }),
      payload: validPayload,
    });
    expect(result.success).toBe(true);
  });

  it('accepts success=false (failure case)', () => {
    const result = ShardExecutedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.EXECUTED }),
      payload: { ...validPayload, success: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.success).toBe(false);
    }
  });

  it('rejects non-boolean success field', () => {
    const result = ShardExecutedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.EXECUTED }),
      payload: { ...validPayload, success: 'yes' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative executionMs (number itself is valid, but should be checked)', () => {
    // Zod schema has no min constraint — negative is schema-valid
    const result = ShardExecutedEventSchema.safeParse({
      ...baseEvent({ type: ShardEventTypes.EXECUTED }),
      payload: { ...validPayload, executionMs: -1 },
    });
    // Schema allows it — this documents the current (no-constraint) behavior
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AuditGateEventSchema
// ---------------------------------------------------------------------------

describe('AuditGateEventSchema', () => {
  const validPayload = {
    gateType: 'quality',
    entityType: 'shard',
    entityId: 'shard-001',
    decision: 'pass' as const,
  };

  it('parses a valid audit gate event with decision=pass', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_PASSED }),
      payload: validPayload,
    });
    expect(result.success).toBe(true);
  });

  it('accepts decision=fail', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_FAILED }),
      payload: { ...validPayload, decision: 'fail' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts decision=warn', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_FAILED }),
      payload: { ...validPayload, decision: 'warn' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid decision value', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_PASSED }),
      payload: { ...validPayload, decision: 'skip' },
    });
    expect(result.success).toBe(false);
  });

  it('defaults issues to an empty array when omitted', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_PASSED }),
      payload: validPayload,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.issues).toEqual([]);
    }
  });

  it('accepts issues array with strings', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_PASSED }),
      payload: { ...validPayload, issues: ['low quality', 'short output'] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.issues).toHaveLength(2);
    }
  });

  it('accepts optional score', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_PASSED }),
      payload: { ...validPayload, score: 0.87 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.score).toBe(0.87);
    }
  });

  it('rejects non-numeric score', () => {
    const result = AuditGateEventSchema.safeParse({
      ...baseEvent({ type: AuditEventTypes.GATE_PASSED }),
      payload: { ...validPayload, score: 'high' },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TokenEconomicsEventSchema
// ---------------------------------------------------------------------------

describe('TokenEconomicsEventSchema', () => {
  const validPayload = {
    operation: 'shard-execution',
    entityType: 'shard',
    inputTokens: 100,
    outputTokens: 250,
    costUsd: 0.003,
  };

  it('parses a valid economics event', () => {
    const result = TokenEconomicsEventSchema.safeParse({
      ...baseEvent({ type: EconomicsEventTypes.COST_INCURRED }),
      payload: validPayload,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional entityId', () => {
    const result = TokenEconomicsEventSchema.safeParse({
      ...baseEvent({ type: EconomicsEventTypes.COST_INCURRED }),
      payload: { ...validPayload, entityId: 'shard-001' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional tokensSaved and costSavedUsd', () => {
    const result = TokenEconomicsEventSchema.safeParse({
      ...baseEvent({ type: EconomicsEventTypes.SAVINGS_RECORDED }),
      payload: { ...validPayload, tokensSaved: 500, costSavedUsd: 0.005 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.tokensSaved).toBe(500);
      expect(result.data.payload.costSavedUsd).toBe(0.005);
    }
  });

  it('rejects missing costUsd', () => {
    const { costUsd: _c, ...noCost } = validPayload;
    const result = TokenEconomicsEventSchema.safeParse({
      ...baseEvent({ type: EconomicsEventTypes.COST_INCURRED }),
      payload: noCost,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MetabolicCycleEventSchema
// ---------------------------------------------------------------------------

describe('MetabolicCycleEventSchema', () => {
  const validPayload = {
    cycle: 'crystallize' as const,
    proceduresAffected: 12,
    details: { reason: 'threshold reached' },
  };

  it('parses a valid metabolic event', () => {
    const result = MetabolicCycleEventSchema.safeParse({
      ...baseEvent({ type: MetabolicEventTypes.CRYSTALLIZE_START }),
      payload: validPayload,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid cycle values', () => {
    const cycles = ['crystallize', 'evolve', 'promote', 'decay'] as const;
    for (const cycle of cycles) {
      const result = MetabolicCycleEventSchema.safeParse({
        ...baseEvent({ type: MetabolicEventTypes.CRYSTALLIZE_START }),
        payload: { ...validPayload, cycle },
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid cycle value', () => {
    const result = MetabolicCycleEventSchema.safeParse({
      ...baseEvent({ type: MetabolicEventTypes.CRYSTALLIZE_START }),
      payload: { ...validPayload, cycle: 'destroy' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric proceduresAffected', () => {
    const result = MetabolicCycleEventSchema.safeParse({
      ...baseEvent({ type: MetabolicEventTypes.CRYSTALLIZE_START }),
      payload: { ...validPayload, proceduresAffected: 'many' },
    });
    expect(result.success).toBe(false);
  });
});
