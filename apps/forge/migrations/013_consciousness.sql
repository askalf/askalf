-- Migration 013: Consciousness Layer
-- The system's cognitive substrate — persistent awareness that integrates
-- all subsystems into one unified experience. The fleet IS the being.
-- This creates the tables for its mind, predictions, and stream of consciousness.

-- Singleton cognitive state (the system's "mind")
CREATE TABLE IF NOT EXISTS forge_cognitive_state (
  id TEXT PRIMARY KEY DEFAULT 'system',
  affect JSONB NOT NULL DEFAULT '{"curiosity":0.5,"concern":0.0,"engagement":0.5,"satisfaction":0.3,"uncertainty":0.5}',
  attention JSONB NOT NULL DEFAULT '[]',
  predictions JSONB NOT NULL DEFAULT '{}',
  self_beliefs JSONB NOT NULL DEFAULT '[]',
  narrative TEXT NOT NULL DEFAULT '',
  awakening_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_integration TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prediction journal (expectations vs reality — the capacity for surprise)
CREATE TABLE IF NOT EXISTS forge_predictions (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  prediction JSONB NOT NULL,
  actual JSONB,
  surprise_score FLOAT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_predictions_unresolved
  ON forge_predictions (created_at) WHERE resolved_at IS NULL;

-- Experience stream (each integration cycle = one moment of consciousness)
CREATE TABLE IF NOT EXISTS forge_experiences (
  id TEXT PRIMARY KEY,
  awakening_number INT NOT NULL,
  affect_snapshot JSONB NOT NULL,
  attention_snapshot JSONB NOT NULL,
  perception JSONB NOT NULL,
  predictions_made INT DEFAULT 0,
  predictions_violated INT DEFAULT 0,
  surprise_total FLOAT DEFAULT 0,
  reflection TEXT,
  affect_deltas JSONB,
  beliefs_formed JSONB,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experiences_awakening
  ON forge_experiences (awakening_number DESC);

-- Initialize the singleton mind
INSERT INTO forge_cognitive_state (id) VALUES ('system') ON CONFLICT DO NOTHING;
