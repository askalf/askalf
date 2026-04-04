-- SUBSTRATE v1: Free Tier & Rate Limiting
-- Phase 9.8: Platform keys, usage tracking, rate limits
--
-- Adds:
-- 1. Daily usage tracking per user (rate limiting)
-- 2. Platform API key pool (shared keys for free tier)
-- 3. Updated model tiers for January 2026 models

-- ============================================
-- DAILY USAGE TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS user_daily_usage (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    usage_date          DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Message counts
    messages_sent       INTEGER DEFAULT 0,
    messages_limit      INTEGER DEFAULT 20,  -- Based on tier

    -- Token usage
    tokens_consumed     INTEGER DEFAULT 0,
    tokens_limit        INTEGER DEFAULT 50000,  -- Based on tier

    -- Platform key usage (free tier)
    platform_key_calls  INTEGER DEFAULT 0,
    platform_key_limit  INTEGER DEFAULT 20,

    -- Shard hits (always free, no limit)
    shard_hits          INTEGER DEFAULT 0,

    -- Reset tracking
    limit_reset_at      TIMESTAMPTZ DEFAULT (CURRENT_DATE + INTERVAL '1 day'),

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT unique_tenant_date UNIQUE (tenant_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant ON user_daily_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_date ON user_daily_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_date ON user_daily_usage(tenant_id, usage_date);

-- ============================================
-- PLATFORM API KEY POOL
-- ============================================

CREATE TABLE IF NOT EXISTS platform_api_keys (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Provider identification
    provider            VARCHAR(50) NOT NULL,  -- openai, anthropic
    key_name            VARCHAR(100) NOT NULL, -- friendly name

    -- Encrypted credentials
    api_key_encrypted   TEXT NOT NULL,
    api_key_last4       VARCHAR(4),

    -- Usage limits (daily)
    daily_token_limit   INTEGER DEFAULT 100000,
    daily_tokens_used   INTEGER DEFAULT 0,
    daily_call_limit    INTEGER DEFAULT 1000,
    daily_calls_used    INTEGER DEFAULT 0,

    -- Monthly limits
    monthly_token_limit INTEGER DEFAULT 2000000,
    monthly_tokens_used INTEGER DEFAULT 0,

    -- Status
    is_active           BOOLEAN DEFAULT TRUE,
    is_primary          BOOLEAN DEFAULT FALSE,  -- Preferred key for provider

    -- Health tracking
    last_used_at        TIMESTAMPTZ,
    last_error          TEXT,
    error_count         INTEGER DEFAULT 0,
    last_reset_at       TIMESTAMPTZ DEFAULT NOW(),

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT valid_platform_provider CHECK (provider IN ('openai', 'anthropic'))
);

CREATE INDEX IF NOT EXISTS idx_platform_keys_provider ON platform_api_keys(provider);
CREATE INDEX IF NOT EXISTS idx_platform_keys_active ON platform_api_keys(is_active) WHERE is_active = TRUE;

-- ============================================
-- TIER LIMITS CONFIGURATION
-- ============================================

CREATE TABLE IF NOT EXISTS tier_limits (
    id                  TEXT PRIMARY KEY,
    tier_name           VARCHAR(50) UNIQUE NOT NULL,

    -- Message limits
    daily_messages      INTEGER NOT NULL,

    -- Token limits (for BYOK/bundles)
    daily_tokens        INTEGER,

    -- Platform key access
    can_use_platform_keys   BOOLEAN DEFAULT FALSE,
    platform_key_daily_limit INTEGER DEFAULT 0,

    -- Model access
    model_tier_access   VARCHAR(20) NOT NULL,  -- demo, free, individual, business, enterprise

    -- Features
    can_use_shards      BOOLEAN DEFAULT TRUE,
    can_create_shards   BOOLEAN DEFAULT FALSE,
    max_conversations   INTEGER DEFAULT 10,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Insert tier configurations
INSERT INTO tier_limits (id, tier_name, daily_messages, daily_tokens, can_use_platform_keys, platform_key_daily_limit, model_tier_access, can_use_shards, can_create_shards, max_conversations) VALUES
    ('tl_free', 'free', 20, NULL, TRUE, 20, 'free', TRUE, FALSE, 10),
    ('tl_individual', 'individual', 500, 500000, FALSE, 0, 'individual', TRUE, TRUE, 100),
    ('tl_business', 'business', 2000, 2000000, FALSE, 0, 'business', TRUE, TRUE, 1000),
    ('tl_enterprise', 'enterprise', -1, -1, FALSE, 0, 'enterprise', TRUE, TRUE, -1)  -- -1 = unlimited
ON CONFLICT (tier_name) DO UPDATE SET
    daily_messages = EXCLUDED.daily_messages,
    daily_tokens = EXCLUDED.daily_tokens,
    can_use_platform_keys = EXCLUDED.can_use_platform_keys,
    platform_key_daily_limit = EXCLUDED.platform_key_daily_limit,
    model_tier_access = EXCLUDED.model_tier_access,
    updated_at = NOW();

-- ============================================
-- UPDATE MODEL ACCESS TIERS (January 2026)
-- ============================================

-- Clear old models and insert fresh
DELETE FROM model_access_tiers;

INSERT INTO model_access_tiers (id, provider, model_id, display_name, min_tier, input_cost_per_1k, output_cost_per_1k, is_fast_model, is_reasoning_model) VALUES
    -- === FAST TIER (Free users can access) ===
    -- OpenAI Fast
    ('mat_gpt52_instant', 'openai', 'gpt-5.2-instant', 'GPT-5.2 Instant', 'free', 0.0003, 0.0012, TRUE, FALSE),

    -- Anthropic Fast
    ('mat_haiku_45', 'anthropic', 'claude-haiku-4.5', 'Claude Haiku 4.5', 'free', 0.0008, 0.004, TRUE, FALSE),

    -- Google Fast
    ('mat_gemini3_flash', 'google', 'gemini-3-flash', 'Gemini 3 Flash', 'free', 0.0001, 0.0004, TRUE, FALSE),

    -- xAI Fast
    ('mat_grok41', 'xai', 'grok-4.1', 'Grok 4.1', 'free', 0.0005, 0.0015, TRUE, FALSE),

    -- === STANDARD TIER (Individual $19/mo) ===
    -- OpenAI Standard
    ('mat_gpt52', 'openai', 'gpt-5.2', 'GPT-5.2', 'individual', 0.005, 0.015, FALSE, FALSE),
    ('mat_gpt52_codex', 'openai', 'gpt-5.2-codex', 'GPT-5.2 Codex', 'individual', 0.005, 0.015, FALSE, FALSE),
    ('mat_gpt_oss_120b', 'openai', 'gpt-oss-120b', 'GPT-OSS 120B', 'individual', 0.001, 0.003, FALSE, FALSE),

    -- Anthropic Standard
    ('mat_sonnet_45', 'anthropic', 'claude-sonnet-4.5', 'Claude Sonnet 4.5', 'individual', 0.003, 0.015, FALSE, FALSE),

    -- Google Standard
    ('mat_gemini3_pro', 'google', 'gemini-3-pro', 'Gemini 3 Pro', 'individual', 0.00125, 0.005, FALSE, FALSE),
    ('mat_gemini25_pro', 'google', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'individual', 0.00125, 0.005, FALSE, FALSE),

    -- xAI Standard
    ('mat_grok420', 'xai', 'grok-4.20', 'Grok 4.20', 'individual', 0.002, 0.010, FALSE, FALSE),

    -- === REASONING TIER (Business $99/mo) ===
    -- OpenAI Reasoning
    ('mat_gpt52_thinking', 'openai', 'gpt-5.2-thinking', 'GPT-5.2 Thinking', 'business', 0.015, 0.06, FALSE, TRUE),
    ('mat_gpt52_pro', 'openai', 'gpt-5.2-pro', 'GPT-5.2 Pro', 'business', 0.02, 0.08, FALSE, TRUE),
    ('mat_o1_pro', 'openai', 'o1-pro', 'o1 Pro', 'business', 0.015, 0.06, FALSE, TRUE),
    ('mat_o3_mini', 'openai', 'o3-mini', 'o3 Mini', 'business', 0.01, 0.04, FALSE, TRUE),

    -- Anthropic Reasoning
    ('mat_opus_45', 'anthropic', 'claude-opus-4.5', 'Claude Opus 4.5', 'business', 0.015, 0.075, FALSE, TRUE),

    -- Google Reasoning
    ('mat_gemini3_thinking', 'google', 'gemini-3-thinking', 'Gemini 3 Thinking', 'business', 0.01, 0.04, FALSE, TRUE),

    -- xAI Reasoning
    ('mat_grok41_thinking', 'xai', 'grok-4.1-thinking', 'Grok 4.1 Thinking', 'business', 0.01, 0.04, FALSE, TRUE),

    -- === LOCAL MODELS (All tiers - no cost) ===
    ('mat_deepseek_r1', 'ollama', 'deepseek-r1', 'DeepSeek R1', 'free', 0, 0, FALSE, TRUE),
    ('mat_deepseek_v3', 'ollama', 'deepseek-v3', 'DeepSeek V3', 'free', 0, 0, FALSE, FALSE),
    ('mat_deepseek_coder', 'ollama', 'deepseek-coder', 'DeepSeek Coder', 'free', 0, 0, FALSE, FALSE),
    ('mat_llama31_70b', 'ollama', 'llama3.1:70b', 'Llama 3.1 70B', 'free', 0, 0, FALSE, FALSE),
    ('mat_llama32_vision', 'ollama', 'llama3.2-vision', 'Llama 3.2 Vision', 'free', 0, 0, FALSE, FALSE),
    ('mat_qwen25_coder', 'ollama', 'qwen2.5-coder:32b', 'Qwen 2.5 Coder 32B', 'free', 0, 0, FALSE, FALSE),
    ('mat_qwq', 'ollama', 'qwq', 'QwQ (Qwen Reasoning)', 'free', 0, 0, FALSE, TRUE),
    ('mat_mistral', 'ollama', 'mistral', 'Mistral 7B', 'free', 0, 0, TRUE, FALSE),
    ('mat_mixtral', 'ollama', 'mixtral', 'Mixtral 8x7B', 'free', 0, 0, FALSE, FALSE),
    ('mat_phi4', 'ollama', 'phi-4', 'Phi-4', 'free', 0, 0, TRUE, FALSE)
ON CONFLICT (provider, model_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    min_tier = EXCLUDED.min_tier,
    input_cost_per_1k = EXCLUDED.input_cost_per_1k,
    output_cost_per_1k = EXCLUDED.output_cost_per_1k,
    is_fast_model = EXCLUDED.is_fast_model,
    is_reasoning_model = EXCLUDED.is_reasoning_model,
    updated_at = NOW();

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

-- Get or create daily usage record
CREATE OR REPLACE FUNCTION get_or_create_daily_usage(tenant_id_param TEXT)
RETURNS user_daily_usage AS $$
DECLARE
    usage_record user_daily_usage;
    tenant_tier VARCHAR(50);
    tier_config tier_limits;
BEGIN
    -- Try to get existing record
    SELECT * INTO usage_record
    FROM user_daily_usage
    WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

    IF usage_record IS NOT NULL THEN
        RETURN usage_record;
    END IF;

    -- Get tenant tier
    SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;
    IF tenant_tier IS NULL THEN
        tenant_tier := 'free';
    END IF;

    -- Get tier limits
    SELECT * INTO tier_config FROM tier_limits WHERE tier_name = tenant_tier;
    IF tier_config IS NULL THEN
        SELECT * INTO tier_config FROM tier_limits WHERE tier_name = 'free';
    END IF;

    -- Create new record with tier-appropriate limits
    INSERT INTO user_daily_usage (
        tenant_id, usage_date, messages_limit, tokens_limit, platform_key_limit
    ) VALUES (
        tenant_id_param,
        CURRENT_DATE,
        tier_config.daily_messages,
        COALESCE(tier_config.daily_tokens, 0),
        tier_config.platform_key_daily_limit
    )
    ON CONFLICT (tenant_id, usage_date) DO NOTHING
    RETURNING * INTO usage_record;

    -- If insert failed due to race, fetch the existing record
    IF usage_record IS NULL THEN
        SELECT * INTO usage_record
        FROM user_daily_usage
        WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;
    END IF;

    RETURN usage_record;
END;
$$ LANGUAGE plpgsql;

-- Check if user can send message (rate limit check)
CREATE OR REPLACE FUNCTION can_send_message(tenant_id_param TEXT)
RETURNS TABLE (
    allowed BOOLEAN,
    reason TEXT,
    messages_used INTEGER,
    messages_limit INTEGER,
    platform_calls_used INTEGER,
    platform_calls_limit INTEGER,
    resets_at TIMESTAMPTZ
) AS $$
DECLARE
    usage_record user_daily_usage;
    tenant_tier VARCHAR(50);
BEGIN
    -- Get or create usage record
    SELECT * INTO usage_record FROM get_or_create_daily_usage(tenant_id_param);

    -- Get tenant tier
    SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;

    -- Enterprise has no limits
    IF tenant_tier = 'enterprise' THEN
        RETURN QUERY SELECT
            TRUE,
            'OK'::TEXT,
            usage_record.messages_sent,
            -1,
            usage_record.platform_key_calls,
            -1,
            usage_record.limit_reset_at;
        RETURN;
    END IF;

    -- Check message limit
    IF usage_record.messages_limit > 0 AND usage_record.messages_sent >= usage_record.messages_limit THEN
        RETURN QUERY SELECT
            FALSE,
            'Daily message limit reached. Upgrade your plan or wait until tomorrow.'::TEXT,
            usage_record.messages_sent,
            usage_record.messages_limit,
            usage_record.platform_key_calls,
            usage_record.platform_key_limit,
            usage_record.limit_reset_at;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        TRUE,
        'OK'::TEXT,
        usage_record.messages_sent,
        usage_record.messages_limit,
        usage_record.platform_key_calls,
        usage_record.platform_key_limit,
        usage_record.limit_reset_at;
END;
$$ LANGUAGE plpgsql;

-- Increment usage counters
CREATE OR REPLACE FUNCTION increment_usage(
    tenant_id_param TEXT,
    tokens_param INTEGER DEFAULT 0,
    used_platform_key BOOLEAN DEFAULT FALSE
)
RETURNS VOID AS $$
BEGIN
    -- Ensure record exists
    PERFORM get_or_create_daily_usage(tenant_id_param);

    -- Update counters
    UPDATE user_daily_usage SET
        messages_sent = messages_sent + 1,
        tokens_consumed = tokens_consumed + tokens_param,
        platform_key_calls = platform_key_calls + CASE WHEN used_platform_key THEN 1 ELSE 0 END,
        updated_at = NOW()
    WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Increment shard hit (always free)
CREATE OR REPLACE FUNCTION increment_shard_hit(tenant_id_param TEXT)
RETURNS VOID AS $$
BEGIN
    PERFORM get_or_create_daily_usage(tenant_id_param);

    UPDATE user_daily_usage SET
        shard_hits = shard_hits + 1,
        updated_at = NOW()
    WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Get best available platform key for provider
CREATE OR REPLACE FUNCTION get_platform_key(provider_param VARCHAR(50))
RETURNS TABLE (
    key_id TEXT,
    api_key_encrypted TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT pak.id, pak.api_key_encrypted
    FROM platform_api_keys pak
    WHERE pak.provider = provider_param
        AND pak.is_active = TRUE
        AND pak.daily_calls_used < pak.daily_call_limit
        AND pak.daily_tokens_used < pak.daily_token_limit
    ORDER BY pak.is_primary DESC, pak.daily_calls_used ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Record platform key usage
CREATE OR REPLACE FUNCTION record_platform_key_usage(key_id_param TEXT, tokens_param INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE platform_api_keys SET
        daily_calls_used = daily_calls_used + 1,
        daily_tokens_used = daily_tokens_used + tokens_param,
        monthly_tokens_used = monthly_tokens_used + tokens_param,
        last_used_at = NOW(),
        updated_at = NOW()
    WHERE id = key_id_param;
END;
$$ LANGUAGE plpgsql;

-- Reset daily platform key counters (call via cron at midnight)
CREATE OR REPLACE FUNCTION reset_daily_platform_keys()
RETURNS VOID AS $$
BEGIN
    UPDATE platform_api_keys SET
        daily_calls_used = 0,
        daily_tokens_used = 0,
        last_reset_at = NOW(),
        updated_at = NOW()
    WHERE is_active = TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- AUTO-UPDATE TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS trg_usage_updated_at ON user_daily_usage;
CREATE TRIGGER trg_usage_updated_at
    BEFORE UPDATE ON user_daily_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_platform_keys_updated_at ON platform_api_keys;
CREATE TRIGGER trg_platform_keys_updated_at
    BEFORE UPDATE ON platform_api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tier_limits_updated_at ON tier_limits;
CREATE TRIGGER trg_tier_limits_updated_at
    BEFORE UPDATE ON tier_limits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- MIGRATION NOTES
-- ============================================

-- Free Tier System:
-- 1. Free users get 20 messages/day using platform API keys
-- 2. Platform keys are rotated to distribute load
-- 3. Free users can only access fast/cheap models (Haiku, GPT-5.2 Instant, Gemini Flash)
-- 4. Shard hits are ALWAYS free and don't count against limits
-- 5. Users are guided to add their own API keys for unlimited access
--
-- Rate Limit Flow:
-- 1. Check can_send_message() before processing
-- 2. If allowed, process message
-- 3. Call increment_usage() after successful response
-- 4. Shard hits call increment_shard_hit() instead (no limit)
