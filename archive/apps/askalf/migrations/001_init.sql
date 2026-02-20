-- Ask Alf — Database Schema
-- Run against the 'askalf' database

CREATE TABLE IF NOT EXISTS askalf_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  default_provider TEXT,
  default_model TEXT,
  message_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_askalf_convos_user ON askalf_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS askalf_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES askalf_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  tokens_used INT DEFAULT 0,
  classified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_askalf_msgs_conv ON askalf_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS askalf_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  credential_enc TEXT NOT NULL,
  last4 TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_askalf_creds_user ON askalf_credentials(user_id);

CREATE TABLE IF NOT EXISTS askalf_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  default_provider TEXT DEFAULT 'auto',
  default_model TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
