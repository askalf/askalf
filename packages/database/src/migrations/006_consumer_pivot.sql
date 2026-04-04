-- SUBSTRATE v1: Consumer Pivot Schema
-- Phase 9: Token Bundles, Demo Sessions, Environmental Impact
--
-- New tables for:
-- 1. Token bundles (hybrid billing model)
-- 2. Demo sessions (anonymous user tracking)
-- 3. Environmental impact metrics on shard executions
-- 4. User preferences and model restrictions

-- ============================================
-- TOKEN BUNDLES (Hybrid Billing Model)
-- ============================================

CREATE TABLE IF NOT EXISTS token_bundles (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Purchase details
    tokens_purchased    INTEGER NOT NULL,
    tokens_remaining    INTEGER NOT NULL,
    price_usd           NUMERIC(10, 2),

    -- Metadata
    bundle_type         VARCHAR(50) DEFAULT 'standard', -- standard, promotional, gift
    purchased_at        TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,

    -- Payment integration
    stripe_payment_id   TEXT,
    stripe_product_id   TEXT,

    -- Status
    status              VARCHAR(20) DEFAULT 'active' NOT NULL,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT valid_bundle_status CHECK (status IN ('active', 'depleted', 'expired', 'refunded')),
    CONSTRAINT valid_bundle_type CHECK (bundle_type IN ('standard', 'promotional', 'gift', 'enterprise'))
);

