-- Migration 008: Advanced Features (Phases 6-14)
-- Self-rewriting prompts, knowledge graph, agent evolution, goal proposals,
-- cost optimization, monitoring, execution replay.

BEGIN;

-- ============================================================
-- Phase 6: Self-Rewriting System Prompts
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_prompt_revisions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  current_prompt TEXT NOT NULL,
  proposed_prompt TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  correction_patterns_used TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_revisions_agent ON forge_prompt_revisions(agent_id);
CREATE INDEX IF NOT EXISTS idx_prompt_revisions_status ON forge_prompt_revisions(status);

-- ============================================================
-- Phase 9: Autonomous Goal-Setting
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_agent_goals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rationale TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual', 'correction', 'pattern')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'in_progress', 'completed', 'rejected')),
  execution_id TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_goals_agent ON forge_agent_goals(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_goals_status ON forge_agent_goals(status);

-- ============================================================
-- Phase 10: Cost Optimization
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_cost_profiles (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  model_id TEXT NOT NULL,
  avg_cost NUMERIC(10,6) NOT NULL DEFAULT 0,
  avg_tokens INTEGER NOT NULL DEFAULT 0,
  avg_quality NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(capability, model_id)
);

CREATE INDEX IF NOT EXISTS idx_cost_profiles_capability ON forge_cost_profiles(capability);

-- ============================================================
-- Phase 11: Knowledge Graph
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_knowledge_nodes (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  label TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'concept',
  description TEXT,
  properties JSONB NOT NULL DEFAULT '{}',
  embedding VECTOR(1536),
  mention_count INTEGER NOT NULL DEFAULT 1,
  last_mentioned TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type ON forge_knowledge_nodes(entity_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_label ON forge_knowledge_nodes(label);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_embedding ON forge_knowledge_nodes
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS forge_knowledge_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES forge_knowledge_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES forge_knowledge_nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  weight NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  properties JSONB NOT NULL DEFAULT '{}',
  source_memory_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source ON forge_knowledge_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target ON forge_knowledge_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_relation ON forge_knowledge_edges(relation);

-- ============================================================
-- Phase 13: Agent Cloning & Evolution
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_evolution_experiments (
  id TEXT PRIMARY KEY,
  parent_agent_id TEXT NOT NULL REFERENCES forge_agents(id),
  variant_agent_id TEXT NOT NULL REFERENCES forge_agents(id),
  mutation_type TEXT NOT NULL CHECK (mutation_type IN ('prompt', 'tools', 'model', 'config', 'combined')),
  mutation_description TEXT NOT NULL,
  test_task TEXT NOT NULL,
  parent_score NUMERIC(5,2),
  variant_score NUMERIC(5,2),
  winner TEXT CHECK (winner IN ('parent', 'variant', 'tie', 'pending')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  results JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_evolution_parent ON forge_evolution_experiments(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_evolution_status ON forge_evolution_experiments(status);

-- ============================================================
-- Phase 14: Execution Event Log (for replay)
-- ============================================================

CREATE TABLE IF NOT EXISTS forge_event_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  session_id TEXT,
  execution_id TEXT,
  agent_id TEXT,
  agent_name TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_log_session ON forge_event_log(session_id);
CREATE INDEX IF NOT EXISTS idx_event_log_execution ON forge_event_log(execution_id);
CREATE INDEX IF NOT EXISTS idx_event_log_type ON forge_event_log(event_type, event_name);
CREATE INDEX IF NOT EXISTS idx_event_log_time ON forge_event_log(created_at DESC);

COMMIT;
