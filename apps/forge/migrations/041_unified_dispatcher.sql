-- Migration 041: Unified Dispatcher
-- Consolidates agent_schedules + daemon config into forge_agents.
-- Adds global dispatcher config table.

-- 1. Add scheduling columns to forge_agents
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS schedule_interval_minutes INTEGER DEFAULT 360;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS dispatch_enabled BOOLEAN DEFAULT true;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS max_session_cost_usd NUMERIC(10,4) DEFAULT 5.00;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS dispatch_mode TEXT DEFAULT 'scheduled';

-- 2. Global dispatcher config (kill switch + settings)
CREATE TABLE IF NOT EXISTS forge_dispatcher_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO forge_dispatcher_config (key, value) VALUES
  ('enabled', 'true'::jsonb),
  ('max_concurrent_total', '8'::jsonb)
ON CONFLICT DO NOTHING;
