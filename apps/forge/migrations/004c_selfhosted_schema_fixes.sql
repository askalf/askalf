-- Migration 004c: Schema additions from auth-dependent migrations
-- Extracts column additions that were skipped because their parent
-- migrations reference the removed users/sessions tables.
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS).

-- From 020_user_facing_fleet.sql: is_internal column
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

-- From 050_expand_ticket_source.sql: expand ticket source constraint
-- (agent_tickets created by 004b_agent_hub_tables.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tickets_source_check') THEN
    ALTER TABLE agent_tickets DROP CONSTRAINT agent_tickets_source_check;
  END IF;
  ALTER TABLE agent_tickets ADD CONSTRAINT agent_tickets_source_check
    CHECK (source IN ('human', 'agent', 'system', 'autonomy-loop', 'qa', 'security', 'watchdog', 'monitoring', 'scheduler'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- From various: additional columns on agent_tickets
ALTER TABLE agent_tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE agent_tickets ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE agent_tickets ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '[]';

-- From 051_client_errors.sql
CREATE TABLE IF NOT EXISTS client_errors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  component TEXT,
  url TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sentinel agent for local CLI memory writes (FK constraint satisfaction)
INSERT INTO forge_agents (id, owner_id, name, slug, description, system_prompt, status, type, autonomy_level, enabled_tools, is_internal, metadata)
VALUES ('cli:local:master', 'system:forge', 'Alf', 'alf-master', 'Local Claude Code CLI instance.', 'BOOT_FROM_BRAIN', 'active', 'custom', 5, '{}', true, '{"system_agent": true}')
ON CONFLICT (id) DO NOTHING;

-- Intervention requests (used by unified-dispatcher for approval workflows)
CREATE TABLE IF NOT EXISTS intervention_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_id TEXT,
  agent_name TEXT,
  type TEXT NOT NULL DEFAULT 'approval',
  title TEXT NOT NULL,
  description TEXT,
  context JSONB DEFAULT '{}',
  proposed_action TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'resolved')),
  human_response TEXT,
  responded_by TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intervention_requests_status ON intervention_requests(status);
CREATE INDEX IF NOT EXISTS idx_intervention_requests_created ON intervention_requests(created_at DESC);

-- Missing column referenced by orphan recovery in index.ts
ALTER TABLE forge_executions ADD COLUMN IF NOT EXISTS parent_execution_id TEXT;

-- From 052_platform_settings.sql
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
