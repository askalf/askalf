-- Migration 035: Add priority field to forge_executions
-- High priority executions are processed before normal ones in the CLI queue.

ALTER TABLE forge_executions
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS idx_forge_executions_priority
  ON forge_executions (priority, created_at)
  WHERE status = 'pending';
