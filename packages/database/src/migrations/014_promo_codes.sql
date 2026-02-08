-- Migration 014: Promo Code System
-- Enables promotional codes for token grants

-- Promo codes table
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code VARCHAR(32) UNIQUE NOT NULL,

  -- Grant details
  tokens_granted INTEGER NOT NULL,
  expires_at TIMESTAMPTZ,

  -- Usage limits
  max_redemptions INTEGER DEFAULT 1,
  redemption_count INTEGER DEFAULT 0,

  -- Targeting
  single_use_per_user BOOLEAN DEFAULT true,
  require_new_user BOOLEAN DEFAULT false,
  min_tier VARCHAR(20),

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  description TEXT,
  campaign_name VARCHAR(100),
  created_by TEXT REFERENCES users(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Promo code redemptions (audit trail)
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  promo_code_id TEXT NOT NULL REFERENCES promo_codes(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  tokens_granted INTEGER NOT NULL,
  bundle_id TEXT REFERENCES token_bundles(id),
  redeemed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_tenant ON promo_redemptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_redemptions(promo_code_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_single_use ON promo_redemptions(promo_code_id, user_id);

-- Function to redeem promo code
CREATE OR REPLACE FUNCTION redeem_promo_code(
  p_code VARCHAR(32),
  p_tenant_id TEXT,
  p_user_id TEXT
) RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  tokens_granted INTEGER,
  bundle_id TEXT
) AS $$
DECLARE
  v_promo RECORD;
  v_redemption_exists BOOLEAN;
  v_user_tier VARCHAR(20);
  v_user_created_at TIMESTAMPTZ;
  v_bundle_id TEXT;
BEGIN
  -- Lock the promo code row
  SELECT * INTO v_promo
  FROM promo_codes
  WHERE UPPER(code) = UPPER(p_code) AND is_active = true
  FOR UPDATE;

  IF v_promo IS NULL THEN
    RETURN QUERY SELECT false, 'Invalid or expired promo code'::TEXT, 0, NULL::TEXT;
    RETURN;
  END IF;

  -- Check expiration
  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at < NOW() THEN
    RETURN QUERY SELECT false, 'This promo code has expired'::TEXT, 0, NULL::TEXT;
    RETURN;
  END IF;

  -- Check max redemptions
  IF v_promo.max_redemptions IS NOT NULL AND v_promo.redemption_count >= v_promo.max_redemptions THEN
    RETURN QUERY SELECT false, 'This promo code has reached its usage limit'::TEXT, 0, NULL::TEXT;
    RETURN;
  END IF;

  -- Check single use per user
  IF v_promo.single_use_per_user THEN
    SELECT EXISTS(
      SELECT 1 FROM promo_redemptions
      WHERE promo_code_id = v_promo.id AND user_id = p_user_id
    ) INTO v_redemption_exists;

    IF v_redemption_exists THEN
      RETURN QUERY SELECT false, 'You have already redeemed this promo code'::TEXT, 0, NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Check tier requirement
  IF v_promo.min_tier IS NOT NULL THEN
    SELECT tier INTO v_user_tier FROM tenants WHERE id = p_tenant_id;
    -- Simple tier check (would need proper ranking in production)
    IF v_user_tier IS NULL OR v_user_tier = 'demo' THEN
      RETURN QUERY SELECT false, 'This promo code requires a registered account'::TEXT, 0, NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Check new user requirement
  IF v_promo.require_new_user THEN
    SELECT created_at INTO v_user_created_at FROM users WHERE id = p_user_id;
    IF v_user_created_at < NOW() - INTERVAL '7 days' THEN
      RETURN QUERY SELECT false, 'This promo code is only valid for new users'::TEXT, 0, NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- All checks passed - grant tokens
  INSERT INTO token_bundles (
    id, tenant_id, tokens_purchased, tokens_remaining, price_usd,
    bundle_type, expires_at, status
  ) VALUES (
    gen_random_uuid()::text,
    p_tenant_id,
    v_promo.tokens_granted,
    v_promo.tokens_granted,
    0,
    'promotional',
    NOW() + INTERVAL '90 days', -- Promo tokens expire in 90 days
    'active'
  ) RETURNING id INTO v_bundle_id;

  -- Record redemption
  INSERT INTO promo_redemptions (promo_code_id, tenant_id, user_id, tokens_granted, bundle_id)
  VALUES (v_promo.id, p_tenant_id, p_user_id, v_promo.tokens_granted, v_bundle_id);

  -- Increment redemption count
  UPDATE promo_codes SET
    redemption_count = redemption_count + 1,
    updated_at = NOW()
  WHERE id = v_promo.id;

  RETURN QUERY SELECT
    true,
    format('Success! %s credits have been added to your account.', v_promo.tokens_granted)::TEXT,
    v_promo.tokens_granted,
    v_bundle_id;
END;
$$ LANGUAGE plpgsql;

-- Create some initial promo codes
INSERT INTO promo_codes (code, tokens_granted, max_redemptions, description, campaign_name)
VALUES
  ('LAUNCH2026', 100, 1000, 'Launch celebration - 100 free credits', 'Launch Campaign'),
  ('WELCOME50', 50, NULL, 'Welcome bonus for new users', 'Welcome Series')
ON CONFLICT (code) DO NOTHING;
