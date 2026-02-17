-- Migration 007: Feedback & Learning (Phase 4)
-- Execution feedback events, episodic memory feedback tracking, correction patterns.

BEGIN;

-- ============================================================
-- 1. Execution feedback events
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_execution_feedback (
  id TEXT PRIMARY KEY,
  execution_id TEXT,
  intervention_id TEXT,
  agent_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('correction', 'clarification', 'praise', 'warning', 'rejection')),
  human_response TEXT,
  agent_output TEXT,         -- what the agent originally produced
  corrected_output TEXT,     -- what the human corrected to (if correction)
  quality_delta NUMERIC(3,2) DEFAULT 0,  -- adjustment to quality score (-1.0 to +1.0)
  autonomy_delta INTEGER DEFAULT 0,       -- adjustment to autonomy level
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_agent ON forge_execution_feedback(agent_id);
CREATE INDEX IF NOT EXISTS idx_feedback_execution ON forge_execution_feedback(execution_id);
CREATE INDEX IF NOT EXISTS idx_feedback_unprocessed ON forge_execution_feedback(processed) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_feedback_type ON forge_execution_feedback(feedback_type);

-- ============================================================
-- 2. Add feedback tracking to episodic memories
-- ============================================================

ALTER TABLE forge_episodic_memories ADD COLUMN IF NOT EXISTS feedback_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forge_episodic_memories ADD COLUMN IF NOT EXISTS last_feedback_at TIMESTAMPTZ;
ALTER TABLE forge_episodic_memories ADD COLUMN IF NOT EXISTS quality_locked BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. Correction patterns (learned from repeated corrections)
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_correction_patterns (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('style', 'accuracy', 'approach', 'format', 'scope')),
  description TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 1,
  examples JSONB NOT NULL DEFAULT '[]',   -- array of {input, wrongOutput, correction}
  embedding VECTOR(1536),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_patterns_agent ON forge_correction_patterns(agent_id);
CREATE INDEX IF NOT EXISTS idx_correction_patterns_embedding ON forge_correction_patterns
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

COMMIT;
