-- Execution Steps — structured replay data for execution replay feature
-- Stores each step (tool_call, response, decision) as structured JSON

CREATE TABLE IF NOT EXISTS forge_execution_steps (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  execution_id TEXT NOT NULL REFERENCES forge_executions(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tool_call', 'response', 'decision')),
  content JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_execution_steps_execution ON forge_execution_steps(execution_id);
CREATE INDEX idx_forge_execution_steps_order ON forge_execution_steps(execution_id, step_number);
