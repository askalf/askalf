-- Migration 024: User Provider Keys
-- Per-user API key storage for AI providers (Anthropic, OpenAI, etc.)
-- Users can bring their own keys; system keys remain as fallback

CREATE TABLE IF NOT EXISTS user_provider_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('anthropic', 'openai', 'xai', 'deepseek')),
  api_key_encrypted TEXT NOT NULL,
  key_hint TEXT,
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_type)
);

CREATE INDEX IF NOT EXISTS idx_user_provider_keys_user ON user_provider_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_provider_keys_lookup ON user_provider_keys(user_id, provider_type) WHERE is_active = true;
