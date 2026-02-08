-- SUBSTRATE v1: Initial Schema
-- 4-Tier Cognitive Memory Architecture

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- TIER 1: PROCEDURAL MEMORY (Logic Shards)
-- ============================================

CREATE TABLE IF NOT EXISTS procedural_shards (
    id              TEXT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    version         INTEGER DEFAULT 1 NOT NULL,

    logic           TEXT NOT NULL,
    input_schema    JSONB DEFAULT '{}' NOT NULL,
    output_schema   JSONB DEFAULT '{}' NOT NULL,

    patterns        JSONB DEFAULT '[]' NOT NULL,
    embedding       VECTOR(1536),
    pattern_hash    VARCHAR(64),

    confidence      REAL DEFAULT 0.5 NOT NULL,
    execution_count INTEGER DEFAULT 0 NOT NULL,
    success_count   INTEGER DEFAULT 0 NOT NULL,
    failure_count   INTEGER DEFAULT 0 NOT NULL,
    avg_latency_ms  INTEGER DEFAULT 0,
    tokens_saved    INTEGER DEFAULT 0,

    synthesis_method     VARCHAR(50) DEFAULT 'manual',
    synthesis_confidence REAL DEFAULT 0.0,
    source_trace_ids     TEXT[],

    lifecycle       VARCHAR(20) DEFAULT 'candidate' NOT NULL,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_executed   TIMESTAMPTZ,

    CONSTRAINT valid_lifecycle CHECK (lifecycle IN (
        'candidate', 'testing', 'shadow', 'promoted', 'archived', 'resurrected'
    ))
);

