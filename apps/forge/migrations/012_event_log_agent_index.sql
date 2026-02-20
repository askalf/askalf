-- Level 18: Add missing index on forge_event_log.agent_id
-- Event replay queries filter by agent_id but no index existed.

CREATE INDEX IF NOT EXISTS idx_forge_event_log_agent_id
ON forge_event_log (agent_id);