CREATE INDEX IF NOT EXISTS idx_bundles_tenant ON token_bundles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bundles_status ON token_bundles(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bundles_expires ON token_bundles(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- DEMO SESSIONS (Anonymous User Tracking)
-- ============================================

CREATE TABLE IF NOT EXISTS demo_sessions (
    id                  TEXT PRIMARY KEY,

    -- Session identification
    session_token       TEXT UNIQUE NOT NULL,
    fingerprint         TEXT, -- Browser fingerprint for fraud prevention
    ip_hash             TEXT, -- Hashed IP for rate limiting

    -- Usage tracking
    interactions_used   INTEGER DEFAULT 0,
    max_interactions    INTEGER DEFAULT 5,

    -- Models used (for analytics)
    models_used         JSONB DEFAULT '[]',

    -- Conversion tracking
    converted_to_user_id    TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    converted_at            TIMESTAMPTZ,

    -- Environmental impact (accumulated during demo)
    total_tokens_saved      INTEGER DEFAULT 0,
    total_water_ml_saved    INTEGER DEFAULT 0,
    total_power_wh_saved    NUMERIC(10, 2) DEFAULT 0,
    total_carbon_g_saved    NUMERIC(10, 2) DEFAULT 0,

    -- Session metadata
    user_agent          TEXT,
    referrer            TEXT,
    landing_page        TEXT,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_active_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at          TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_demo_token ON demo_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_demo_fingerprint ON demo_sessions(fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demo_ip_hash ON demo_sessions(ip_hash) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demo_converted ON demo_sessions(converted_to_user_id) WHERE converted_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demo_expires ON demo_sessions(expires_at);

-- ============================================
-- ENVIRONMENTAL IMPACT ON SHARD EXECUTIONS
-- ============================================

-- Add environmental columns to shard_executions
ALTER TABLE shard_executions
    ADD COLUMN IF NOT EXISTS water_ml_saved INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS power_wh_saved NUMERIC(10, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS carbon_g_saved NUMERIC(10, 2) DEFAULT 0;

-- ============================================
-- TENANT ENVIRONMENTAL TOTALS
-- ============================================

-- Add cumulative environmental impact to tenants
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS total_tokens_saved BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_water_ml_saved BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_power_wh_saved NUMERIC(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_carbon_g_saved NUMERIC(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lifetime_shard_hits INTEGER DEFAULT 0;

-- ============================================
-- MODEL ACCESS TIERS
-- ============================================

CREATE TABLE IF NOT EXISTS model_access_tiers (
    id              TEXT PRIMARY KEY,

    -- Model identification
    provider        VARCHAR(50) NOT NULL,   -- openai, anthropic, google, xai, ollama
    model_id        VARCHAR(100) NOT NULL,  -- gpt-4o, claude-sonnet-4, etc.
    display_name    VARCHAR(100) NOT NULL,

    -- Access tier (who can use)
    min_tier        VARCHAR(20) NOT NULL,   -- demo, free, individual, business, enterprise

    -- Cost info (per 1K tokens)
    input_cost_per_1k   NUMERIC(10, 6),
    output_cost_per_1k  NUMERIC(10, 6),

    -- Flags
    is_reasoning_model  BOOLEAN DEFAULT FALSE,
    is_embedding_model  BOOLEAN DEFAULT FALSE,
    is_fast_model       BOOLEAN DEFAULT FALSE,

    -- Status
    is_active       BOOLEAN DEFAULT TRUE,

    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT unique_model UNIQUE (provider, model_id),
    CONSTRAINT valid_min_tier CHECK (min_tier IN ('demo', 'free', 'individual', 'business', 'enterprise'))
);

CREATE INDEX IF NOT EXISTS idx_model_access_provider ON model_access_tiers(provider);
CREATE INDEX IF NOT EXISTS idx_model_access_tier ON model_access_tiers(min_tier);
CREATE INDEX IF NOT EXISTS idx_model_access_active ON model_access_tiers(is_active) WHERE is_active = TRUE;

-- ============================================
-- SEED MODEL ACCESS TIERS
-- ============================================

INSERT INTO model_access_tiers (id, provider, model_id, display_name, min_tier, input_cost_per_1k, output_cost_per_1k, is_fast_model, is_reasoning_model) VALUES
    -- Demo tier (lightweight models only)
    ('mat_gpt4o_mini', 'openai', 'gpt-4o-mini', 'GPT-4o Mini', 'demo', 0.00015, 0.0006, TRUE, FALSE),
    ('mat_haiku', 'anthropic', 'claude-3-5-haiku-latest', 'Claude 3.5 Haiku', 'demo', 0.0008, 0.004, TRUE, FALSE),
    ('mat_gemini_flash', 'google', 'gemini-2.0-flash-exp', 'Gemini 2.0 Flash', 'demo', 0.0001, 0.0004, TRUE, FALSE),

    -- Free tier (mid-range models)
    ('mat_gpt4o', 'openai', 'gpt-4o', 'GPT-4o', 'free', 0.0025, 0.01, FALSE, FALSE),
    ('mat_sonnet', 'anthropic', 'claude-sonnet-4-20250514', 'Claude Sonnet 4', 'free', 0.003, 0.015, FALSE, FALSE),
    ('mat_gemini_pro', 'google', 'gemini-1.5-pro', 'Gemini 1.5 Pro', 'free', 0.00125, 0.005, FALSE, FALSE),

    -- Individual tier ($19/month)
    ('mat_grok', 'xai', 'grok-2', 'Grok-2', 'individual', 0.002, 0.010, FALSE, FALSE),
    ('mat_o1', 'openai', 'o1', 'o1 Reasoning', 'individual', 0.015, 0.06, FALSE, TRUE),

    -- Business tier ($99/month)
    ('mat_opus', 'anthropic', 'claude-opus-4-20250514', 'Claude Opus 4', 'business', 0.015, 0.075, FALSE, TRUE),
    ('mat_o3', 'openai', 'o3', 'o3 Reasoning', 'business', 0.02, 0.08, FALSE, TRUE)
ON CONFLICT (provider, model_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    min_tier = EXCLUDED.min_tier,
    input_cost_per_1k = EXCLUDED.input_cost_per_1k,
    output_cost_per_1k = EXCLUDED.output_cost_per_1k,
    is_fast_model = EXCLUDED.is_fast_model,
    is_reasoning_model = EXCLUDED.is_reasoning_model,
    updated_at = NOW();

-- ============================================
-- USER AI CONNECTOR SETTINGS
-- ============================================

CREATE TABLE IF NOT EXISTS user_ai_connectors (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Provider identification
    provider        VARCHAR(50) NOT NULL,   -- openai, anthropic, google, xai, ollama

    -- Credentials (encrypted in production)
    api_key_encrypted   TEXT,
    api_key_last4       VARCHAR(4),
    base_url            TEXT, -- For Ollama/custom endpoints

    -- Preferences
    default_model       VARCHAR(100),
    is_enabled          BOOLEAN DEFAULT TRUE,
    priority            INTEGER DEFAULT 0, -- Higher = preferred

    -- Validation
    last_validated_at   TIMESTAMPTZ,
    validation_status   VARCHAR(20) DEFAULT 'unknown',
    validation_error    TEXT,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT unique_tenant_provider UNIQUE (tenant_id, provider),
    CONSTRAINT valid_provider CHECK (provider IN ('openai', 'anthropic', 'google', 'xai', 'ollama')),
    CONSTRAINT valid_validation_status CHECK (validation_status IN ('unknown', 'valid', 'invalid', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON user_ai_connectors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_connectors_provider ON user_ai_connectors(provider);

-- ============================================
-- GLOBAL ENVIRONMENTAL COUNTERS
-- ============================================

CREATE TABLE IF NOT EXISTS global_counters (
    id              TEXT PRIMARY KEY,
    counter_name    VARCHAR(100) UNIQUE NOT NULL,
    counter_value   BIGINT DEFAULT 0,
    last_updated    TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize global counters
INSERT INTO global_counters (id, counter_name, counter_value) VALUES
    ('gc_tokens_saved', 'total_tokens_saved', 0),
    ('gc_water_ml_saved', 'total_water_ml_saved', 0),
    ('gc_power_wh_saved', 'total_power_wh_saved', 0),
    ('gc_carbon_g_saved', 'total_carbon_g_saved', 0),
    ('gc_shard_hits', 'total_shard_hits', 0),
    ('gc_demo_sessions', 'total_demo_sessions', 0),
    ('gc_conversions', 'total_demo_conversions', 0)
ON CONFLICT (counter_name) DO NOTHING;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update global counters on shard execution with savings
CREATE OR REPLACE FUNCTION update_environmental_counters()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tokens_saved > 0 THEN
        -- Update global counters
        UPDATE global_counters SET counter_value = counter_value + NEW.tokens_saved, last_updated = NOW()
        WHERE counter_name = 'total_tokens_saved';

        UPDATE global_counters SET counter_value = counter_value + NEW.water_ml_saved, last_updated = NOW()
        WHERE counter_name = 'total_water_ml_saved';

        UPDATE global_counters SET counter_value = counter_value + ROUND(NEW.power_wh_saved * 100), last_updated = NOW()
        WHERE counter_name = 'total_power_wh_saved';

        UPDATE global_counters SET counter_value = counter_value + ROUND(NEW.carbon_g_saved * 100), last_updated = NOW()
        WHERE counter_name = 'total_carbon_g_saved';

        UPDATE global_counters SET counter_value = counter_value + 1, last_updated = NOW()
        WHERE counter_name = 'total_shard_hits';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_environmental_counters ON shard_executions;
CREATE TRIGGER trg_environmental_counters
    AFTER INSERT ON shard_executions
    FOR EACH ROW EXECUTE FUNCTION update_environmental_counters();

-- Update tenant environmental totals
CREATE OR REPLACE FUNCTION update_tenant_environmental()
RETURNS TRIGGER AS $$
DECLARE
    exec_tenant_id TEXT;
BEGIN
    -- Get tenant from shard
    SELECT owner_id INTO exec_tenant_id
    FROM procedural_shards
    WHERE id = NEW.shard_id;

    IF exec_tenant_id IS NOT NULL AND NEW.tokens_saved > 0 THEN
        UPDATE tenants SET
            total_tokens_saved = total_tokens_saved + NEW.tokens_saved,
            total_water_ml_saved = total_water_ml_saved + NEW.water_ml_saved,
            total_power_wh_saved = total_power_wh_saved + NEW.power_wh_saved,
            total_carbon_g_saved = total_carbon_g_saved + NEW.carbon_g_saved,
            lifetime_shard_hits = lifetime_shard_hits + 1,
            updated_at = NOW()
        WHERE id = exec_tenant_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_environmental ON shard_executions;
CREATE TRIGGER trg_tenant_environmental
    AFTER INSERT ON shard_executions
    FOR EACH ROW EXECUTE FUNCTION update_tenant_environmental();

-- Auto-update timestamp triggers for new tables
DROP TRIGGER IF EXISTS trg_bundles_updated_at ON token_bundles;
CREATE TRIGGER trg_bundles_updated_at
    BEFORE UPDATE ON token_bundles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_model_access_updated_at ON model_access_tiers;
CREATE TRIGGER trg_model_access_updated_at
    BEFORE UPDATE ON model_access_tiers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_connectors_updated_at ON user_ai_connectors;
CREATE TRIGGER trg_connectors_updated_at
    BEFORE UPDATE ON user_ai_connectors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

-- Get available models for a tenant tier
CREATE OR REPLACE FUNCTION get_available_models(tier_param VARCHAR(20))
RETURNS TABLE (
    provider VARCHAR(50),
    model_id VARCHAR(100),
    display_name VARCHAR(100),
    is_fast_model BOOLEAN,
    is_reasoning_model BOOLEAN
) AS $$
DECLARE
    tier_rank INTEGER;
BEGIN
    -- Map tiers to ranks
    tier_rank := CASE tier_param
        WHEN 'demo' THEN 1
        WHEN 'free' THEN 2
        WHEN 'individual' THEN 3
        WHEN 'business' THEN 4
        WHEN 'enterprise' THEN 5
        ELSE 1
    END;

    RETURN QUERY
    SELECT
        mat.provider,
        mat.model_id,
        mat.display_name,
        mat.is_fast_model,
        mat.is_reasoning_model
    FROM model_access_tiers mat
    WHERE mat.is_active = TRUE
        AND CASE mat.min_tier
            WHEN 'demo' THEN 1
            WHEN 'free' THEN 2
            WHEN 'individual' THEN 3
            WHEN 'business' THEN 4
            WHEN 'enterprise' THEN 5
            ELSE 5
        END <= tier_rank
    ORDER BY mat.provider, mat.display_name;
END;
$$ LANGUAGE plpgsql;

-- Check if tenant can use a specific model
CREATE OR REPLACE FUNCTION can_use_model(tenant_id_param TEXT, provider_param VARCHAR(50), model_id_param VARCHAR(100))
RETURNS BOOLEAN AS $$
DECLARE
    tenant_tier VARCHAR(20);
    model_min_tier VARCHAR(20);
    tier_rank INTEGER;
    model_rank INTEGER;
BEGIN
    -- Get tenant tier
    SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;
    IF tenant_tier IS NULL THEN
        tenant_tier := 'free';
    END IF;

    -- Get model minimum tier
    SELECT min_tier INTO model_min_tier
    FROM model_access_tiers
    WHERE provider = provider_param AND model_id = model_id_param AND is_active = TRUE;

    IF model_min_tier IS NULL THEN
        RETURN FALSE; -- Model not found
    END IF;

    -- Map to ranks and compare
    tier_rank := CASE tenant_tier
        WHEN 'demo' THEN 1
        WHEN 'free' THEN 2
        WHEN 'individual' THEN 3
        WHEN 'business' THEN 4
        WHEN 'enterprise' THEN 5
        ELSE 2
    END;

    model_rank := CASE model_min_tier
        WHEN 'demo' THEN 1
        WHEN 'free' THEN 2
        WHEN 'individual' THEN 3
        WHEN 'business' THEN 4
        WHEN 'enterprise' THEN 5
        ELSE 5
    END;

    RETURN tier_rank >= model_rank;
END;
$$ LANGUAGE plpgsql;

-- Deduct tokens from bundle
CREATE OR REPLACE FUNCTION deduct_tokens(tenant_id_param TEXT, tokens_to_deduct INTEGER)
RETURNS TABLE (
    success BOOLEAN,
    bundle_id TEXT,
    tokens_deducted INTEGER,
    tokens_remaining INTEGER
) AS $$
DECLARE
    bundle_record RECORD;
    remaining_to_deduct INTEGER;
BEGIN
    remaining_to_deduct := tokens_to_deduct;

    -- Find active bundles with remaining tokens (oldest first)
    FOR bundle_record IN
        SELECT tb.id, tb.tokens_remaining
        FROM token_bundles tb
        WHERE tb.tenant_id = tenant_id_param
            AND tb.status = 'active'
            AND tb.tokens_remaining > 0
            AND (tb.expires_at IS NULL OR tb.expires_at > NOW())
        ORDER BY tb.created_at ASC
    LOOP
        IF remaining_to_deduct <= 0 THEN
            EXIT;
        END IF;

        IF bundle_record.tokens_remaining >= remaining_to_deduct THEN
            -- This bundle has enough
            UPDATE token_bundles SET
                tokens_remaining = tokens_remaining - remaining_to_deduct,
                status = CASE WHEN tokens_remaining - remaining_to_deduct = 0 THEN 'depleted' ELSE status END,
                updated_at = NOW()
            WHERE id = bundle_record.id;

            RETURN QUERY SELECT TRUE, bundle_record.id, remaining_to_deduct, bundle_record.tokens_remaining - remaining_to_deduct;
            RETURN;
        ELSE
            -- Use all tokens from this bundle
            UPDATE token_bundles SET
                tokens_remaining = 0,
                status = 'depleted',
                updated_at = NOW()
            WHERE id = bundle_record.id;

            remaining_to_deduct := remaining_to_deduct - bundle_record.tokens_remaining;
        END IF;
    END LOOP;

    -- If we get here, not enough tokens
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0, 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- MIGRATION NOTES
-- ============================================

-- This migration adds support for:
-- 1. Token bundles: Prepaid token packages for hybrid billing
-- 2. Demo sessions: Anonymous user tracking (3-5 free interactions)
-- 3. Environmental impact: Track water, power, carbon saved per shard execution
-- 4. Model access tiers: Restrict model access based on subscription tier
-- 5. AI connectors: Store user API keys for BYOK model
-- 6. Global counters: Track platform-wide environmental impact

-- Environmental calculation constants:
-- Per 1000 LLM tokens avoided:
--   Water: ~500ml (data center cooling)
--   Power: ~10Wh (compute + cooling)
--   Carbon: ~5g CO2 (varies by region/energy source)
