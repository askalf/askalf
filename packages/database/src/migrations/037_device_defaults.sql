-- Ensure user_integrations and channel_configs have required columns for self-hosted
-- These were added manually during the session — this migration ensures they exist on fresh installs

CREATE TABLE IF NOT EXISTS user_integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'selfhosted-admin',
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  status TEXT DEFAULT 'active',
  display_name TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS user_provider_keys (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL DEFAULT 'selfhosted-admin',
  provider_type TEXT NOT NULL,
  api_key_encrypted TEXT,
  base_url TEXT,
  is_active BOOLEAN DEFAULT true,
  label TEXT,
  key_hint TEXT,
  model_override TEXT,
  metadata JSONB DEFAULT '{}',
  last_verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider_type)
);

-- Ensure channel_configs has all required columns
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'default';
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS channel_type TEXT DEFAULT 'generic';
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'selfhosted-admin';
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS encrypted_credentials TEXT;

-- Ensure forge_agents has role column
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'worker';
