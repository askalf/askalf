-- Migration 021: OAuth Login Support
--
-- 1. Add csrf_token column to sessions (used in code but missing from migrations)
-- 2. Create user_oauth_accounts table (links OAuth identities to users)
-- 3. Create oauth_states table (CSRF protection for OAuth flows)
-- 4. Make password_hash nullable (OAuth-only users have no password)

-- ============================================================
-- 1. ADD MISSING csrf_token COLUMN TO SESSIONS
-- ============================================================

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS csrf_token TEXT;

-- ============================================================
-- 2. USER OAUTH ACCOUNTS
-- ============================================================

CREATE TABLE IF NOT EXISTS user_oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'apple')),
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  raw_profile JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON user_oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider ON user_oauth_accounts(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_email ON user_oauth_accounts(email);

-- ============================================================
-- 3. OAUTH STATES (CSRF protection)
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  redirect_uri TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes'
);

-- Auto-cleanup expired states
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- ============================================================
-- 4. MAKE password_hash NULLABLE
-- ============================================================

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
