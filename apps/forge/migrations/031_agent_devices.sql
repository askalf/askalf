-- Migration 031: Agent Devices
-- Enables remote agent execution by tracking connected local agent devices.
-- Devices connect via WebSocket to receive platform-dispatched tasks.

-- Agent devices table: tracks user's local machines running askalf-agent
CREATE TABLE IF NOT EXISTS agent_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  hostname TEXT,
  os TEXT,
  platform_capabilities JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline', 'busy')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_devices_user_id ON agent_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_devices_tenant_id ON agent_devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_devices_status ON agent_devices(status);

-- Track which device executed a task
ALTER TABLE forge_executions ADD COLUMN IF NOT EXISTS device_id TEXT;
