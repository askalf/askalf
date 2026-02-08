-- Forge Observability
-- Cost events, audit log, guardrails, API keys, assistant
-- Apply: psql -U substrate -d forge -f 005_observability.sql

-- ============================================
-- COST EVENTS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_cost_events (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES forge_executions(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_cost_events_execution ON forge_cost_events(execution_id);
CREATE INDEX idx_forge_cost_events_owner ON forge_cost_events(owner_id);
CREATE INDEX idx_forge_cost_events_created ON forge_cost_events(created_at DESC);
CREATE INDEX idx_forge_cost_events_agent ON forge_cost_events(agent_id);

-- ============================================
-- AUDIT LOG
-- ============================================

CREATE TABLE IF NOT EXISTS forge_audit_log (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_audit_log_owner ON forge_audit_log(owner_id);
CREATE INDEX idx_forge_audit_log_action ON forge_audit_log(action);
CREATE INDEX idx_forge_audit_log_created ON forge_audit_log(created_at DESC);

-- ============================================
-- GUARDRAILS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_guardrails (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('content_filter', 'cost_limit', 'rate_limit', 'tool_restriction', 'output_filter', 'custom')),
  config JSONB NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_global BOOLEAN NOT NULL DEFAULT false,
  agent_ids TEXT[] NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_guardrails_owner ON forge_guardrails(owner_id);
CREATE INDEX idx_forge_guardrails_global ON forge_guardrails(is_global) WHERE is_global = true;

-- ============================================
-- API KEYS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_api_keys (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '["read", "write", "execute"]',
  rate_limit INTEGER NOT NULL DEFAULT 100,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_api_keys_owner ON forge_api_keys(owner_id);
CREATE INDEX idx_forge_api_keys_hash ON forge_api_keys(key_hash);

-- ============================================
-- USER ASSISTANTS (personal AI assistant)
-- ============================================

CREATE TABLE IF NOT EXISTS forge_user_assistants (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}',
  learned_patterns JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_interaction TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_user_assistants_owner ON forge_user_assistants(owner_id);

-- Triggers
CREATE TRIGGER trg_forge_guardrails_updated
  BEFORE UPDATE ON forge_guardrails
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

CREATE TRIGGER trg_forge_user_assistants_updated
  BEFORE UPDATE ON forge_user_assistants
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

-- ============================================
-- SEED DEFAULT GUARDRAILS
-- ============================================

INSERT INTO forge_guardrails (id, owner_id, name, description, type, config, is_global, priority)
VALUES
  ('guard_cost_default', 'system', 'Default Cost Limit', 'Limit per-execution cost to $5', 'cost_limit',
   '{"maxCostPerExecution": 5.00, "maxCostPerDay": 50.00}', true, 10),
  ('guard_rate_default', 'system', 'Default Rate Limit', 'Rate limit executions per user', 'rate_limit',
   '{"maxExecutionsPerMinute": 10, "maxExecutionsPerHour": 100}', true, 20)
ON CONFLICT (id) DO NOTHING;
