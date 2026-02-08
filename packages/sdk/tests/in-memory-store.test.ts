import { describe, it, expect } from 'vitest';
import { createInMemoryProceduralStore } from '../src/in-memory-procedural.js';

describe('in-memory procedural store', () => {
  it('creates, lists, and updates shard lifecycle', async () => {
    const store = createInMemoryProceduralStore();
    const shard = await store.createShard({
      name: 'demo',
      version: 1,
      logic: 'function execute(input){ return input; }',
      inputSchema: {},
      outputSchema: {},
      patterns: [],
      confidence: 0.5,
      synthesisMethod: 'manual',
      synthesisConfidence: 1,
      sourceTraceIds: [],
      lifecycle: 'candidate',
    });

    expect(shard.id).toBeTruthy();
    const listed = await store.listShards();
    expect(listed.length).toBe(1);
    expect(listed[0].lifecycle).toBe('candidate');

    await store.updateLifecycle(shard.id, 'promoted');
    const promoted = await store.getPromotedShards();
    expect(promoted.length).toBe(1);
    expect(promoted[0].lifecycle).toBe('promoted');
  });

  it('records executions and updates metrics', async () => {
    const store = createInMemoryProceduralStore();
    const shard = await store.createShard({
      name: 'metrics',
      version: 1,
      logic: 'function execute(input){ return input; }',
      inputSchema: {},
      outputSchema: {},
      patterns: [],
      confidence: 0.5,
      synthesisMethod: 'manual',
      synthesisConfidence: 1,
      sourceTraceIds: [],
      lifecycle: 'promoted',
    });

    await store.recordExecution(shard.id, true, 10, 5);
    await store.recordExecution(shard.id, false, 20, 0);
    const updated = await store.getShardById(shard.id);

    expect(updated?.executionCount).toBe(2);
    expect(updated?.successCount).toBe(1);
    expect(updated?.failureCount).toBe(1);
    expect(updated?.tokensSaved).toBe(5);
    expect(updated?.avgLatencyMs).toBeGreaterThan(0);
    expect(updated?.lastExecuted).toBeInstanceOf(Date);
  });
});