-- Add runtime_mode column to forge_agents
-- Allows agents to choose between legacy ReAct engine, SDK engine, or container runtime
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS runtime_mode VARCHAR(10) DEFAULT 'legacy'
  CHECK (runtime_mode IN ('legacy', 'sdk', 'container'));

-- Add runtime_mode column to forge_executions for tracking
ALTER TABLE forge_executions ADD COLUMN IF NOT EXISTS runtime_mode VARCHAR(10);

-- Add sdk_session_id for Claude Code session resume (Phase 5: ALF Chat)
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS sdk_session_id TEXT;
