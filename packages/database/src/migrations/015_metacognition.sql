-- Migration 015: Metacognition System
-- Enables self-reflective AI capabilities

-- Meta shard type tracking
ALTER TABLE procedural_shards ADD COLUMN IF NOT EXISTS
  shard_type VARCHAR(20) DEFAULT 'standard';
-- Values: standard, reflection, strategy, learning, correction

COMMENT ON COLUMN procedural_shards.shard_type IS 'Type of shard: standard, reflection, strategy, learning, correction';

-- Metacognition events log
CREATE TABLE IF NOT EXISTS metacognition_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Event classification
  event_type VARCHAR(50) NOT NULL,
  -- Types: reflection, strategy_decision, learning_proposal, correction, quality_check, confidence_adjustment

  -- Context
  trigger_shard_id TEXT REFERENCES procedural_shards(id),
  target_shard_id TEXT REFERENCES procedural_shards(id),
  session_id TEXT,
  tenant_id TEXT REFERENCES tenants(id),
  trace_id TEXT REFERENCES reasoning_traces(id),

  -- Analysis payload
  analysis JSONB NOT NULL DEFAULT '{}',
  -- For reflection: { quality_score, relevance, completeness, suggestions }
  -- For strategy: { decision, reason, alternatives_considered }
  -- For learning: { pattern_detected, cluster_size, proposed_shard }
  -- For correction: { error_type, severity, fix_applied }

  -- Metrics
  confidence REAL,
  processing_time_ms INTEGER,

  -- Outcome
  action_taken TEXT,
  outcome TEXT,
  success BOOLEAN,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for metacognition queries
CREATE INDEX IF NOT EXISTS idx_meta_events_type ON metacognition_events(event_type);
CREATE INDEX IF NOT EXISTS idx_meta_events_tenant ON metacognition_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meta_events_created ON metacognition_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_events_shard ON metacognition_events(trigger_shard_id) WHERE trigger_shard_id IS NOT NULL;

