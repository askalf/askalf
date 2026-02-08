-- Forge Core Schema
-- Providers, agents, executions, sessions
-- Apply: psql -U substrate -d forge -f 001_forge_schema.sql

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- PROVIDERS & MODELS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('openai', 'anthropic', 'google', 'xai', 'deepseek', 'ollama', 'lmstudio', 'custom')),
  base_url TEXT,
  api_key_encrypted TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'down', 'unknown')),
  last_health_check TIMESTAMPTZ,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forge_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES forge_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 128000,
  max_output INTEGER NOT NULL DEFAULT 4096,
  cost_per_1k_input NUMERIC(10, 6) NOT NULL DEFAULT 0,
  cost_per_1k_output NUMERIC(10, 6) NOT NULL DEFAULT 0,
  supports_tools BOOLEAN NOT NULL DEFAULT false,
  supports_vision BOOLEAN NOT NULL DEFAULT false,
  supports_streaming BOOLEAN NOT NULL DEFAULT true,
  is_reasoning BOOLEAN NOT NULL DEFAULT false,
  is_fast BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, model_id)
);

-- ============================================
-- AGENTS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_agents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL DEFAULT 'You are a helpful assistant.',
  model_id TEXT REFERENCES forge_models(id),
  provider_config JSONB NOT NULL DEFAULT '{"temperature": 0.7, "maxTokens": 4096}',
  autonomy_level INTEGER NOT NULL DEFAULT 2 CHECK (autonomy_level BETWEEN 0 AND 5),
  enabled_tools TEXT[] NOT NULL DEFAULT '{}',
  mcp_servers JSONB NOT NULL DEFAULT '[]',
  memory_config JSONB NOT NULL DEFAULT '{"enableWorking": true, "enableSemantic": false, "enableEpisodic": false, "enableProcedural": false, "semanticSearchK": 5}',
  max_iterations INTEGER NOT NULL DEFAULT 10,
  max_tokens_per_turn INTEGER NOT NULL DEFAULT 8192,
  max_cost_per_execution NUMERIC(10, 4) NOT NULL DEFAULT 1.00,
  is_public BOOLEAN NOT NULL DEFAULT false,
  is_template BOOLEAN NOT NULL DEFAULT false,
  forked_from TEXT REFERENCES forge_agents(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, slug)
);

CREATE INDEX idx_forge_agents_owner ON forge_agents(owner_id);
CREATE INDEX idx_forge_agents_status ON forge_agents(status);
CREATE INDEX idx_forge_agents_public ON forge_agents(is_public) WHERE is_public = true;
CREATE INDEX idx_forge_agents_template ON forge_agents(is_template) WHERE is_template = true;

-- ============================================
-- SESSIONS (Conversations)
-- ============================================

CREATE TABLE IF NOT EXISTS forge_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  title TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_sessions_agent ON forge_sessions(agent_id);
CREATE INDEX idx_forge_sessions_owner ON forge_sessions(owner_id);

-- ============================================
-- EXECUTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_executions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES forge_sessions(id) ON DELETE SET NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout')),
  input TEXT NOT NULL,
  output TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  tool_calls JSONB NOT NULL DEFAULT '[]',
  iterations INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_executions_agent ON forge_executions(agent_id);
CREATE INDEX idx_forge_executions_session ON forge_executions(session_id);
CREATE INDEX idx_forge_executions_owner ON forge_executions(owner_id);
CREATE INDEX idx_forge_executions_status ON forge_executions(status);
CREATE INDEX idx_forge_executions_created ON forge_executions(created_at DESC);

-- ============================================
-- TRIGGER: auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION forge_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forge_providers_updated
  BEFORE UPDATE ON forge_providers
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

CREATE TRIGGER trg_forge_agents_updated
  BEFORE UPDATE ON forge_agents
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

CREATE TRIGGER trg_forge_sessions_updated
  BEFORE UPDATE ON forge_sessions
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();
