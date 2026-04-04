-- Migration 006: Agent capabilities, performance tracking, and Phase 3 schema
-- Adds missing columns to forge_agents that Phase 2 orchestration code references,
-- creates agent_capabilities table for skill tracking.

BEGIN;

-- ============================================================
-- 1. Add missing columns to forge_agents
-- ============================================================

-- Performance counters (referenced by agent-matcher.ts, replanner.ts)
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS tasks_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS tasks_failed INTEGER NOT NULL DEFAULT 0;

-- Decommission flag (referenced by replanner.ts, agent-matcher.ts)
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS is_decommissioned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS decommissioned_at TIMESTAMPTZ;

-- Dedicated type column (currently stored in metadata.type, now first-class)
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'custom';

-- Index for type-based queries (agent matching uses this)
CREATE INDEX IF NOT EXISTS idx_forge_agents_type ON forge_agents(type);

-- ============================================================
-- 2. Backfill performance counters from execution history
-- ============================================================

UPDATE forge_agents a SET
  tasks_completed = COALESCE(s.completed, 0),
  tasks_failed = COALESCE(s.failed, 0)
FROM (
  SELECT agent_id,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed
  FROM forge_executions
  GROUP BY agent_id
) s
WHERE a.id = s.agent_id;

-- Backfill type from metadata where available (normalize to short names)
UPDATE forge_agents
SET type = CASE metadata->>'type'
  WHEN 'development' THEN 'dev'
  WHEN 'monitoring' THEN 'monitor'
  ELSE COALESCE(metadata->>'type', 'custom')
END
WHERE metadata->>'type' IS NOT NULL
  AND metadata->>'type' != '';

-- ============================================================
-- 3. Agent capabilities table
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_agent_capabilities (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,            -- e.g. 'code_review', 'web_research', 'data_analysis'
  category TEXT NOT NULL DEFAULT 'general', -- 'development', 'research', 'communication', 'analysis', 'general'
  proficiency INTEGER NOT NULL DEFAULT 50 CHECK (proficiency >= 0 AND proficiency <= 100),
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms INTEGER,
  avg_cost NUMERIC(10,6),
  last_used TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'auto',  -- 'auto' (detected), 'manual' (user assigned), 'learned' (from executions)
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent ON forge_agent_capabilities(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_capability ON forge_agent_capabilities(capability);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_capabilities_unique ON forge_agent_capabilities(agent_id, capability);

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER trg_agent_capabilities_updated
  BEFORE UPDATE ON forge_agent_capabilities
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

-- ============================================================
-- 4. Capability definitions (shared catalog)
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_capability_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  required_tools TEXT[] NOT NULL DEFAULT '{}',
  keywords TEXT[] NOT NULL DEFAULT '{}',  -- for auto-detection from system prompts
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed capability catalog with common capabilities
INSERT INTO forge_capability_catalog (id, name, display_name, description, category, required_tools, keywords)
VALUES
  ('cap_code_review', 'code_review', 'Code Review', 'Review and analyze source code for quality, bugs, and improvements', 'development', '{code_exec}', '{code,review,bug,quality,lint,refactor}'),
  ('cap_web_research', 'web_research', 'Web Research', 'Search the web and synthesize information from multiple sources', 'research', '{web_search,web_browse}', '{research,search,find,investigate,analyze}'),
  ('cap_code_writing', 'code_writing', 'Code Writing', 'Write and generate source code in various languages', 'development', '{code_exec}', '{write,code,implement,build,develop,program}'),
  ('cap_data_analysis', 'data_analysis', 'Data Analysis', 'Analyze datasets and extract insights', 'analysis', '{code_exec}', '{data,analysis,statistics,metrics,chart,graph}'),
  ('cap_content_creation', 'content_creation', 'Content Creation', 'Write articles, documentation, and other content', 'communication', '{}', '{write,content,article,documentation,blog,copy}'),
  ('cap_api_integration', 'api_integration', 'API Integration', 'Interact with external APIs and services', 'development', '{api_call}', '{api,integration,endpoint,rest,webhook}'),
  ('cap_monitoring', 'monitoring', 'System Monitoring', 'Monitor systems, logs, and metrics for anomalies', 'operations', '{}', '{monitor,alert,log,metric,health,uptime}'),
  ('cap_memory_management', 'memory_management', 'Memory Management', 'Store, recall, and organize knowledge across executions', 'cognitive', '{memory_search,memory_store}', '{memory,remember,recall,knowledge,learn}'),
  ('cap_agent_orchestration', 'agent_orchestration', 'Agent Orchestration', 'Coordinate and manage other agents for complex tasks', 'orchestration', '{agent_call}', '{orchestrate,coordinate,delegate,agent,fleet}'),
  ('cap_troubleshooting', 'troubleshooting', 'Troubleshooting', 'Diagnose and resolve technical issues', 'operations', '{code_exec,web_search}', '{debug,troubleshoot,fix,diagnose,error,issue}')
ON CONFLICT (name) DO NOTHING;

COMMIT;
