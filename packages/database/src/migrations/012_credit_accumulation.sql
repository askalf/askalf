-- ============================================
-- CREDIT ACCUMULATION SYSTEM
-- Free: 25 credits/day, no rollover (expires at midnight)
-- Paid: Rolling 7-day accumulation with caps
-- ============================================

-- ============================================
-- ADD ROLLOVER COLUMNS TO TIER_LIMITS
-- ============================================

ALTER TABLE tier_limits
  ADD COLUMN IF NOT EXISTS credits_rollover_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credits_max_accumulated INTEGER DEFAULT 0;

-- ============================================
-- UPDATE TIER CONFIGURATIONS
-- ============================================

-- Free tier: 25 credits/day, NO rollover
UPDATE tier_limits SET
  daily_messages = -1,  -- Unlimited messages, controlled by credits now
  daily_credits = 25,
  byok_enabled = FALSE,
  credits_rollover_enabled = FALSE,
  credits_max_accumulated = 0,
  model_tier_access = 'free'
WHERE tier_name = 'free';

-- Basic tier: 150 credits/day, 7-day rollover (max 1050)
UPDATE tier_limits SET
  daily_messages = -1,
  daily_credits = 150,
  byok_enabled = FALSE,
  credits_rollover_enabled = TRUE,
  credits_max_accumulated = 1050,  -- 7 days * 150
  model_tier_access = 'individual'
WHERE tier_name = 'basic';

-- Pro tier: 250 credits/day, 7-day rollover (max 1750)
UPDATE tier_limits SET
  daily_messages = -1,
  daily_credits = 250,
  byok_enabled = TRUE,
  credits_rollover_enabled = TRUE,
  credits_max_accumulated = 1750,  -- 7 days * 250
  model_tier_access = 'business'
WHERE tier_name = 'pro';

-- Team tier: 250 credits/day per user, 7-day rollover
UPDATE tier_limits SET
  daily_messages = -1,
  daily_credits = 250,
  byok_enabled = TRUE,
  credits_rollover_enabled = TRUE,
  credits_max_accumulated = 1750,
  model_tier_access = 'business'
WHERE tier_name = 'team';

-- Lifetime tier: Same as Pro
UPDATE tier_limits SET
  daily_messages = -1,
  daily_credits = 250,
  byok_enabled = TRUE,
  credits_rollover_enabled = TRUE,
  credits_max_accumulated = 1750,
  model_tier_access = 'business'
WHERE tier_name = 'lifetime';

-- Enterprise tier: Unlimited
UPDATE tier_limits SET
  daily_messages = -1,
  daily_credits = -1,  -- Unlimited
  byok_enabled = TRUE,
  credits_rollover_enabled = FALSE,
  credits_max_accumulated = 0,
  model_tier_access = 'business'
WHERE tier_name = 'enterprise';

-- ============================================
-- ADD ACCUMULATED CREDITS TO USER_DAILY_USAGE
-- ============================================

ALTER TABLE user_daily_usage
  ADD COLUMN IF NOT EXISTS accumulated_credits INTEGER DEFAULT 0;

-- ============================================
-- CREATE CREDIT BANK TABLE FOR TRACKING ROLLOVER
-- ============================================

