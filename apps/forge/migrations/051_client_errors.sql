-- Client-side error reporting table
CREATE TABLE IF NOT EXISTS client_errors (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  stack TEXT,
  component_stack TEXT,
  url TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at DESC);
