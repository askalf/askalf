-- api_keys view for agent bridge compatibility
-- The agent bridge queries "api_keys" but the table is "forge_api_keys"
-- This view maps the columns for self-hosted deployment

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
  created_at
FROM forge_api_keys;
