-- Migration 032: Plans and Subscriptions
-- Billing infrastructure for plan-based access control

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(128) NOT NULL,
  description TEXT,
  price_monthly INTEGER,          -- cents, NULL = free or contact
  price_yearly INTEGER,           -- cents, NULL = free or contact
  limits JSONB NOT NULL DEFAULT '{}',
  features JSONB NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  stripe_price_monthly_id VARCHAR(128),
  stripe_price_yearly_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  plan_id VARCHAR(64) NOT NULL REFERENCES plans(id),
  status VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  stripe_customer_id VARCHAR(128),
  stripe_subscription_id VARCHAR(128),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Seed default plans
INSERT INTO plans (id, name, display_name, description, price_monthly, price_yearly, limits, features, sort_order, is_featured) VALUES
(
  'plan_free',
  'free',
  'Free',
  'Get started with basic agent orchestration',
  NULL, NULL,
  '{"executions_per_day": 50, "traces_per_day": 100, "private_shards": 3, "api_requests_per_day": 500, "mcp_connections": 1, "mcp_requests_per_minute": 10, "team_members": 1, "storage_mb": 100}',
  '{"public_shards": true, "private_shards": true, "mcp_access": true, "api_access": true, "team_management": false, "priority_support": false}',
  0, false
),
(
  'plan_pro',
  'pro',
  'Pro',
  'For serious builders running production agents',
  2900, 29000,
  '{"executions_per_day": 500, "traces_per_day": 2000, "private_shards": 25, "api_requests_per_day": 10000, "mcp_connections": 5, "mcp_requests_per_minute": 60, "team_members": 5, "storage_mb": 5000}',
  '{"public_shards": true, "private_shards": true, "mcp_access": true, "api_access": true, "team_management": true, "priority_support": false}',
  1, true
),
(
  'plan_team',
  'team',
  'Team',
  'For teams running agent fleets at scale',
  9900, 99000,
  '{"executions_per_day": 5000, "traces_per_day": 20000, "private_shards": 100, "api_requests_per_day": 100000, "mcp_connections": 25, "mcp_requests_per_minute": 300, "team_members": 25, "storage_mb": 50000}',
  '{"public_shards": true, "private_shards": true, "mcp_access": true, "api_access": true, "team_management": true, "priority_support": true}',
  2, false
),
(
  'plan_enterprise',
  'enterprise',
  'Enterprise',
  'Custom deployment with dedicated support and SLA',
  NULL, NULL,
  '{"executions_per_day": -1, "traces_per_day": -1, "private_shards": -1, "api_requests_per_day": -1, "mcp_connections": -1, "mcp_requests_per_minute": -1, "team_members": -1, "storage_mb": -1}',
  '{"public_shards": true, "private_shards": true, "mcp_access": true, "api_access": true, "team_management": true, "priority_support": true, "custom_integrations": true, "sla": true, "dedicated_support": true}',
  3, false
)
ON CONFLICT (id) DO NOTHING;

-- Helper function: get tenant limits from active subscription
CREATE OR REPLACE FUNCTION get_tenant_limits(p_tenant_id VARCHAR)
RETURNS JSONB AS $$
  SELECT COALESCE(
    (SELECT p.limits FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = p_tenant_id AND s.status IN ('active', 'trialing')
     ORDER BY s.created_at DESC LIMIT 1),
    (SELECT limits FROM plans WHERE name = 'free')
  );
$$ LANGUAGE SQL STABLE;

-- Helper function: get tenant features from active subscription
CREATE OR REPLACE FUNCTION get_tenant_features(p_tenant_id VARCHAR)
RETURNS JSONB AS $$
  SELECT COALESCE(
    (SELECT p.features FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = p_tenant_id AND s.status IN ('active', 'trialing')
     ORDER BY s.created_at DESC LIMIT 1),
    (SELECT features FROM plans WHERE name = 'free')
  );
$$ LANGUAGE SQL STABLE;

-- Helper function: check if tenant has a feature
CREATE OR REPLACE FUNCTION tenant_has_feature(p_tenant_id VARCHAR, p_feature VARCHAR)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (get_tenant_features(p_tenant_id)->>p_feature)::boolean,
    false
  );
$$ LANGUAGE SQL STABLE;

-- Helper function: check if tenant is within a limit
CREATE OR REPLACE FUNCTION tenant_within_limit(p_tenant_id VARCHAR, p_limit VARCHAR, p_current INTEGER)
RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN (get_tenant_limits(p_tenant_id)->>p_limit)::integer = -1 THEN true
    ELSE p_current < (get_tenant_limits(p_tenant_id)->>p_limit)::integer
  END;
$$ LANGUAGE SQL STABLE;
