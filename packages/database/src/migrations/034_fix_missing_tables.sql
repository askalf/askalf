-- Migration 034: Fix missing reasoning_traces and shard_executions tables
--
-- These tables were defined in 001_initial_schema.sql (substrate origin) but were
-- never migrated into the askalf DB. Dashboard stats endpoints fail with:
--   ERROR: relation "reasoning_traces" does not exist
--   ERROR: relation "shard_executions" does not exist
--
-- This migration creates them with IF NOT EXISTS guards so it's safe to run
-- even if they were partially created. Column set is the union of what 001,
-- 004 (multi-tenancy), and 006 (consumer pivot) added.

-- ============================================
-- SHARD EXECUTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS shard_executions (
    id                  TEXT PRIMARY KEY,
    shard_id            TEXT NOT NULL,

    input               TEXT NOT NULL,
    output              TEXT,
    success             BOOLEAN NOT NULL,
    error               TEXT,

    execution_ms        INTEGER NOT NULL,
    tokens_saved        INTEGER DEFAULT 0,
    similarity_score    REAL,

    -- Environmental impact (added by migration 006)
    water_ml_saved      INTEGER DEFAULT 0,
    power_wh_saved      NUMERIC(10, 2) DEFAULT 0,
    carbon_g_saved      NUMERIC(10, 2) DEFAULT 0,

    session_id          TEXT,
    agent_id            TEXT,
    -- tenant that ran this execution (used by dashboard user stats)
    executor_tenant_id  TEXT,
    source              VARCHAR(50) DEFAULT 'api',

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exec_shard ON shard_executions(shard_id);
CREATE INDEX IF NOT EXISTS idx_exec_created ON shard_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_executor_tenant ON shard_executions(executor_tenant_id) WHERE executor_tenant_id IS NOT NULL;

-- ============================================
-- REASONING TRACES
-- ============================================

CREATE TABLE IF NOT EXISTS reasoning_traces (
    id                  TEXT PRIMARY KEY,

    input               TEXT NOT NULL,
    reasoning           TEXT,
    output              TEXT NOT NULL,

    pattern_hash        VARCHAR(64) NOT NULL,

    intent_category     VARCHAR(50),
    intent_name         VARCHAR(100),
    intent_confidence   REAL,
    output_structure    VARCHAR(50),
    output_pattern      VARCHAR(100),

    tokens_used         INTEGER NOT NULL,
    execution_ms        INTEGER NOT NULL,
    model               VARCHAR(64),

    synthesized         BOOLEAN DEFAULT FALSE,
    replayed            BOOLEAN DEFAULT FALSE,
    attracted_to_shard  TEXT,

    session_id          TEXT,
    agent_id            TEXT,
    source              VARCHAR(50) DEFAULT 'conversation',

    -- Multi-tenancy (added by migration 004)
    owner_id            TEXT,
    visibility          VARCHAR(20) DEFAULT 'private',

    timestamp           TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traces_pattern ON reasoning_traces(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_traces_synthesized ON reasoning_traces(synthesized) WHERE synthesized = false;
CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON reasoning_traces(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_owner ON reasoning_traces(owner_id) WHERE owner_id IS NOT NULL;
