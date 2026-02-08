-- SUBSTRATE v1: Add System Visibility Level
-- Adds 'system' to visibility constraints for system-level shards
-- Also adds visibility column to working_contexts

-- ============================================
-- ADD VISIBILITY TO WORKING CONTEXTS
-- ============================================

ALTER TABLE working_contexts
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private';

-- ============================================
-- UPDATE VISIBILITY CONSTRAINTS
-- All tables need 'system' added to their visibility constraints
-- ============================================

-- Drop old constraints and recreate with 'system' included
-- procedural_shards
ALTER TABLE procedural_shards DROP CONSTRAINT IF EXISTS valid_shard_visibility;
ALTER TABLE procedural_shards ADD CONSTRAINT valid_shard_visibility
    CHECK (visibility IN ('public', 'private', 'organization', 'system'));

-- knowledge_facts
ALTER TABLE knowledge_facts DROP CONSTRAINT IF EXISTS valid_fact_visibility;
ALTER TABLE knowledge_facts ADD CONSTRAINT valid_fact_visibility
    CHECK (visibility IN ('public', 'private', 'organization', 'system'));

-- episodes
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS valid_episode_visibility;
ALTER TABLE episodes ADD CONSTRAINT valid_episode_visibility
    CHECK (visibility IN ('public', 'private', 'organization', 'system'));

-- reasoning_traces
ALTER TABLE reasoning_traces DROP CONSTRAINT IF EXISTS valid_trace_visibility;
ALTER TABLE reasoning_traces ADD CONSTRAINT valid_trace_visibility
    CHECK (visibility IN ('public', 'private', 'organization', 'system'));

-- working_contexts (new constraint)
DO $$ BEGIN
    ALTER TABLE working_contexts
        ADD CONSTRAINT valid_context_visibility
        CHECK (visibility IN ('public', 'private', 'organization', 'system'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_working_visibility ON working_contexts(visibility);

-- ============================================
-- UPDATE VISIBILITY ENUM TYPE (if used)
-- ============================================

-- Alter the enum type to add 'system' if it exists
DO $$ BEGIN
    ALTER TYPE visibility_type ADD VALUE IF NOT EXISTS 'system';
EXCEPTION
    WHEN others THEN null;
END $$;

-- ============================================
-- UPDATE find_similar_shards_for_tenant FUNCTION
-- Add explicit handling for system visibility
-- ============================================

CREATE OR REPLACE FUNCTION find_similar_shards_for_tenant(
    query_embedding VECTOR(1536),
    tenant_id_param TEXT DEFAULT NULL,
    similarity_threshold REAL DEFAULT 0.7,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
    shard_id TEXT,
    name VARCHAR(255),
    confidence REAL,
    similarity REAL,
    visibility VARCHAR(20),
    is_owned BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ps.id,
        ps.name,
        ps.confidence,
        1 - (ps.embedding <=> query_embedding) as similarity,
        ps.visibility,
        (ps.owner_id = tenant_id_param) as is_owned
    FROM procedural_shards ps
    WHERE ps.lifecycle = 'promoted'
        AND ps.embedding IS NOT NULL
        AND 1 - (ps.embedding <=> query_embedding) >= similarity_threshold
        AND (
            -- Admin (system tenant) sees everything
            (tenant_id_param = 'tenant_system')
            -- Public shards visible to all users
            OR ps.visibility = 'public'
            -- Legacy: NULL owner shards visible to everyone
            OR ps.owner_id IS NULL
            -- Private shards only visible to owner
            OR (ps.visibility = 'private' AND ps.owner_id = tenant_id_param)
            -- Org shards visible to org members (simplified - full needs member check)
            OR (ps.visibility = 'organization' AND ps.owner_id = tenant_id_param)
            -- NOTE: 'system' visibility is NOT included for regular users
            -- System shards are internal and only visible to admins
        )
    ORDER BY ps.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- NOTES ON VISIBILITY LEVELS
-- ============================================
--
-- public:       Visible to ALL users, editable by owner
-- private:      Visible ONLY to owner (personal shards)
-- organization: Visible to org members (enterprise feature)
-- system:       Visible ONLY to admins (internal system shards)
--               HIDDEN from regular users - used for core system
--               logic that shouldn't be exposed