CREATE TABLE IF NOT EXISTS credit_bank (
  id TEXT PRIMARY KEY DEFAULT 'cb_' || substr(md5(random()::text), 1, 24),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  banked_credits INTEGER NOT NULL DEFAULT 0,
  max_credits INTEGER NOT NULL DEFAULT 0,
  last_deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_withdrawal_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_bank_tenant ON credit_bank(tenant_id);

-- ============================================
-- FUNCTION: Process daily credit rollover
-- Called at start of each day or on first usage
-- ============================================

CREATE OR REPLACE FUNCTION process_daily_credits(tenant_id_param TEXT)
RETURNS TABLE (
  daily_credits INTEGER,
  banked_credits INTEGER,
  total_available INTEGER
) AS $$
DECLARE
  tenant_tier VARCHAR(50);
  tier_config tier_limits;
  bank_record credit_bank;
  yesterday_usage user_daily_usage;
  unused_yesterday INTEGER;
  new_banked INTEGER;
BEGIN
  -- Get tenant tier
  SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;
  IF tenant_tier IS NULL THEN
    tenant_tier := 'free';
  END IF;

  -- Get tier config
  SELECT * INTO tier_config FROM tier_limits WHERE tier_name = tenant_tier;
  IF tier_config IS NULL THEN
    SELECT * INTO tier_config FROM tier_limits WHERE tier_name = 'free';
  END IF;

  -- Enterprise/unlimited tiers
  IF tier_config.daily_credits < 0 THEN
    RETURN QUERY SELECT -1, 0, -1;
    RETURN;
  END IF;

  -- Get or create credit bank
  SELECT * INTO bank_record FROM credit_bank WHERE tenant_id = tenant_id_param;

  IF bank_record IS NULL THEN
    INSERT INTO credit_bank (tenant_id, banked_credits, max_credits, last_deposit_date)
    VALUES (tenant_id_param, 0, COALESCE(tier_config.credits_max_accumulated, 0), CURRENT_DATE)
    RETURNING * INTO bank_record;
  END IF;

  -- Check if we already processed today
  IF bank_record.last_deposit_date = CURRENT_DATE THEN
    RETURN QUERY SELECT
      tier_config.daily_credits,
      bank_record.banked_credits,
      tier_config.daily_credits + bank_record.banked_credits;
    RETURN;
  END IF;

  -- FREE TIER: No rollover, just reset
  IF NOT COALESCE(tier_config.credits_rollover_enabled, FALSE) THEN
    UPDATE credit_bank
    SET banked_credits = 0,
        last_deposit_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE tenant_id = tenant_id_param;

    RETURN QUERY SELECT tier_config.daily_credits, 0, tier_config.daily_credits;
    RETURN;
  END IF;

  -- PAID TIER: Calculate rollover from yesterday
  SELECT * INTO yesterday_usage
  FROM user_daily_usage
  WHERE tenant_id = tenant_id_param
    AND usage_date = CURRENT_DATE - INTERVAL '1 day';

  IF yesterday_usage IS NOT NULL THEN
    -- Calculate unused credits from yesterday
    unused_yesterday := GREATEST(0, yesterday_usage.credits_limit - yesterday_usage.credits_used);

    -- Add to bank, but cap at max
    new_banked := LEAST(
      bank_record.banked_credits + unused_yesterday,
      COALESCE(tier_config.credits_max_accumulated, 0)
    );
  ELSE
    new_banked := bank_record.banked_credits;
  END IF;

  -- Update bank
  UPDATE credit_bank
  SET banked_credits = new_banked,
      max_credits = COALESCE(tier_config.credits_max_accumulated, 0),
      last_deposit_date = CURRENT_DATE,
      updated_at = NOW()
  WHERE tenant_id = tenant_id_param
  RETURNING * INTO bank_record;

  RETURN QUERY SELECT
    tier_config.daily_credits,
    bank_record.banked_credits,
    tier_config.daily_credits + bank_record.banked_credits;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- UPDATED: Get or create daily usage with rollover
-- ============================================

CREATE OR REPLACE FUNCTION get_or_create_daily_usage(tenant_id_param TEXT)
RETURNS user_daily_usage AS $$
DECLARE
  usage_record user_daily_usage;
  tenant_tier VARCHAR(50);
  tier_config tier_limits;
  credit_info RECORD;
BEGIN
  -- Try to get existing record
  SELECT * INTO usage_record
  FROM user_daily_usage
  WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

  IF usage_record IS NOT NULL THEN
    RETURN usage_record;
  END IF;

  -- Process daily credits (handles rollover)
  SELECT * INTO credit_info FROM process_daily_credits(tenant_id_param);

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
    accumulated_credits,
    tokens_limit, tokens_consumed,
    platform_key_limit, platform_key_calls
  ) VALUES (
    tenant_id_param,
    CURRENT_DATE,
    COALESCE(tier_config.daily_messages, -1),
    0,
    COALESCE(tier_config.daily_credits, 0),
    0,
    COALESCE(credit_info.banked_credits, 0),
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

-- ============================================
-- UPDATED: Check if user can send message
-- ============================================

CREATE OR REPLACE FUNCTION can_send_message(tenant_id_param TEXT, credit_cost_param INTEGER DEFAULT 1)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  credits_used INTEGER,
  credits_limit INTEGER,
  banked_credits INTEGER,
  total_available INTEGER,
  messages_used INTEGER,
  messages_limit INTEGER,
  resets_at TIMESTAMPTZ
) AS $$
DECLARE
  usage_record user_daily_usage;
  tenant_tier VARCHAR(50);
  tier_config tier_limits;
  bank_record credit_bank;
  total_credits INTEGER;
