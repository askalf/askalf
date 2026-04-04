-- Migration 034: Active Goal System
-- Extends goals with hierarchical decomposition, progress tracking, and cost budgets.

ALTER TABLE forge_agent_goals
  ADD COLUMN IF NOT EXISTS parent_goal_id TEXT REFERENCES forge_agent_goals(id),
  ADD COLUMN IF NOT EXISTS progress NUMERIC(5,2) DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS target_metric TEXT,
  ADD COLUMN IF NOT EXISTS current_value NUMERIC,
  ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_cost_usd NUMERIC(10,4) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(10,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS execution_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_forge_agent_goals_parent ON forge_agent_goals(parent_goal_id);
CREATE INDEX IF NOT EXISTS idx_forge_agent_goals_status ON forge_agent_goals(agent_id, status);

CREATE TABLE IF NOT EXISTS forge_goal_executions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES forge_agent_goals(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  progress_delta NUMERIC(5,2) DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_goal_executions_goal ON forge_goal_executions(goal_id);
