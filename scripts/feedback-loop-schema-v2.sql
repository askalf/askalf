-- FEEDBACK LOOP SCHEMA v2
-- Fixed: shard_id is TEXT, not UUID

-- ============================================================
-- 1. RESPONSE ATTRIBUTIONS
-- Links every response to the shards that contributed
-- ============================================================
CREATE TABLE IF NOT EXISTS response_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What response is this?
    conversation_id UUID,
    message_id UUID,
    user_id UUID,

    -- What shard contributed?
    shard_id TEXT REFERENCES procedural_shards(id) ON DELETE SET NULL,
    shard_name VARCHAR(255),

    -- What happened?
    input_given TEXT,
    output_produced TEXT,
    execution_time_ms INTEGER,

    -- Context
    memory_context JSONB,
    confidence_at_execution FLOAT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_response_attr_conversation ON response_attributions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_response_attr_shard ON response_attributions(shard_id);
CREATE INDEX IF NOT EXISTS idx_response_attr_user ON response_attributions(user_id);
CREATE INDEX IF NOT EXISTS idx_response_attr_created ON response_attributions(created_at);

-- ============================================================
-- 2. SHARD OUTCOMES
-- Aggregated outcome data per shard - the learning signal
-- ============================================================
CREATE TABLE IF NOT EXISTS shard_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shard_id TEXT REFERENCES procedural_shards(id) ON DELETE CASCADE,

    -- Outcome counts
    positive_outcomes INTEGER DEFAULT 0,
    negative_outcomes INTEGER DEFAULT 0,
    neutral_outcomes INTEGER DEFAULT 0,

    -- Weighted scores
    weighted_positive FLOAT DEFAULT 0,
    weighted_negative FLOAT DEFAULT 0,

    -- Calculated metrics
    outcome_score FLOAT DEFAULT 0.5,
    confidence FLOAT DEFAULT 0.5,
    trend VARCHAR(20) DEFAULT 'stable',

    -- Time tracking
    last_positive_at TIMESTAMPTZ,
    last_negative_at TIMESTAMPTZ,
    last_calculated_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(shard_id)
);

CREATE INDEX IF NOT EXISTS idx_shard_outcomes_shard ON shard_outcomes(shard_id);
CREATE INDEX IF NOT EXISTS idx_shard_outcomes_score ON shard_outcomes(outcome_score);

-- ============================================================
-- 3. FEEDBACK PROPAGATION LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback_propagation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID REFERENCES user_feedback(id) ON DELETE CASCADE,
    shard_id TEXT REFERENCES procedural_shards(id) ON DELETE CASCADE,
    previous_outcome_score FLOAT,
    new_outcome_score FLOAT,
    score_delta FLOAT,
    propagation_weight FLOAT,
    attribution_strength FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_prop_feedback ON feedback_propagation(feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_prop_shard ON feedback_propagation(shard_id);

-- ============================================================
-- 4. ADD OUTCOME FIELDS TO PROCEDURAL_SHARDS
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'outcome_score') THEN
        ALTER TABLE procedural_shards ADD COLUMN outcome_score FLOAT DEFAULT 0.5;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'outcome_confidence') THEN
        ALTER TABLE procedural_shards ADD COLUMN outcome_confidence FLOAT DEFAULT 0.5;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'last_outcome_at') THEN
        ALTER TABLE procedural_shards ADD COLUMN last_outcome_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'outcome_count') THEN
        ALTER TABLE procedural_shards ADD COLUMN outcome_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- ============================================================
-- 5. OUTCOME METRICS (System-wide tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS outcome_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    period_type VARCHAR(20),
    total_responses INTEGER DEFAULT 0,
    responses_with_feedback INTEGER DEFAULT 0,
    positive_feedback_count INTEGER DEFAULT 0,
    negative_feedback_count INTEGER DEFAULT 0,
    feedback_rate FLOAT,
    positive_rate FLOAT,
    help_rate FLOAT,
    help_rate_change FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcome_metrics_period ON outcome_metrics(period_start, period_type);

-- ============================================================
-- 6. INITIALIZE SHARD OUTCOMES FOR EXISTING SHARDS
-- ============================================================
INSERT INTO shard_outcomes (shard_id)
SELECT id FROM procedural_shards
WHERE id NOT IN (SELECT shard_id FROM shard_outcomes WHERE shard_id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. VERIFY
-- ============================================================
SELECT 'response_attributions' as table_name, COUNT(*) as rows FROM response_attributions
UNION ALL
SELECT 'user_feedback', COUNT(*) FROM user_feedback
UNION ALL
SELECT 'shard_outcomes', COUNT(*) FROM shard_outcomes
UNION ALL
SELECT 'feedback_propagation', COUNT(*) FROM feedback_propagation
UNION ALL
SELECT 'outcome_metrics', COUNT(*) FROM outcome_metrics;
