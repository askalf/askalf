-- SELF Auth: Independent users and sessions
-- Prefix self_ to avoid collision with substrate DB tables

-- Migration tracking
CREATE TABLE IF NOT EXISTS self_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS self_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  preferred_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'user',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token TEXT,
  verification_token_expires_at TIMESTAMPTZ,
  password_reset_token TEXT,
  password_reset_token_expires_at TIMESTAMPTZ,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_self_users_email_normalized ON self_users (email_normalized);
CREATE INDEX idx_self_users_verification_token ON self_users (verification_token) WHERE verification_token IS NOT NULL;
CREATE INDEX idx_self_users_password_reset_token ON self_users (password_reset_token) WHERE password_reset_token IS NOT NULL;

-- Sessions
CREATE TABLE IF NOT EXISTS self_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES self_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  device_type TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_self_sessions_user_id ON self_sessions (user_id);
CREATE INDEX idx_self_sessions_token_hash ON self_sessions (token_hash);
CREATE INDEX idx_self_sessions_expires_at ON self_sessions (expires_at);
