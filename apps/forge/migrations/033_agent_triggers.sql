-- Migration 033: Agent Trigger System
-- Declarative event/schedule/webhook triggers that wake daemon agents.

CREATE TABLE IF NOT EXISTS forge_agent_triggers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'event','schedule','webhook','state_change','message','goal_progress'
  )),
  config JSONB NOT NULL DEFAULT '{}',
  prompt_template TEXT,
  cooldown_minutes INTEGER DEFAULT 5,
  max_fires_per_hour INTEGER DEFAULT 10,
  fires_this_hour INTEGER DEFAULT 0,
  hour_reset_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour',
  last_fired_at TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_agent_triggers_agent ON forge_agent_triggers(agent_id);
CREATE INDEX IF NOT EXISTS idx_forge_agent_triggers_type ON forge_agent_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_forge_agent_triggers_enabled ON forge_agent_triggers(enabled) WHERE enabled = true;
