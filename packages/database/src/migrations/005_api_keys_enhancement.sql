-- ============================================
-- SUBSTRATE v1: API Keys Enhancement
-- Adds additional columns for user-level keys and tracking
-- ============================================

-- Add user_id column (nullable, for user-specific keys)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Add description column
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS description TEXT;

-- Add usage_count for tracking
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0 NOT NULL;

-- Add revoked_at timestamp
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Add key_preview for display (first 12 chars)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_preview VARCHAR(20);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id) WHERE user_id IS NOT NULL;
