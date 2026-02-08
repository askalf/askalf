-- ============================================
-- Migration 017: Worker Optimizations
-- ============================================
-- Adds indexes to improve worker query performance
-- Issue #8: Metacognition query optimization

-- Index for shard_executions to speed up hourly metacognition analysis
-- This query runs every hour and needs to scan recent executions
CREATE INDEX IF NOT EXISTS idx_shard_executions_created_at
ON shard_executions (created_at DESC);

-- Composite index for the exact query pattern used in metacognition
-- Covers: WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY shard_id
CREATE INDEX IF NOT EXISTS idx_shard_executions_shard_created
ON shard_executions (shard_id, created_at DESC);

-- Index for finding unsynthesized traces (used in crystallization)
CREATE INDEX IF NOT EXISTS idx_reasoning_traces_unsynthesized
ON reasoning_traces (owner_id, intent_template)
WHERE synthesized = false;

-- Index for procedural shards by lifecycle (used in promote/decay)
CREATE INDEX IF NOT EXISTS idx_procedural_shards_lifecycle
ON procedural_shards (lifecycle, confidence);

-- Partial index for active (non-archived) shards
CREATE INDEX IF NOT EXISTS idx_procedural_shards_active
ON procedural_shards (id)
WHERE lifecycle != 'archived';

COMMENT ON INDEX idx_shard_executions_created_at IS 'Speeds up time-based queries on shard executions';
COMMENT ON INDEX idx_shard_executions_shard_created IS 'Optimizes metacognition hourly analysis query';
COMMENT ON INDEX idx_reasoning_traces_unsynthesized IS 'Speeds up crystallization trace clustering';
COMMENT ON INDEX idx_procedural_shards_lifecycle IS 'Optimizes promote/decay cycle queries';
COMMENT ON INDEX idx_procedural_shards_active IS 'Partial index for active shards only';
