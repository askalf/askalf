-- ============================================
-- CREDIT SYSTEM UPDATE
-- Match pricing page: credits/day, model costs, bundles
-- ============================================

-- ============================================
-- UPDATE TIER LIMITS
-- ============================================

-- Add credits columns to tier_limits
ALTER TABLE tier_limits
  ADD COLUMN IF NOT EXISTS daily_credits INTEGER,
  ADD COLUMN IF NOT EXISTS byok_enabled BOOLEAN DEFAULT FALSE;

-- Update tier configurations to match pricing page
UPDATE tier_limits SET
  daily_messages = 20,
  daily_credits = 0,  -- Free tier uses messages, not credits
  byok_enabled = FALSE,
  model_tier_access = 'free'
WHERE tier_name = 'free';

-- Insert/update tiers to match pricing
INSERT INTO tier_limits (id, tier_name, daily_messages, daily_credits, byok_enabled, model_tier_access, can_use_shards, can_create_shards, max_conversations) VALUES
  ('tl_basic', 'basic', -1, 150, FALSE, 'individual', TRUE, TRUE, 100),
  ('tl_pro', 'pro', -1, 250, TRUE, 'business', TRUE, TRUE, 1000),
  ('tl_team', 'team', -1, 250, TRUE, 'business', TRUE, TRUE, -1),
  ('tl_lifetime', 'lifetime', -1, 250, TRUE, 'business', TRUE, TRUE, -1)
ON CONFLICT (tier_name) DO UPDATE SET
  daily_messages = EXCLUDED.daily_messages,
  daily_credits = EXCLUDED.daily_credits,
  byok_enabled = EXCLUDED.byok_enabled,
  model_tier_access = EXCLUDED.model_tier_access,
  updated_at = NOW();

-- ============================================
-- ADD CREDIT COST TO MODELS
-- ============================================

-- Add credit_cost column to model_access_tiers
ALTER TABLE model_access_tiers
  ADD COLUMN IF NOT EXISTS credit_cost INTEGER DEFAULT 1;

-- Update model credit costs based on tier
-- Fast models = 1 credit
UPDATE model_access_tiers SET credit_cost = 1 WHERE is_fast_model = TRUE;

-- Standard models = 2 credits
UPDATE model_access_tiers SET credit_cost = 2 WHERE is_fast_model = FALSE AND is_reasoning_model = FALSE;

-- Reasoning models = 10 credits
UPDATE model_access_tiers SET credit_cost = 10 WHERE is_reasoning_model = TRUE;

-- ============================================
-- UPDATE DAILY USAGE TRACKING
-- ============================================

-- Add credits columns to user_daily_usage
ALTER TABLE user_daily_usage
  ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_limit INTEGER DEFAULT 0;

-- ============================================
-- UPDATE TOKEN BUNDLES TO CREDIT BUNDLES
-- ============================================

-- Rename for clarity (tokens → credits)
-- Note: We keep the table name for backwards compatibility
-- but add a credits column

ALTER TABLE token_bundles
  ADD COLUMN IF NOT EXISTS credits_purchased INTEGER,
  ADD COLUMN IF NOT EXISTS credits_remaining INTEGER;

-- Copy existing token data to credits (1 token = 1 credit for existing bundles)
UPDATE token_bundles
SET credits_purchased = tokens_purchased,
    credits_remaining = tokens_remaining
WHERE credits_purchased IS NULL;

-- ============================================
-- UPDATED UTILITY FUNCTIONS
-- ============================================