-- Quality metrics tracking
CREATE TABLE IF NOT EXISTS response_quality_metrics (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  trace_id TEXT REFERENCES reasoning_traces(id),
  session_id TEXT,
  tenant_id TEXT REFERENCES tenants(id),

  -- Automated metrics
  relevance_score REAL,         -- 0-1: How relevant was response to query
  completeness_score REAL,      -- 0-1: How complete was the response
  confidence_alignment REAL,    -- 0-1: Was stated confidence accurate
  response_time_ms INTEGER,

  -- User feedback (optional)
  user_rating INTEGER,          -- 1-5 stars
  user_feedback TEXT,
  thumbs_up BOOLEAN,

  -- Analysis
  improvement_suggestions TEXT[],
  flagged_issues TEXT[],

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_trace ON response_quality_metrics(trace_id);
CREATE INDEX IF NOT EXISTS idx_quality_tenant ON response_quality_metrics(tenant_id);

-- Shard performance tracking (for metacognitive confidence adjustment)
CREATE TABLE IF NOT EXISTS shard_performance (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  shard_id TEXT NOT NULL REFERENCES procedural_shards(id),

  -- Period tracking
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  -- Execution metrics
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  failed_executions INTEGER DEFAULT 0,

  -- Quality metrics
  avg_confidence REAL,
  avg_user_rating REAL,
  thumbs_up_count INTEGER DEFAULT 0,
  thumbs_down_count INTEGER DEFAULT 0,

  -- Performance metrics
  avg_response_time_ms INTEGER,
  tokens_saved INTEGER DEFAULT 0,

  -- Confidence adjustment
  confidence_delta REAL DEFAULT 0,
  adjustment_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perf_shard ON shard_performance(shard_id);
CREATE INDEX IF NOT EXISTS idx_perf_period ON shard_performance(period_start, period_end);

-- Function to record metacognition event
CREATE OR REPLACE FUNCTION record_metacognition_event(
  p_event_type VARCHAR(50),
  p_analysis JSONB,
  p_tenant_id TEXT DEFAULT NULL,
  p_trigger_shard_id TEXT DEFAULT NULL,
  p_target_shard_id TEXT DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL,
  p_confidence REAL DEFAULT NULL,
  p_action_taken TEXT DEFAULT NULL,
  p_outcome TEXT DEFAULT NULL,
  p_success BOOLEAN DEFAULT NULL,
  p_processing_time_ms INTEGER DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_event_id TEXT;
BEGIN
  INSERT INTO metacognition_events (
    event_type, analysis, tenant_id, trigger_shard_id, target_shard_id,
    trace_id, session_id, confidence, action_taken, outcome, success, processing_time_ms
  ) VALUES (
    p_event_type, p_analysis, p_tenant_id, p_trigger_shard_id, p_target_shard_id,
    p_trace_id, p_session_id, p_confidence, p_action_taken, p_outcome, p_success, p_processing_time_ms
  ) RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- Function to adjust shard confidence based on performance
CREATE OR REPLACE FUNCTION adjust_shard_confidence(
  p_shard_id TEXT,
  p_adjustment REAL,
  p_reason TEXT
) RETURNS REAL AS $$
DECLARE
  v_current_confidence REAL;
  v_new_confidence REAL;
BEGIN
  SELECT confidence INTO v_current_confidence
  FROM procedural_shards
  WHERE id = p_shard_id;

  IF v_current_confidence IS NULL THEN
    RETURN NULL;
  END IF;

  -- Clamp to 0.0-1.0 range
  v_new_confidence := GREATEST(0.0, LEAST(1.0, v_current_confidence + p_adjustment));

  UPDATE procedural_shards
  SET confidence = v_new_confidence, updated_at = NOW()
  WHERE id = p_shard_id;

  -- Log the adjustment
  PERFORM record_metacognition_event(
    'confidence_adjustment',
    jsonb_build_object(
      'shard_id', p_shard_id,
      'previous_confidence', v_current_confidence,
      'new_confidence', v_new_confidence,
      'adjustment', p_adjustment,
      'reason', p_reason
    ),
    NULL,
    p_shard_id,
    NULL,
    NULL,
    NULL,
    v_new_confidence,
    'confidence_adjusted',
    p_reason,
    true,
    NULL
  );

  RETURN v_new_confidence;
END;
$$ LANGUAGE plpgsql;

-- Function to get metacognition summary
CREATE OR REPLACE FUNCTION get_metacognition_summary(
  p_hours INTEGER DEFAULT 24
) RETURNS TABLE(
  event_type VARCHAR(50),
  event_count BIGINT,
  avg_confidence REAL,
  success_rate REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.event_type,
    COUNT(*)::BIGINT as event_count,
    AVG(me.confidence)::REAL as avg_confidence,
    (COUNT(*) FILTER (WHERE me.success = true)::REAL / NULLIF(COUNT(*), 0))::REAL as success_rate
  FROM metacognition_events me
  WHERE me.created_at > NOW() - (p_hours || ' hours')::INTERVAL
  GROUP BY me.event_type
  ORDER BY event_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Insert built-in meta shards
INSERT INTO procedural_shards (id, name, description, shard_type, lifecycle, confidence, version, patterns, logic)
VALUES
  (
    'meta_quality_check',
    'Response Quality Checker',
    'Evaluates response quality after each LLM call',
    'reflection',
    'promoted',
    0.95,
    1,
    ARRAY['[after_response]'],
    'Evaluate: relevance (0-1), completeness (0-1), confidence_alignment. If any < 0.7, flag for review.'
  ),
  (
    'meta_model_router',
    'Model Router',
    'Selects optimal model based on query characteristics',
    'strategy',
    'promoted',
    0.90,
    1,
    ARRAY['[before_llm_call]'],
    'Route based on query: math/code → gpt-4o, creative → claude, speed → gemini-flash, reasoning → o1'
  ),
  (
    'meta_pattern_detector',
    'Pattern Detector',
    'Identifies patterns for shard crystallization',
    'learning',
    'promoted',
    0.85,
    1,
    ARRAY['[every_100_responses]'],
    'Cluster recent traces by intent. If cluster size > 5 with >90% similarity, propose crystallization.'
  ),
  (
    'meta_error_handler',
    'Error Handler',
    'Handles errors and user corrections',
    'correction',
    'promoted',
    0.90,
    1,
    ARRAY['[on_user_correction]', '[on_negative_feedback]'],
    'Log correction, adjust related shard confidence by -0.1, propose pattern update if recurring.'
  )
ON CONFLICT (id) DO UPDATE SET
  description = EXCLUDED.description,
  shard_type = EXCLUDED.shard_type,
  updated_at = NOW();
