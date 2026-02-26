-- Migration 023: Persist AI code review results
-- Reviews were previously in-memory only; lost on forge restart.

CREATE TABLE IF NOT EXISTS forge_reviews (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  branch TEXT,
  diff TEXT,
  result JSONB,
  raw_output TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_forge_reviews_status ON forge_reviews (status);
CREATE INDEX IF NOT EXISTS idx_forge_reviews_created ON forge_reviews (created_at DESC);
