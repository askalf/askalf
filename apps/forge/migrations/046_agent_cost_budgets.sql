-- Per-agent daily cost budgets with auto-pause
-- Adds cost_budget_daily column and budget_paused_at tracking

ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS cost_budget_daily NUMERIC(10, 4) DEFAULT NULL;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS budget_paused_at TIMESTAMPTZ DEFAULT NULL;
