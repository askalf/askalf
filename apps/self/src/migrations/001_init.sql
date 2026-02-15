-- Self AI: Foundation Schema
-- Database: self (independent from substrate and forge)

-- ============================================
-- CONVERSATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS self_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_self_convos_user ON self_conversations(user_id, updated_at DESC);

-- ============================================
-- MESSAGES
-- ============================================

CREATE TABLE IF NOT EXISTS self_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES self_conversations(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    tool_calls JSONB DEFAULT '[]',
    actions JSONB DEFAULT '[]',
    tokens_used INTEGER DEFAULT 0,
    cost_usd NUMERIC(10,6) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_self_msgs_convo ON self_messages(conversation_id, created_at ASC);

-- ============================================
-- USER CONNECTIONS (OAuth: Google, Microsoft, GitHub)
-- ============================================

CREATE TABLE IF NOT EXISTS user_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'microsoft', 'github')),
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[] DEFAULT '{}',
    profile_data JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

-- ============================================
-- USER CREDENTIALS (AI providers: Claude, OpenAI)
-- ============================================

CREATE TABLE IF NOT EXISTS user_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('claude', 'openai')),
    credential_type VARCHAR(20) NOT NULL CHECK (credential_type IN ('api_key', 'oauth')),
    credential_enc TEXT NOT NULL,
    last4 VARCHAR(4),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'invalid')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

-- ============================================
-- USER PREFERENCES (learned from conversation)
-- ============================================

CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category VARCHAR(30) NOT NULL CHECK (category IN ('preference', 'fact', 'behavior', 'context')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source_conversation_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_prefs_user ON user_preferences(user_id, category);