-- Get or create daily usage with credits
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
        tenant_id, usage_date,
        messages_limit, messages_sent,
        credits_limit, credits_used,
        tokens_limit, tokens_consumed,
        platform_key_limit, platform_key_calls
    ) VALUES (
        tenant_id_param,
        CURRENT_DATE,
        tier_config.daily_messages,
        0,
        COALESCE(tier_config.daily_credits, 0),
        0,
        COALESCE(tier_config.daily_tokens, 0),
        0,
        tier_config.platform_key_daily_limit,
        0
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

-- Check if user can send message (with credit check)
CREATE OR REPLACE FUNCTION can_send_message(tenant_id_param TEXT, credit_cost_param INTEGER DEFAULT 1)
RETURNS TABLE (
    allowed BOOLEAN,
    reason TEXT,
    credits_used INTEGER,
    credits_limit INTEGER,
    messages_used INTEGER,
    messages_limit INTEGER,
    resets_at TIMESTAMPTZ
) AS $$
DECLARE
    usage_record user_daily_usage;
    tenant_tier VARCHAR(50);
    tier_config tier_limits;
BEGIN
    -- Get or create usage record
    SELECT * INTO usage_record FROM get_or_create_daily_usage(tenant_id_param);

    -- Get tenant tier
    SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;

    -- Get tier config
    SELECT * INTO tier_config FROM tier_limits WHERE tier_name = tenant_tier;

    -- Enterprise/Admin has no limits
    IF tenant_tier = 'enterprise' OR tenant_tier = 'admin' THEN
        RETURN QUERY SELECT
            TRUE,
            'OK'::TEXT,
            usage_record.credits_used,
            -1,
            usage_record.messages_sent,
            -1,
            usage_record.limit_reset_at;
        RETURN;
    END IF;

    -- Check if user has BYOK enabled (unlimited)
    IF tier_config.byok_enabled THEN
        -- Check if they have any active BYOK keys
        IF EXISTS (
            SELECT 1 FROM user_ai_connectors
            WHERE tenant_id = tenant_id_param
            AND is_enabled = TRUE
            AND api_key_encrypted IS NOT NULL
        ) THEN
            RETURN QUERY SELECT
                TRUE,
                'BYOK unlimited'::TEXT,
                usage_record.credits_used,
                -1,
                usage_record.messages_sent,
                -1,
                usage_record.limit_reset_at;
            RETURN;
        END IF;
    END IF;

    -- Free tier: check message limit
    IF tenant_tier = 'free' THEN
        IF usage_record.messages_limit > 0 AND usage_record.messages_sent >= usage_record.messages_limit THEN
            RETURN QUERY SELECT
                FALSE,
                'Daily message limit reached. Upgrade for more messages.'::TEXT,
                usage_record.credits_used,
                usage_record.credits_limit,
                usage_record.messages_sent,
                usage_record.messages_limit,
                usage_record.limit_reset_at;
            RETURN;
        END IF;

        RETURN QUERY SELECT
            TRUE,
            'OK'::TEXT,
            usage_record.credits_used,
            usage_record.credits_limit,
            usage_record.messages_sent,
            usage_record.messages_limit,
            usage_record.limit_reset_at;
        RETURN;
    END IF;

    -- Paid tiers: check credit limit
    IF usage_record.credits_limit > 0 AND (usage_record.credits_used + credit_cost_param) > usage_record.credits_limit THEN
        -- Check if user has bundle credits
        DECLARE
            bundle_credits INTEGER;
        BEGIN
            SELECT COALESCE(SUM(credits_remaining), 0) INTO bundle_credits
            FROM token_bundles
            WHERE tenant_id = tenant_id_param
              AND status = 'active'
              AND credits_remaining > 0
              AND (expires_at IS NULL OR expires_at > NOW());

            IF bundle_credits >= credit_cost_param THEN
                RETURN QUERY SELECT
                    TRUE,
                    'Using bundle credits'::TEXT,
                    usage_record.credits_used,
                    usage_record.credits_limit,
                    usage_record.messages_sent,
                    usage_record.messages_limit,
                    usage_record.limit_reset_at;
                RETURN;
            END IF;
        END;

        RETURN QUERY SELECT
            FALSE,
            'Daily credit limit reached. Buy credits or wait until tomorrow.'::TEXT,
            usage_record.credits_used,
            usage_record.credits_limit,
            usage_record.messages_sent,
            usage_record.messages_limit,
            usage_record.limit_reset_at;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        TRUE,
        'OK'::TEXT,
        usage_record.credits_used,
        usage_record.credits_limit,
        usage_record.messages_sent,
        usage_record.messages_limit,
        usage_record.limit_reset_at;
END;
$$ LANGUAGE plpgsql;

-- Deduct credits from user
CREATE OR REPLACE FUNCTION deduct_credits(
    tenant_id_param TEXT,
    credit_amount INTEGER,
    use_bundle_if_exceeded BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    success BOOLEAN,
    source TEXT,
    credits_remaining INTEGER
) AS $$
DECLARE
    usage_record user_daily_usage;
    bundle_record RECORD;
    remaining_to_deduct INTEGER := credit_amount;
BEGIN
    -- Ensure usage record exists
    PERFORM get_or_create_daily_usage(tenant_id_param);

    SELECT * INTO usage_record
    FROM user_daily_usage
    WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

    -- Check if within daily limit
    IF usage_record.credits_limit <= 0 OR (usage_record.credits_used + credit_amount) <= usage_record.credits_limit THEN
        -- Deduct from daily credits
        UPDATE user_daily_usage
        SET credits_used = credits_used + credit_amount,
            messages_sent = messages_sent + 1,
            updated_at = NOW()
        WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

        RETURN QUERY SELECT
            TRUE,
            'daily'::TEXT,
            (usage_record.credits_limit - usage_record.credits_used - credit_amount);
        RETURN;
    END IF;

    -- Daily limit exceeded - try bundle credits
    IF use_bundle_if_exceeded THEN
        FOR bundle_record IN
            SELECT id, credits_remaining
            FROM token_bundles
            WHERE tenant_id = tenant_id_param
              AND status = 'active'
              AND credits_remaining > 0
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY created_at ASC  -- FIFO
        LOOP
            IF bundle_record.credits_remaining >= remaining_to_deduct THEN
                -- Deduct from this bundle
                UPDATE token_bundles
                SET credits_remaining = credits_remaining - remaining_to_deduct,
                    tokens_remaining = tokens_remaining - remaining_to_deduct,
                    updated_at = NOW()
                WHERE id = bundle_record.id;

                -- Update status if depleted
                UPDATE token_bundles
                SET status = 'depleted'
                WHERE id = bundle_record.id AND credits_remaining <= 0;

                -- Still increment message count
                UPDATE user_daily_usage
                SET messages_sent = messages_sent + 1,
                    updated_at = NOW()
                WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

                RETURN QUERY SELECT
                    TRUE,
                    'bundle'::TEXT,
                    (SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER FROM token_bundles
                     WHERE tenant_id = tenant_id_param AND status = 'active');
                RETURN;
            ELSE
                -- Partial deduction from this bundle
                remaining_to_deduct := remaining_to_deduct - bundle_record.credits_remaining;
                UPDATE token_bundles
                SET credits_remaining = 0,
                    tokens_remaining = 0,
                    status = 'depleted',
                    updated_at = NOW()
                WHERE id = bundle_record.id;
            END IF;
        END LOOP;
    END IF;

    -- Not enough credits
    RETURN QUERY SELECT
        FALSE,
        'insufficient'::TEXT,
        0;
END;
$$ LANGUAGE plpgsql;

-- Get user's credit status
CREATE OR REPLACE FUNCTION get_credit_status(tenant_id_param TEXT)
RETURNS TABLE (
    daily_credits_used INTEGER,
    daily_credits_limit INTEGER,
    daily_credits_remaining INTEGER,
    bundle_credits INTEGER,
    total_available INTEGER,
    messages_today INTEGER,
    tier TEXT,
    byok_enabled BOOLEAN,
    has_byok_keys BOOLEAN,
    resets_at TIMESTAMPTZ
) AS $$
DECLARE
    usage_record user_daily_usage;
    tenant_tier VARCHAR(50);
    tier_config tier_limits;
    bundle_total INTEGER;
    has_keys BOOLEAN;
BEGIN
    -- Get or create usage record
    SELECT * INTO usage_record FROM get_or_create_daily_usage(tenant_id_param);

    -- Get tenant tier
    SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;

    -- Get tier config
    SELECT * INTO tier_config FROM tier_limits WHERE tier_name = tenant_tier;

    -- Get bundle credits
    SELECT COALESCE(SUM(credits_remaining), 0) INTO bundle_total
    FROM token_bundles
    WHERE tenant_id = tenant_id_param
      AND status = 'active'
      AND credits_remaining > 0
      AND (expires_at IS NULL OR expires_at > NOW());

    -- Check for BYOK keys
    SELECT EXISTS (
        SELECT 1 FROM user_ai_connectors
        WHERE tenant_id = tenant_id_param
        AND is_enabled = TRUE
        AND api_key_encrypted IS NOT NULL
    ) INTO has_keys;

    RETURN QUERY SELECT
        usage_record.credits_used,
        usage_record.credits_limit,
        GREATEST(usage_record.credits_limit - usage_record.credits_used, 0),
        bundle_total,
        GREATEST(usage_record.credits_limit - usage_record.credits_used, 0) + bundle_total,
        usage_record.messages_sent,
        tenant_tier,
        COALESCE(tier_config.byok_enabled, FALSE),
        has_keys,
        usage_record.limit_reset_at;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- GRANT NEW USER WELCOME CREDITS
-- ============================================

-- Function to grant welcome credits to new users
CREATE OR REPLACE FUNCTION grant_welcome_credits(tenant_id_param TEXT, credits_amount INTEGER DEFAULT 50)
RETURNS TEXT AS $$
DECLARE
    bundle_id TEXT;
BEGIN
    -- Insert welcome bundle
    INSERT INTO token_bundles (
        id, tenant_id,
        tokens_purchased, tokens_remaining,
        credits_purchased, credits_remaining,
        price_usd, bundle_type, status,
        expires_at
    ) VALUES (
        'bnd_' || substr(md5(random()::text), 1, 24),
        tenant_id_param,
        credits_amount, credits_amount,
        credits_amount, credits_amount,
        0, 'promotional', 'active',
        NOW() + INTERVAL '30 days'  -- Welcome credits expire in 30 days
    )
    RETURNING id INTO bundle_id;

    RETURN bundle_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Grant welcome credits on signup
-- ============================================

CREATE OR REPLACE FUNCTION auto_grant_welcome_credits()
RETURNS TRIGGER AS $$
BEGIN
    -- Grant 50 welcome credits to new tenants (not system tenant)
    IF NEW.id != 'tenant_system' THEN
        PERFORM grant_welcome_credits(NEW.id, 50);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if it doesn't exist
DROP TRIGGER IF EXISTS trg_welcome_credits ON tenants;
CREATE TRIGGER trg_welcome_credits
    AFTER INSERT ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION auto_grant_welcome_credits();

-- ============================================
-- GRANT WELCOME CREDITS TO EXISTING USERS
-- ============================================

-- Grant to existing non-system tenants that don't have any bundles
INSERT INTO token_bundles (
    id, tenant_id,
    tokens_purchased, tokens_remaining,
    credits_purchased, credits_remaining,
    price_usd, bundle_type, status,
    expires_at
)
SELECT
    'bnd_' || substr(md5(t.id || random()::text), 1, 24),
    t.id,
    50, 50,
    50, 50,
    0, 'promotional', 'active',
    NOW() + INTERVAL '30 days'
FROM tenants t
WHERE t.id != 'tenant_system'
  AND NOT EXISTS (
    SELECT 1 FROM token_bundles tb WHERE tb.tenant_id = t.id
  );

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN tier_limits.daily_credits IS 'Daily credit allowance for paid tiers. Free tier uses daily_messages instead.';
COMMENT ON COLUMN tier_limits.byok_enabled IS 'Whether this tier can use BYOK (unlimited usage with own API keys)';
COMMENT ON COLUMN model_access_tiers.credit_cost IS 'Credits deducted per message: Fast=1, Standard=2, Reasoning=10';
COMMENT ON COLUMN user_daily_usage.credits_used IS 'Credits consumed today';
COMMENT ON COLUMN user_daily_usage.credits_limit IS 'Daily credit limit based on tier';
COMMENT ON COLUMN token_bundles.credits_purchased IS 'Total credits in this bundle';
COMMENT ON COLUMN token_bundles.credits_remaining IS 'Remaining credits in this bundle';
