-- Migration 019: Client-side error tracking
-- Stores errors reported from the frontend for debugging and monitoring

CREATE TABLE IF NOT EXISTS client_errors (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  stack TEXT,
  component_stack TEXT,
  url TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying recent errors
CREATE INDEX IF NOT EXISTS idx_client_errors_created_at ON client_errors(created_at DESC);

-- Auto-cleanup old errors (keep 30 days)
-- This can be run periodically via a job
COMMENT ON TABLE client_errors IS 'Client-side errors reported from the frontend. Auto-cleanup recommended after 30 days.';