BEGIN
  -- Get or create usage record (triggers rollover processing)
  SELECT * INTO usage_record FROM get_or_create_daily_usage(tenant_id_param);

  -- Get tenant tier
  SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;

  -- Get tier config
  SELECT * INTO tier_config FROM tier_limits WHERE tier_name = tenant_tier;

  -- Get credit bank
  SELECT * INTO bank_record FROM credit_bank WHERE tenant_id = tenant_id_param;

  -- Enterprise/Admin has no limits
  IF tenant_tier = 'enterprise' OR tenant_tier = 'admin' THEN
    RETURN QUERY SELECT
      TRUE,
      'OK'::TEXT,
      usage_record.credits_used,
      -1,
      0,
      -1,
      usage_record.messages_sent,
      -1,
      usage_record.limit_reset_at;
    RETURN;
  END IF;

  -- Check if user has BYOK enabled (unlimited)
  IF COALESCE(tier_config.byok_enabled, FALSE) THEN
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
        0,
        -1,
        usage_record.messages_sent,
        -1,
        usage_record.limit_reset_at;
      RETURN;
    END IF;
  END IF;

  -- Calculate total available credits (daily + banked)
  total_credits := usage_record.credits_limit + COALESCE(bank_record.banked_credits, 0);

  -- Check if user has enough credits
  IF usage_record.credits_used + credit_cost_param <= total_credits THEN
    RETURN QUERY SELECT
      TRUE,
      'OK'::TEXT,
      usage_record.credits_used,
      usage_record.credits_limit,
      COALESCE(bank_record.banked_credits, 0),
      total_credits - usage_record.credits_used,
      usage_record.messages_sent,
      usage_record.messages_limit,
      usage_record.limit_reset_at;
    RETURN;
  END IF;

  -- Check bundle credits as fallback
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
        COALESCE(bank_record.banked_credits, 0),
        bundle_credits,
        usage_record.messages_sent,
        usage_record.messages_limit,
        usage_record.limit_reset_at;
      RETURN;
    END IF;
  END;

  -- Not enough credits
  RETURN QUERY SELECT
    FALSE,
    'Credit limit reached. Upgrade your plan or purchase credits.'::TEXT,
    usage_record.credits_used,
    usage_record.credits_limit,
    COALESCE(bank_record.banked_credits, 0),
    0,
    usage_record.messages_sent,
    usage_record.messages_limit,
    usage_record.limit_reset_at;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- UPDATED: Deduct credits (with bank support)
-- ============================================

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
  bank_record credit_bank;
  bundle_record RECORD;
  remaining_to_deduct INTEGER := credit_amount;
  daily_remaining INTEGER;
  total_available INTEGER;
BEGIN
  -- Ensure usage record exists
  PERFORM get_or_create_daily_usage(tenant_id_param);

  SELECT * INTO usage_record
  FROM user_daily_usage
  WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

  SELECT * INTO bank_record
  FROM credit_bank
  WHERE tenant_id = tenant_id_param;

  daily_remaining := GREATEST(0, usage_record.credits_limit - usage_record.credits_used);
  total_available := daily_remaining + COALESCE(bank_record.banked_credits, 0);

  -- Check if we have enough daily + banked credits
  IF total_available >= credit_amount THEN
    -- First use daily credits
    IF daily_remaining >= credit_amount THEN
      -- All from daily
      UPDATE user_daily_usage
      SET credits_used = credits_used + credit_amount,
          messages_sent = messages_sent + 1,
          updated_at = NOW()
      WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

      RETURN QUERY SELECT
        TRUE,
        'daily'::TEXT,
        (total_available - credit_amount);
      RETURN;
    ELSE
      -- Use all daily + some banked
      UPDATE user_daily_usage
      SET credits_used = credits_limit,  -- Max out daily
          messages_sent = messages_sent + 1,
          updated_at = NOW()
      WHERE tenant_id = tenant_id_param AND usage_date = CURRENT_DATE;

      -- Deduct remainder from bank
      UPDATE credit_bank
      SET banked_credits = banked_credits - (credit_amount - daily_remaining),
          last_withdrawal_date = CURRENT_DATE,
          updated_at = NOW()
      WHERE tenant_id = tenant_id_param;

      RETURN QUERY SELECT
        TRUE,
        'daily+banked'::TEXT,
        (total_available - credit_amount);
      RETURN;
    END IF;
  END IF;

  -- Not enough daily+banked, try bundle credits
  IF use_bundle_if_exceeded THEN
    FOR bundle_record IN
      SELECT id, credits_remaining
      FROM token_bundles
      WHERE tenant_id = tenant_id_param
        AND status = 'active'
        AND credits_remaining > 0
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY expires_at NULLS LAST, created_at ASC  -- Expiring soonest first, then FIFO
    LOOP
      IF bundle_record.credits_remaining >= remaining_to_deduct THEN
        UPDATE token_bundles
        SET credits_remaining = credits_remaining - remaining_to_deduct,
            tokens_remaining = tokens_remaining - remaining_to_deduct,
            updated_at = NOW()
        WHERE id = bundle_record.id;

        UPDATE token_bundles
        SET status = 'depleted'
        WHERE id = bundle_record.id AND credits_remaining <= 0;

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

  RETURN QUERY SELECT FALSE, 'insufficient'::TEXT, 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- UPDATED: Get credit status (with bank)
