-- FEEDBACK LOOP SCHEMA
-- The missing piece that makes learning real

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
    shard_id UUID REFERENCES procedural_shards(id) ON DELETE SET NULL,
    shard_name VARCHAR(255),

    -- What happened?
    input_given TEXT,                    -- What was passed to the shard
    output_produced TEXT,                -- What the shard returned
    execution_time_ms INTEGER,           -- How long it took

    -- Context
    memory_context JSONB,                -- What memories were available
    confidence_at_execution FLOAT,       -- Shard's confidence when executed

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_response_attr_conversation ON response_attributions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_response_attr_shard ON response_attributions(shard_id);
CREATE INDEX IF NOT EXISTS idx_response_attr_user ON response_attributions(user_id);
CREATE INDEX IF NOT EXISTS idx_response_attr_created ON response_attributions(created_at);

-- ============================================================
-- 2. USER FEEDBACK
-- Captures explicit and implicit signals about response quality
-- ============================================================
CREATE TABLE IF NOT EXISTS user_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What is this feedback about?
    conversation_id UUID,
    message_id UUID,                     -- The specific message being rated
    user_id UUID,

    -- What type of signal?
    feedback_type VARCHAR(50) NOT NULL,  -- See types below
    feedback_value TEXT,                 -- The actual signal
    feedback_score FLOAT,                -- Normalized -1 to +1

    -- Context
    time_since_response_ms INTEGER,      -- How long after response?
    session_continued BOOLEAN,           -- Did they keep talking?

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feedback types:
-- EXPLICIT POSITIVE: 'thumbs_up', 'thanks', 'helpful', 'correct', 'great'
-- EXPLICIT NEGATIVE: 'thumbs_down', 'wrong', 'unhelpful', 'confused', 'frustrated'
-- IMPLICIT POSITIVE: 'returned_same_day', 'returned_next_day', 'long_session', 'follow_up_positive'
-- IMPLICIT NEGATIVE: 'abandoned', 'short_session', 'repeated_question', 'switched_topic_abruptly'

CREATE INDEX IF NOT EXISTS idx_user_feedback_conversation ON user_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_message ON user_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_type ON user_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback(created_at);

-- ============================================================
-- 3. SHARD OUTCOMES
-- Aggregated outcome data per shard - the learning signal
-- ============================================================
CREATE TABLE IF NOT EXISTS shard_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shard_id UUID REFERENCES procedural_shards(id) ON DELETE CASCADE,

    -- Outcome counts
    positive_outcomes INTEGER DEFAULT 0,
    negative_outcomes INTEGER DEFAULT 0,
    neutral_outcomes INTEGER DEFAULT 0,

    -- Weighted scores (more recent = more weight)
    weighted_positive FLOAT DEFAULT 0,
    weighted_negative FLOAT DEFAULT 0,

    -- Calculated metrics
    outcome_score FLOAT DEFAULT 0.5,     -- 0 to 1, 0.5 is neutral
    confidence FLOAT DEFAULT 0.5,        -- How confident in the score
    trend VARCHAR(20) DEFAULT 'stable',  -- 'improving', 'declining', 'stable'

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
-- 4. ADD OUTCOME FIELDS TO PROCEDURAL_SHARDS
-- ============================================================
DO $$
BEGIN
    -- Outcome score: based on real user feedback, not just execution
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'outcome_score') THEN
        ALTER TABLE procedural_shards ADD COLUMN outcome_score FLOAT DEFAULT 0.5;
    END IF;

    -- Confidence: how confident are we this shard actually helps?
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'outcome_confidence') THEN
        ALTER TABLE procedural_shards ADD COLUMN outcome_confidence FLOAT DEFAULT 0.5;
    END IF;

    -- Last outcome: when did we last get feedback?
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'last_outcome_at') THEN
        ALTER TABLE procedural_shards ADD COLUMN last_outcome_at TIMESTAMPTZ;
    END IF;

    -- Total outcomes: how many times have we gotten feedback?
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'procedural_shards' AND column_name = 'outcome_count') THEN
        ALTER TABLE procedural_shards ADD COLUMN outcome_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- ============================================================
-- 5. FEEDBACK PROPAGATION LOG
-- Track how feedback flows through the system
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback_propagation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source
    feedback_id UUID REFERENCES user_feedback(id) ON DELETE CASCADE,

    -- Target
    shard_id UUID REFERENCES procedural_shards(id) ON DELETE CASCADE,

    -- What changed?
    previous_outcome_score FLOAT,
    new_outcome_score FLOAT,
    score_delta FLOAT,

    -- Why?
    propagation_weight FLOAT,            -- How much of the feedback applied
    attribution_strength FLOAT,          -- How strongly attributed to this shard

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_prop_feedback ON feedback_propagation(feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_prop_shard ON feedback_propagation(shard_id);

-- ============================================================
-- 6. OUTCOME METRICS (System-wide tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS outcome_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Time period
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    period_type VARCHAR(20),             -- 'hourly', 'daily', 'weekly'

    -- Counts
    total_responses INTEGER DEFAULT 0,
    responses_with_feedback INTEGER DEFAULT 0,
    positive_feedback_count INTEGER DEFAULT 0,
    negative_feedback_count INTEGER DEFAULT 0,

    -- Rates
    feedback_rate FLOAT,                 -- % of responses that got feedback
    positive_rate FLOAT,                 -- % positive of those with feedback
    help_rate FLOAT,                     -- Overall helpfulness estimate

    -- Trends
    help_rate_change FLOAT,              -- Change from previous period

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcome_metrics_period ON outcome_metrics(period_start, period_type);

-- ============================================================
-- 7. INITIALIZE SHARD OUTCOMES FOR EXISTING SHARDS
-- ============================================================
INSERT INTO shard_outcomes (shard_id)
SELECT id FROM procedural_shards
WHERE id NOT IN (SELECT shard_id FROM shard_outcomes WHERE shard_id IS NOT NULL)
ON CONFLICT DO NOTHING;
