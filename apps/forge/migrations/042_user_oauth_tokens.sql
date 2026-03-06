-- User OAuth tokens for Anthropic (and future providers)
-- Separate from user_provider_keys (which stores raw API keys)
CREATE TABLE IF NOT EXISTS user_oauth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes JSONB DEFAULT '[]',
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_user_provider
  ON user_oauth_tokens(user_id, provider) WHERE revoked_at IS NULL;
