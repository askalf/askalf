-- Migration 022: User Integrations & Repo Cache
--
-- 1. Create user_integrations table (connected git provider accounts)
-- 2. Create user_repos table (cached repo list from integrations)

-- ============================================================
-- 1. USER INTEGRATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS user_integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'bitbucket')),
  provider_user_id TEXT,
  provider_username TEXT,
  display_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  repos_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_integrations_user ON user_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_integrations_status ON user_integrations(status) WHERE status = 'active';

-- ============================================================
-- 2. USER REPOS (cached from integrations)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_repos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL REFERENCES user_integrations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  clone_url TEXT,
  default_branch TEXT DEFAULT 'main',
  is_private BOOLEAN DEFAULT false,
  description TEXT,
  language TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_user_repos_user ON user_repos(user_id);
CREATE INDEX IF NOT EXISTS idx_user_repos_integration ON user_repos(integration_id);

-- ============================================================
-- 3. INTEGRATION OAUTH STATES (reuse oauth_states table)
-- ============================================================
-- We reuse the oauth_states table from migration 021.
-- The metadata JSONB column stores { "flow": "integration", "user_id": "..." }
-- to distinguish integration connects from login OAuth flows.
