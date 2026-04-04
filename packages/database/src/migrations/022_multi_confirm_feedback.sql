-- Migration 022: Multi-Confirmation Promotion & User Feedback Signals
-- Layer 4: Phrasing diversity tracking for promotion quality
-- Layer 5: Implicit user feedback after shard hits

-- ============================================
-- LAYER 4: Phrasing diversity on shard_executions
-- ============================================

-- Track the normalized input hash so we can count unique phrasings
ALTER TABLE shard_executions
ADD COLUMN IF NOT EXISTS input_hash VARCHAR(64) DEFAULT NULL;

-- Track match method for analysis
ALTER TABLE shard_executions
ADD COLUMN IF NOT EXISTS match_method VARCHAR(30) DEFAULT NULL;

-- Add unique phrasing count to procedural_shards (denormalized for speed)
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS unique_phrasings INTEGER DEFAULT 0;

-- Min unique phrasings required for promotion (configurable per knowledge type)
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS min_phrasings_for_promotion INTEGER DEFAULT 5;

-- Index for counting unique phrasings per shard
CREATE INDEX IF NOT EXISTS idx_exec_shard_input_hash
ON shard_executions(shard_id, input_hash)
WHERE input_hash IS NOT NULL;

-- ============================================
-- LAYER 5: User feedback signals
-- ============================================

-- Track feedback events after shard hits
CREATE TABLE IF NOT EXISTS shard_feedback (
  id              TEXT PRIMARY KEY,
  shard_id        TEXT NOT NULL REFERENCES procedural_shards(id) ON DELETE CASCADE,
  session_id      TEXT,
  tenant_id       TEXT,

  -- The shard hit that triggered this feedback
  execution_id    TEXT REFERENCES shard_executions(id) ON DELETE SET NULL,
  shard_output    TEXT,

  -- Feedback signal type
  signal_type     VARCHAR(30) NOT NULL,
  -- 'acceptance'   = user moved on (positive)
  -- 'rephrase'     = user asked same thing differently (doubt)
  -- 'correction'   = user said "no", "wrong", "actually" (negative)
  -- 'followup'     = user asked related question (neutral/positive)
  -- 'thumbs_up'    = explicit positive (future feature)
  -- 'thumbs_down'  = explicit negative (future feature)

  -- Context
  user_message    TEXT,          -- The message that triggered the signal
  confidence      REAL DEFAULT 0.5, -- How confident we are about the signal detection

  -- Impact applied
  confidence_delta REAL DEFAULT 0, -- How much this affected shard confidence

  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_shard ON shard_feedback(shard_id);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON shard_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_signal ON shard_feedback(signal_type);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON shard_feedback(created_at DESC);

-- Add feedback counters to procedural_shards (denormalized)
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS acceptance_count INTEGER DEFAULT 0;

ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS rephrase_count INTEGER DEFAULT 0;

ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS correction_count INTEGER DEFAULT 0;

-- Constraint for signal types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_signal_type'
  ) THEN
    ALTER TABLE shard_feedback
    ADD CONSTRAINT valid_signal_type CHECK (
      signal_type IN ('acceptance', 'rephrase', 'correction', 'followup', 'thumbs_up', 'thumbs_down')
    );
  END IF;
END $$;

COMMENT ON TABLE shard_feedback IS
'Tracks implicit and explicit user feedback after shard hits.
Feeds into shard confidence and promotion decisions.';

COMMENT ON COLUMN procedural_shards.unique_phrasings IS
'Count of unique input phrasings that successfully executed this shard.
Used by Layer 4 multi-confirmation: promotion requires diverse phrasings.';

COMMENT ON COLUMN procedural_shards.min_phrasings_for_promotion IS
'Minimum unique phrasings required before this shard can be promoted.
Default 5. Immutable knowledge may need fewer (3). Contextual may need more (10).';

-- ============================================
-- BACKFILL: Set min_phrasings based on knowledge type
-- ============================================
UPDATE procedural_shards SET min_phrasings_for_promotion = 3
WHERE knowledge_type = 'immutable';

UPDATE procedural_shards SET min_phrasings_for_promotion = 5
WHERE knowledge_type = 'procedural';

UPDATE procedural_shards SET min_phrasings_for_promotion = 7
WHERE knowledge_type = 'temporal';

UPDATE procedural_shards SET min_phrasings_for_promotion = 10
WHERE knowledge_type = 'contextual';

-- Backfill unique_phrasings from existing execution data
UPDATE procedural_shards ps SET unique_phrasings = sub.cnt
FROM (
  SELECT shard_id, COUNT(DISTINCT LEFT(input, 200)) as cnt
  FROM shard_executions
  WHERE success = true
  GROUP BY shard_id
) sub
WHERE ps.id = sub.shard_id;