CREATE INDEX IF NOT EXISTS idx_shards_lifecycle ON procedural_shards(lifecycle);
CREATE INDEX IF NOT EXISTS idx_shards_embedding ON procedural_shards USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_shards_pattern_hash ON procedural_shards(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_shards_confidence ON procedural_shards(confidence DESC);

CREATE TABLE IF NOT EXISTS shard_executions (
    id              TEXT PRIMARY KEY,
    shard_id        TEXT NOT NULL REFERENCES procedural_shards(id) ON DELETE CASCADE,

    input           TEXT NOT NULL,
    output          TEXT,
    success         BOOLEAN NOT NULL,
    error           TEXT,

    execution_ms    INTEGER NOT NULL,
    tokens_saved    INTEGER DEFAULT 0,
    similarity_score REAL,

    session_id      TEXT,
    agent_id        TEXT,
    source          VARCHAR(50) DEFAULT 'api',

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exec_shard ON shard_executions(shard_id);
CREATE INDEX IF NOT EXISTS idx_exec_created ON shard_executions(created_at);

CREATE TABLE IF NOT EXISTS shard_evolutions (
    id              TEXT PRIMARY KEY,
    parent_shard_id TEXT NOT NULL REFERENCES procedural_shards(id) ON DELETE CASCADE,

    type            VARCHAR(20) NOT NULL,
    proposed_version INTEGER NOT NULL,
    proposed_logic  TEXT NOT NULL,

    reason          TEXT NOT NULL,
    evidence        TEXT[],

    status          VARCHAR(20) DEFAULT 'proposed' NOT NULL,

    shadow_success  INTEGER DEFAULT 0,
    shadow_failure  INTEGER DEFAULT 0,
    shadow_started  TIMESTAMPTZ,

    test_results    JSONB,
    shadow_results  JSONB,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evo_parent ON shard_evolutions(parent_shard_id);
CREATE INDEX IF NOT EXISTS idx_evo_status ON shard_evolutions(status);

-- ============================================
-- TIER 2: EPISODIC MEMORY (SAO Chains)
-- ============================================

CREATE TABLE IF NOT EXISTS episodes (
    id              TEXT PRIMARY KEY,

    situation       JSONB NOT NULL,
    action          JSONB NOT NULL,
    outcome         JSONB NOT NULL,

    type            VARCHAR(64) NOT NULL,
    summary         TEXT NOT NULL,

    success         BOOLEAN,
    valence         VARCHAR(20),
    importance      REAL DEFAULT 0.5 NOT NULL,
    lessons_learned JSONB DEFAULT '[]',

    embedding       VECTOR(1536),

    agent_id        TEXT,
    session_id      TEXT,
    related_shard_id TEXT REFERENCES procedural_shards(id),
    parent_episode_id TEXT REFERENCES episodes(id),

    metadata        JSONB DEFAULT '{}',
    timestamp       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_type ON episodes(type);
CREATE INDEX IF NOT EXISTS idx_episodes_success ON episodes(success);
CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_embedding ON episodes USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- TIER 3: SEMANTIC MEMORY (Truth Store)
-- ============================================

CREATE TABLE IF NOT EXISTS knowledge_facts (
    id              TEXT PRIMARY KEY,

    subject         TEXT NOT NULL,
    predicate       TEXT NOT NULL,
    object          TEXT NOT NULL,
    statement       TEXT NOT NULL,

    confidence      REAL DEFAULT 0.5 NOT NULL,
    access_count    INTEGER DEFAULT 0,
    verification_count INTEGER DEFAULT 0,
    contradiction_count INTEGER DEFAULT 0,

    sources         TEXT[],
    evidence        JSONB DEFAULT '[]',

    embedding       VECTOR(1536),
    category        VARCHAR(64),

    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    is_temporal     BOOLEAN DEFAULT FALSE,

    agent_id        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_accessed   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_facts_subject ON knowledge_facts(subject);
CREATE INDEX IF NOT EXISTS idx_facts_predicate ON knowledge_facts(predicate);
CREATE INDEX IF NOT EXISTS idx_facts_confidence ON knowledge_facts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_facts_embedding ON knowledge_facts USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS knowledge_relations (
    id              TEXT PRIMARY KEY,

    source_fact_id  TEXT NOT NULL REFERENCES knowledge_facts(id) ON DELETE CASCADE,
    target_fact_id  TEXT NOT NULL REFERENCES knowledge_facts(id) ON DELETE CASCADE,

    relation_type   VARCHAR(64) NOT NULL,
    strength        REAL DEFAULT 0.5 NOT NULL,

    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relations_source ON knowledge_relations(source_fact_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON knowledge_relations(target_fact_id);

-- ============================================
-- TIER 4: WORKING MEMORY (Context Liquidation)
-- ============================================

CREATE TABLE IF NOT EXISTS working_contexts (
    id              TEXT PRIMARY KEY,

    session_id      TEXT NOT NULL,
    agent_id        TEXT,

    raw_content     TEXT NOT NULL,
    content_type    VARCHAR(64) NOT NULL,

    extracted_facts JSONB DEFAULT '[]',
    extracted_entities JSONB DEFAULT '[]',
    noise_removed   TEXT[],

    status          VARCHAR(20) DEFAULT 'raw' NOT NULL,

    original_tokens INTEGER,
    liquidated_tokens INTEGER,
    compression_ratio REAL,

    ttl_seconds     INTEGER DEFAULT 3600,
    expires_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_working_session ON working_contexts(session_id);
CREATE INDEX IF NOT EXISTS idx_working_status ON working_contexts(status);
CREATE INDEX IF NOT EXISTS idx_working_expires ON working_contexts(expires_at);

-- ============================================
-- TRACES (Input to Crystallization)
-- ============================================

CREATE TABLE IF NOT EXISTS reasoning_traces (
    id              TEXT PRIMARY KEY,

    input           TEXT NOT NULL,
    reasoning       TEXT,
    output          TEXT NOT NULL,

    pattern_hash    VARCHAR(64) NOT NULL,
    embedding       VECTOR(1536),

    intent_category VARCHAR(50),
    intent_name     VARCHAR(100),
    intent_confidence REAL,
    output_structure VARCHAR(50),
    output_pattern  VARCHAR(100),

    tokens_used     INTEGER NOT NULL,
    execution_ms    INTEGER NOT NULL,
    model           VARCHAR(64),

    synthesized     BOOLEAN DEFAULT FALSE,
    replayed        BOOLEAN DEFAULT FALSE,
    attracted_to_shard TEXT REFERENCES procedural_shards(id),

    session_id      TEXT,
    agent_id        TEXT,
    source          VARCHAR(50) DEFAULT 'conversation',

    timestamp       TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traces_pattern ON reasoning_traces(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_traces_synthesized ON reasoning_traces(synthesized) WHERE synthesized = false;
CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON reasoning_traces(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_embedding ON reasoning_traces USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- SWARM: Blackboard
-- ============================================

CREATE TABLE IF NOT EXISTS blackboard_entries (
    id              TEXT PRIMARY KEY,

    namespace       VARCHAR(64) NOT NULL,
    entry_type      VARCHAR(64) NOT NULL,

    content         TEXT NOT NULL,
    structured_data JSONB DEFAULT '{}',

    source_agent    TEXT,
    target_agents   TEXT[],

    confidence      REAL DEFAULT 0.5 NOT NULL,
    priority        INTEGER DEFAULT 0,

    embedding       VECTOR(1536),

    status          VARCHAR(20) DEFAULT 'active',
    expires_at      TIMESTAMPTZ,

    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blackboard_namespace ON blackboard_entries(namespace);
CREATE INDEX IF NOT EXISTS idx_blackboard_type ON blackboard_entries(entry_type);

-- ============================================
-- TOKEN ECONOMICS
-- ============================================

CREATE TABLE IF NOT EXISTS token_economics (
    id              TEXT PRIMARY KEY,

    operation       VARCHAR(64) NOT NULL,
    entity_type     VARCHAR(64) NOT NULL,
    entity_id       TEXT,

    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    embedding_tokens INTEGER DEFAULT 0,

    provider        VARCHAR(64) NOT NULL,
    model           VARCHAR(64) NOT NULL,
    cost_usd        NUMERIC(10, 6) NOT NULL,

    tokens_saved    INTEGER DEFAULT 0,
    cost_saved_usd  NUMERIC(10, 6) DEFAULT 0,

    session_id      TEXT,
    agent_id        TEXT,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_economics_operation ON token_economics(operation);
CREATE INDEX IF NOT EXISTS idx_economics_created ON token_economics(created_at);

-- ============================================
-- AUDIT GATES
-- ============================================

CREATE TABLE IF NOT EXISTS audit_gates (
    id              TEXT PRIMARY KEY,

    gate_type       VARCHAR(64) NOT NULL,
    entity_type     VARCHAR(64) NOT NULL,
    entity_id       TEXT,

    decision        VARCHAR(20) NOT NULL,
    score           REAL,

    checks_performed JSONB NOT NULL,
    issues          TEXT[],
    warnings        TEXT[],

    gate_latency_ms INTEGER,

    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gates_type ON audit_gates(gate_type);
CREATE INDEX IF NOT EXISTS idx_gates_decision ON audit_gates(decision);

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION find_similar_shards(
    query_embedding VECTOR(1536),
    similarity_threshold REAL DEFAULT 0.7,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
    shard_id TEXT,
    name VARCHAR(255),
    confidence REAL,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ps.id,
        ps.name,
        ps.confidence,
        1 - (ps.embedding <=> query_embedding) as similarity
    FROM procedural_shards ps
    WHERE ps.lifecycle = 'promoted'
        AND ps.embedding IS NOT NULL
        AND 1 - (ps.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY ps.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shards_updated_at ON procedural_shards;
CREATE TRIGGER trg_shards_updated_at
    BEFORE UPDATE ON procedural_shards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_facts_updated_at ON knowledge_facts;
CREATE TRIGGER trg_facts_updated_at
    BEFORE UPDATE ON knowledge_facts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_contexts_updated_at ON working_contexts;
CREATE TRIGGER trg_contexts_updated_at
    BEFORE UPDATE ON working_contexts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_evolutions_updated_at ON shard_evolutions;
CREATE TRIGGER trg_evolutions_updated_at
    BEFORE UPDATE ON shard_evolutions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_blackboard_updated_at ON blackboard_entries;
CREATE TRIGGER trg_blackboard_updated_at
    BEFORE UPDATE ON blackboard_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
