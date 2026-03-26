-- Schema cleanup: fix missing columns, tables, and view triggers
-- Resolves: usage_count on api_keys, forge_preferences table, updatable api_keys view

-- 1. Add usage_count to forge_api_keys
ALTER TABLE forge_api_keys ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

-- 2. Recreate api_keys view with usage_count
CREATE OR REPLACE VIEW api_keys AS
SELECT
  id,
  owner_id AS user_id,
  'default' AS tenant_id,
  key_hash,
  key_prefix,
  CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
  permissions,
  rate_limit,
  last_used_at,
  expires_at,
  created_at,
  usage_count
FROM forge_api_keys;

-- 3. INSTEAD OF UPDATE trigger so agent-bridge can update through the view
CREATE OR REPLACE FUNCTION api_keys_update_trigger() RETURNS trigger AS $$
BEGIN
  UPDATE forge_api_keys
  SET last_used_at = COALESCE(NEW.last_used_at, OLD.last_used_at),
      usage_count = COALESCE(NEW.usage_count, OLD.usage_count)
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS api_keys_update ON api_keys;
CREATE TRIGGER api_keys_update
  INSTEAD OF UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION api_keys_update_trigger();

-- 4. Create forge_preferences table (budget limits, marketplace toggle, etc.)
CREATE TABLE IF NOT EXISTS forge_preferences (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL UNIQUE,
  key TEXT,
  value TEXT,
  budget_limit_daily NUMERIC(10,2),
  budget_limit_monthly NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default preferences row for self-hosted
INSERT INTO forge_preferences (user_id, budget_limit_daily, budget_limit_monthly)
VALUES ('selfhosted-admin', NULL, NULL)
ON CONFLICT (user_id) DO NOTHING;
