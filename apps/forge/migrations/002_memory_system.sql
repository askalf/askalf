-- Forge Memory System
-- Semantic, episodic, procedural memory with pgvector
-- Apply: psql -U substrate -d forge -f 002_memory_system.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- SEMANTIC MEMORIES (long-term knowledge)
-- ============================================

CREATE TABLE IF NOT EXISTS forge_semantic_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  source TEXT,
  importance NUMERIC(3, 2) NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_semantic_agent ON forge_semantic_memories(agent_id);
CREATE INDEX idx_forge_semantic_owner ON forge_semantic_memories(owner_id);
CREATE INDEX idx_forge_semantic_embedding ON forge_semantic_memories
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================
-- EPISODIC MEMORIES (situation-action-outcome)
-- ============================================

CREATE TABLE IF NOT EXISTS forge_episodic_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  situation TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_quality NUMERIC(3, 2) NOT NULL DEFAULT 0.5 CHECK (outcome_quality BETWEEN 0 AND 1),
  embedding VECTOR(1536),
  execution_id TEXT REFERENCES forge_executions(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_episodic_agent ON forge_episodic_memories(agent_id);
CREATE INDEX idx_forge_episodic_quality ON forge_episodic_memories(outcome_quality DESC);
CREATE INDEX idx_forge_episodic_embedding ON forge_episodic_memories
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================
-- PROCEDURAL MEMORIES (learned tool-use patterns)
-- ============================================

CREATE TABLE IF NOT EXISTS forge_procedural_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  trigger_pattern TEXT NOT NULL,
  tool_sequence JSONB NOT NULL DEFAULT '[]',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  embedding VECTOR(1536),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_procedural_agent ON forge_procedural_memories(agent_id);
CREATE INDEX idx_forge_procedural_confidence ON forge_procedural_memories(confidence DESC);
CREATE INDEX idx_forge_procedural_embedding ON forge_procedural_memories
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Triggers
CREATE TRIGGER trg_forge_semantic_updated
  BEFORE UPDATE ON forge_semantic_memories
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

CREATE TRIGGER trg_forge_procedural_updated
  BEFORE UPDATE ON forge_procedural_memories
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();
