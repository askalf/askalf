-- SUBSTRATE v1: Multi-Tenancy Schema
-- Public vs Private Shards, User/Org Isolation
--
-- Design principles:
-- 1. Backwards compatible: NULL owner = system-owned (public)
-- 2. Existing queries continue to work
-- 3. Clean separation: tenants, members, ownership
-- 4. Visibility: public (free), private (paid), organization (team)

-- ============================================
-- TENANTS (Organizations/Users)
-- ============================================

CREATE TABLE IF NOT EXISTS tenants (
    id              TEXT PRIMARY KEY,

    -- Identity
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) UNIQUE NOT NULL,
    type            VARCHAR(20) DEFAULT 'user' NOT NULL,

    -- Billing/Tier
    tier            VARCHAR(20) DEFAULT 'free' NOT NULL,
    tier_expires_at TIMESTAMPTZ,

    -- Limits (based on tier)
    max_private_shards    INTEGER DEFAULT 0,      -- free=0, pro=100, enterprise=unlimited(-1)
    max_private_facts     INTEGER DEFAULT 0,
    max_members           INTEGER DEFAULT 1,       -- users in org

    -- Usage tracking
    shard_count           INTEGER DEFAULT 0,
    fact_count            INTEGER DEFAULT 0,
    execution_count       INTEGER DEFAULT 0,

    -- Contact
    email           VARCHAR(255),

    -- Status
    status          VARCHAR(20) DEFAULT 'active' NOT NULL,

    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT valid_tenant_type CHECK (type IN ('user', 'organization')),
    CONSTRAINT valid_tenant_tier CHECK (tier IN ('free', 'pro', 'enterprise', 'system')),
    CONSTRAINT valid_tenant_status CHECK (status IN ('active', 'suspended', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_tier ON tenants(tier);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status) WHERE status = 'active';

-- ============================================
-- TENANT MEMBERS (User-Org relationships)
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_members (
    id              TEXT PRIMARY KEY,

    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,  -- External user ID (from auth provider)

    role            VARCHAR(20) DEFAULT 'member' NOT NULL,

    invited_by      TEXT,
    invited_at      TIMESTAMPTZ DEFAULT NOW(),
    joined_at       TIMESTAMPTZ,

    status          VARCHAR(20) DEFAULT 'active' NOT NULL,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT valid_member_role CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    CONSTRAINT valid_member_status CHECK (status IN ('pending', 'active', 'removed')),
    CONSTRAINT unique_tenant_user UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_tenant ON tenant_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON tenant_members(user_id);

-- ============================================
-- API KEYS (Per-tenant authentication)
-- ============================================

CREATE TABLE IF NOT EXISTS api_keys (
    id              TEXT PRIMARY KEY,

    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name            VARCHAR(255) NOT NULL,
    key_hash        VARCHAR(128) NOT NULL,  -- SHA-256 of the actual key
    key_prefix      VARCHAR(12) NOT NULL,   -- First 8 chars for identification

    scopes          TEXT[] DEFAULT ARRAY['read', 'write', 'execute'],

    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,

    status          VARCHAR(20) DEFAULT 'active' NOT NULL,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT valid_key_status CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- ============================================
-- VISIBILITY ENUM (for type safety)
-- ============================================

DO $$ BEGIN
    CREATE TYPE visibility_type AS ENUM ('public', 'private', 'organization');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- ADD MULTI-TENANCY TO PROCEDURAL SHARDS
-- ============================================

-- Add owner and visibility columns
ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'public';

-- Add constraint for visibility
DO $$ BEGIN
    ALTER TABLE procedural_shards
        ADD CONSTRAINT valid_shard_visibility
        CHECK (visibility IN ('public', 'private', 'organization'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Indexes for tenant queries
CREATE INDEX IF NOT EXISTS idx_shards_owner ON procedural_shards(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shards_visibility ON procedural_shards(visibility);
CREATE INDEX IF NOT EXISTS idx_shards_owner_visibility ON procedural_shards(owner_id, visibility);

-- ============================================
-- ADD MULTI-TENANCY TO KNOWLEDGE FACTS
-- ============================================

ALTER TABLE knowledge_facts
    ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'public';

DO $$ BEGIN
    ALTER TABLE knowledge_facts
        ADD CONSTRAINT valid_fact_visibility
        CHECK (visibility IN ('public', 'private', 'organization'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_facts_owner ON knowledge_facts(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facts_visibility ON knowledge_facts(visibility);

-- ============================================
-- ADD MULTI-TENANCY TO EPISODES
-- ============================================

ALTER TABLE episodes
    ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private';  -- Episodes default to private

DO $$ BEGIN
    ALTER TABLE episodes
        ADD CONSTRAINT valid_episode_visibility
        CHECK (visibility IN ('public', 'private', 'organization'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_episodes_owner ON episodes(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_episodes_visibility ON episodes(visibility);

-- ============================================
-- ADD MULTI-TENANCY TO REASONING TRACES
-- ============================================

ALTER TABLE reasoning_traces
    ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private';  -- Traces default to private

DO $$ BEGIN
    ALTER TABLE reasoning_traces
        ADD CONSTRAINT valid_trace_visibility
        CHECK (visibility IN ('public', 'private', 'organization'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_traces_owner ON reasoning_traces(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================
-- ADD MULTI-TENANCY TO WORKING CONTEXTS
-- ============================================

ALTER TABLE working_contexts
    ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_working_owner ON working_contexts(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================
-- SHARD FORKS (For "fork public, keep private" feature)
-- ============================================

CREATE TABLE IF NOT EXISTS shard_forks (
    id              TEXT PRIMARY KEY,

    source_shard_id TEXT NOT NULL REFERENCES procedural_shards(id) ON DELETE CASCADE,
    forked_shard_id TEXT NOT NULL REFERENCES procedural_shards(id) ON DELETE CASCADE,

    forked_by       TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    forked_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Track divergence
    source_version_at_fork INTEGER NOT NULL,

    CONSTRAINT unique_fork UNIQUE (source_shard_id, forked_shard_id)
);

CREATE INDEX IF NOT EXISTS idx_forks_source ON shard_forks(source_shard_id);
CREATE INDEX IF NOT EXISTS idx_forks_forked ON shard_forks(forked_shard_id);
CREATE INDEX IF NOT EXISTS idx_forks_owner ON shard_forks(forked_by);

-- ============================================
-- USAGE TRACKING (Per-tenant metrics)
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_usage (
    id              TEXT PRIMARY KEY,

    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,

    -- Execution metrics
    public_executions    INTEGER DEFAULT 0,
    private_executions   INTEGER DEFAULT 0,
    total_tokens_saved   INTEGER DEFAULT 0,

    -- Storage metrics
    shards_created       INTEGER DEFAULT 0,
    facts_created        INTEGER DEFAULT 0,
    traces_recorded      INTEGER DEFAULT 0,

    -- Cost tracking
    api_calls            INTEGER DEFAULT 0,
    embedding_tokens     INTEGER DEFAULT 0,
    llm_tokens           INTEGER DEFAULT 0,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT unique_tenant_period UNIQUE (tenant_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant ON tenant_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_period ON tenant_usage(period_start, period_end);

-- ============================================
-- UPDATED UTILITY FUNCTIONS
-- ============================================

-- Find similar shards with visibility filtering
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
            -- Public shards visible to everyone
            ps.visibility = 'public'
            -- Private shards only visible to owner
            OR (ps.visibility = 'private' AND ps.owner_id = tenant_id_param)
            -- Org shards visible to org members (simplified - full impl needs member check)
            OR (ps.visibility = 'organization' AND ps.owner_id = tenant_id_param)
            -- System shards (NULL owner) visible to everyone
            OR ps.owner_id IS NULL
        )
    ORDER BY ps.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Check if tenant can create more private shards
CREATE OR REPLACE FUNCTION can_create_private_shard(tenant_id_param TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    tenant_record RECORD;
    current_count INTEGER;
BEGIN
    SELECT tier, max_private_shards INTO tenant_record
    FROM tenants WHERE id = tenant_id_param;

    IF tenant_record IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Enterprise has unlimited (-1)
    IF tenant_record.max_private_shards = -1 THEN
        RETURN TRUE;
    END IF;

    SELECT COUNT(*) INTO current_count
    FROM procedural_shards
    WHERE owner_id = tenant_id_param AND visibility = 'private';

    RETURN current_count < tenant_record.max_private_shards;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SYSTEM TENANT (For backwards compatibility)
-- ============================================

-- Create a system tenant for existing public data
INSERT INTO tenants (id, name, slug, type, tier, status, max_private_shards, max_private_facts, max_members)
VALUES (
    'tenant_system',
    'SUBSTRATE System',
    'system',
    'organization',
    'system',
    'active',
    -1,  -- unlimited
    -1,
    -1
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TRIGGERS FOR USAGE TRACKING
-- ============================================

-- Update tenant shard count on insert/delete
CREATE OR REPLACE FUNCTION update_tenant_shard_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.owner_id IS NOT NULL THEN
        UPDATE tenants SET shard_count = shard_count + 1 WHERE id = NEW.owner_id;
    ELSIF TG_OP = 'DELETE' AND OLD.owner_id IS NOT NULL THEN
        UPDATE tenants SET shard_count = GREATEST(shard_count - 1, 0) WHERE id = OLD.owner_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shard_count ON procedural_shards;
CREATE TRIGGER trg_shard_count
    AFTER INSERT OR DELETE ON procedural_shards
    FOR EACH ROW EXECUTE FUNCTION update_tenant_shard_count();

-- Update tenant fact count on insert/delete
CREATE OR REPLACE FUNCTION update_tenant_fact_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.owner_id IS NOT NULL THEN
        UPDATE tenants SET fact_count = fact_count + 1 WHERE id = NEW.owner_id;
    ELSIF TG_OP = 'DELETE' AND OLD.owner_id IS NOT NULL THEN
        UPDATE tenants SET fact_count = GREATEST(fact_count - 1, 0) WHERE id = OLD.owner_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fact_count ON knowledge_facts;
CREATE TRIGGER trg_fact_count
    AFTER INSERT OR DELETE ON knowledge_facts
    FOR EACH ROW EXECUTE FUNCTION update_tenant_fact_count();

-- ============================================
-- ROW LEVEL SECURITY (Optional, for strict isolation)
-- ============================================

-- Note: RLS can be enabled later for strict multi-tenancy
-- For now, we rely on application-level filtering

-- Example of how to enable RLS (run manually when ready):
-- ALTER TABLE procedural_shards ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY shards_tenant_policy ON procedural_shards
--     USING (
--         visibility = 'public'
--         OR owner_id IS NULL
--         OR owner_id = current_setting('app.current_tenant_id', true)
--     );

-- ============================================
-- UPDATE updated_at TRIGGER FOR NEW TABLES
-- ============================================

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_usage_updated_at ON tenant_usage;
CREATE TRIGGER trg_usage_updated_at
    BEFORE UPDATE ON tenant_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- MIGRATION NOTES
-- ============================================

-- Existing data handling:
-- - All existing shards/facts with NULL owner_id remain public (system-owned)
-- - Existing queries without owner_id filter continue to work
-- - New data can specify owner_id and visibility
--
-- To migrate existing data to a tenant:
-- UPDATE procedural_shards SET owner_id = 'tenant_xxx', visibility = 'private' WHERE id = 'shard_xxx';
--
-- Free tier limits (configurable):
-- - 0 private shards (use public only)
-- - 0 private facts
-- - 1 member (single user)
--
-- Pro tier ($X/month):
-- - 100 private shards
-- - 1000 private facts
-- - 5 members
--
-- Enterprise (custom):
-- - Unlimited (-1)
-- - Custom member limits
-- - SLA, support, etc.
