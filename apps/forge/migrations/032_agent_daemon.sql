-- Migration 032: Agent Daemon Process Manager
-- Adds persistent daemon lifecycle tracking and runtime_mode to agents.

CREATE TABLE IF NOT EXISTS forge_agent_daemons (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE REFERENCES forge_agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'stopped'
    CHECK (status IN ('stopped','starting','idle','thinking','acting','paused','hibernated','error')),
  started_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ,
  session_cost_usd NUMERIC(10,4) DEFAULT 0,
  session_executions INTEGER DEFAULT 0,
  current_goal_id TEXT,
  current_execution_id TEXT,
  idle_since TIMESTAMPTZ,
  max_idle_minutes INTEGER DEFAULT 30,
  max_session_cost_usd NUMERIC(10,4) DEFAULT 5.00,
  consecutive_errors INTEGER DEFAULT 0,
  last_error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_agent_daemons_status ON forge_agent_daemons(status);
CREATE INDEX IF NOT EXISTS idx_forge_agent_daemons_agent_id ON forge_agent_daemons(agent_id);

ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS runtime_mode TEXT
  DEFAULT 'oneshot' CHECK (runtime_mode IN ('oneshot', 'daemon'));