-- ============================================

CREATE OR REPLACE FUNCTION get_credit_status(tenant_id_param TEXT)
RETURNS TABLE (
  daily_credits_used INTEGER,
  daily_credits_limit INTEGER,
  daily_credits_remaining INTEGER,
  banked_credits INTEGER,
  bundle_credits INTEGER,
  total_available INTEGER,
  messages_today INTEGER,
  tier TEXT,
  byok_enabled BOOLEAN,
  has_byok_keys BOOLEAN,
  rollover_enabled BOOLEAN,
  max_banked INTEGER,
  resets_at TIMESTAMPTZ
) AS $$
DECLARE
  usage_record user_daily_usage;
  tenant_tier VARCHAR(50);
  tier_config tier_limits;
  bank_record credit_bank;
  bundle_total INTEGER;
  has_keys BOOLEAN;
  daily_remaining INTEGER;
BEGIN
  -- Get or create usage record (triggers rollover processing)
  SELECT * INTO usage_record FROM get_or_create_daily_usage(tenant_id_param);

  -- Get tenant tier
  SELECT tier INTO tenant_tier FROM tenants WHERE id = tenant_id_param;

  -- Get tier config
  SELECT * INTO tier_config FROM tier_limits WHERE tier_name = tenant_tier;

  -- Get credit bank
  SELECT * INTO bank_record FROM credit_bank WHERE tenant_id = tenant_id_param;

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

  daily_remaining := GREATEST(0, usage_record.credits_limit - usage_record.credits_used);

  RETURN QUERY SELECT
    usage_record.credits_used,
    usage_record.credits_limit,
    daily_remaining,
    COALESCE(bank_record.banked_credits, 0),
    bundle_total,
    daily_remaining + COALESCE(bank_record.banked_credits, 0) + bundle_total,
    usage_record.messages_sent,
    tenant_tier,
    COALESCE(tier_config.byok_enabled, FALSE),
    has_keys,
    COALESCE(tier_config.credits_rollover_enabled, FALSE),
    COALESCE(tier_config.credits_max_accumulated, 0),
    usage_record.limit_reset_at;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- UPDATE BUNDLE EXPIRATION TO 90 DAYS DEFAULT
-- ============================================

-- Update welcome credits function to use 90 days
CREATE OR REPLACE FUNCTION grant_welcome_credits(tenant_id_param TEXT, credits_amount INTEGER DEFAULT 50)
RETURNS TEXT AS $$
DECLARE
  bundle_id TEXT;
BEGIN
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
    NOW() + INTERVAL '90 days'  -- 90 day expiration
  )
  RETURNING id INTO bundle_id;

  RETURN bundle_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- INITIALIZE CREDIT BANKS FOR EXISTING USERS
-- ============================================

INSERT INTO credit_bank (tenant_id, banked_credits, max_credits, last_deposit_date)
SELECT
  t.id,
  0,
  COALESCE(tl.credits_max_accumulated, 0),
  CURRENT_DATE
FROM tenants t
LEFT JOIN tier_limits tl ON tl.tier_name = t.tier
WHERE t.id != 'tenant_system'
  AND NOT EXISTS (SELECT 1 FROM credit_bank cb WHERE cb.tenant_id = t.id)
ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE credit_bank IS 'Tracks accumulated (rolled over) credits for paid tier users';
COMMENT ON COLUMN tier_limits.credits_rollover_enabled IS 'Whether unused daily credits roll over to the next day';
COMMENT ON COLUMN tier_limits.credits_max_accumulated IS 'Maximum credits that can be banked (e.g., 7 days worth)';
COMMENT ON COLUMN credit_bank.banked_credits IS 'Currently accumulated credits from previous days';
COMMENT ON COLUMN credit_bank.max_credits IS 'Cap on accumulated credits based on tier';
