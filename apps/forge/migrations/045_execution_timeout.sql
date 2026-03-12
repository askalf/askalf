-- Migration 045: Execution timeout per agent
-- Adds configurable execution timeout to forge_agents.
-- Default: 10 minutes. Dispatcher enforces this by killing and marking hung tasks.

ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS execution_timeout_minutes INTEGER DEFAULT 10;
