import { ids } from '@substrate/core';
import type { ProceduralShard } from '@substrate/core';

export interface InMemoryProceduralStore {
  createShard(
    shard: Omit<ProceduralShard, 'id' | 'createdAt' | 'updatedAt' | 'lastExecuted' | 'executionCount' | 'successCount' | 'failureCount' | 'avgLatencyMs' | 'tokensSaved'>
  ): Promise<ProceduralShard>;
  getShardById(id: string): Promise<ProceduralShard | null>;
  getPromotedShards(): Promise<ProceduralShard[]>;
  listShards(): Promise<ProceduralShard[]>;
  updateLifecycle(id: string, lifecycle: ProceduralShard['lifecycle']): Promise<void>;
  recordExecution(shardId: string, success: boolean, executionMs: number, tokensSaved: number): Promise<void>;
}

/**
 * Lightweight in-memory procedural store for demos/tests. Not for production.
 */
export function createInMemoryProceduralStore(): InMemoryProceduralStore {
  const shards = new Map<string, ProceduralShard>();

  return {
    async createShard(input) {
      const now = new Date();
      const shard: ProceduralShard = {
        id: ids.shard(),
        name: input.name,
        version: input.version ?? 1,
        logic: input.logic,
        inputSchema: input.inputSchema ?? {},
        outputSchema: input.outputSchema ?? {},
        patterns: input.patterns ?? [],
        embedding: input.embedding,
        patternHash: input.patternHash,
        intentTemplate: input.intentTemplate,
        confidence: input.confidence ?? 0.5,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        tokensSaved: 0,
        synthesisMethod: input.synthesisMethod ?? 'manual',
        synthesisConfidence: input.synthesisConfidence ?? 0,
        sourceTraceIds: input.sourceTraceIds ?? [],
        lifecycle: input.lifecycle ?? 'candidate',
        createdAt: now,
        updatedAt: now,
        lastExecuted: undefined,
      };
      shards.set(shard.id, shard);
      return shard;
    },

    async getShardById(id) {
      return shards.get(id) ?? null;
    },

    async getPromotedShards() {
      return Array.from(shards.values()).filter(s => s.lifecycle === 'promoted');
    },

    async listShards() {
      return Array.from(shards.values());
    },

    async updateLifecycle(id, lifecycle) {
      const shard = shards.get(id);
      if (!shard) return;
      shards.set(id, { ...shard, lifecycle, updatedAt: new Date() });
    },

    async recordExecution(shardId, success, executionMs, tokensSaved) {
      const shard = shards.get(shardId);
      if (!shard) return;
      const newExecCount = shard.executionCount + 1;
      const newSuccess = shard.successCount + (success ? 1 : 0);
      const newFailure = shard.failureCount + (success ? 0 : 1);
      const newAvgLatency = newExecCount === 0
        ? executionMs
        : ((shard.avgLatencyMs * shard.executionCount) + executionMs) / newExecCount;
      shards.set(shardId, {
        ...shard,
        executionCount: newExecCount,
        successCount: newSuccess,
        failureCount: newFailure,
        avgLatencyMs: newAvgLatency,
        tokensSaved: shard.tokensSaved + tokensSaved,
        confidence: success
          ? Math.min(1, shard.confidence + 0.008)
          : Math.max(0, shard.confidence - 0.015),
        lastExecuted: new Date(),
        updatedAt: new Date(),
      });
    },
  };
}