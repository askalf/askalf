-- Migration 006: Production Schema
-- Complete authentication, billing, audit, and MCP tracking tables
-- For SUBSTRATE SaaS platform at askalf.org

BEGIN;

-- ============================================
-- PHASE 1: AUTHENTICATION & USERS
-- ============================================

-- Users table (extends tenant relationship)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    email_normalized TEXT UNIQUE NOT NULL, -- lowercase, trimmed
    password_hash TEXT NOT NULL,

    -- Email verification
    email_verified BOOLEAN DEFAULT false,
    email_verification_token TEXT,
    email_verification_expires TIMESTAMPTZ,

    -- Password reset
    password_reset_token TEXT,
    password_reset_expires TIMESTAMPTZ,

    -- Account status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),

    -- Profile
    display_name TEXT,
    avatar_url TEXT,
    timezone TEXT DEFAULT 'UTC',

    -- Security
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    last_login_ip TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,

    -- Session metadata
    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT, -- 'desktop', 'mobile', 'tablet'

    -- Expiration
    expires_at TIMESTAMPTZ NOT NULL,
    last_active_at TIMESTAMPTZ DEFAULT NOW(),

    -- Revocation
    revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extend existing api_keys table with user relationship
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- ============================================
-- PHASE 2: SUBSCRIPTION & BILLING
-- ============================================

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL, -- 'free', 'individual', 'business', 'enterprise'
    display_name TEXT NOT NULL,
    description TEXT,

    -- Pricing (in cents)
    price_monthly INTEGER, -- NULL for free/enterprise
    price_yearly INTEGER,

    -- Limits (JSONB for flexibility)
    limits JSONB NOT NULL DEFAULT '{
        "executions_per_day": 50,
        "traces_per_day": 10,
        "private_shards": 0,
        "api_requests_per_day": 100,
        "mcp_connections": 0,
        "mcp_requests_per_minute": 0,
        "team_members": 1,
        "storage_mb": 100
    }'::jsonb,

    -- Features (JSONB for flexibility)
    features JSONB NOT NULL DEFAULT '{
        "public_shards": true,
        "private_shards": false,
        "mcp_access": false,
        "api_access": false,
        "team_management": false,
        "priority_support": false,
        "custom_integrations": false,
        "sla": false,
        "dedicated_support": false
    }'::jsonb,

    -- Display
    sort_order INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,

    -- Stripe
    stripe_price_monthly_id TEXT,
    stripe_price_yearly_id TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES plans(id),

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN (
        'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'
    )),

    -- Trial
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,

    -- Billing period
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,

    -- Cancellation
    cancel_at_period_end BOOLEAN DEFAULT false,
    canceled_at TIMESTAMPTZ,
    cancellation_reason TEXT,

    -- Stripe
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage records (daily aggregation)
CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Period
    date DATE NOT NULL,

    -- Usage counts
    executions INTEGER DEFAULT 0,
    traces_ingested INTEGER DEFAULT 0,
    api_requests INTEGER DEFAULT 0,
    mcp_requests INTEGER DEFAULT 0,
    tokens_saved INTEGER DEFAULT 0,

    -- Storage
    storage_used_mb NUMERIC(10,2) DEFAULT 0,

    -- Limits hit
    executions_limit_hit BOOLEAN DEFAULT false,
    api_limit_hit BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id, date)
);

-- Invoices table (mirrors Stripe)
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES subscriptions(id),

    -- Stripe reference
    stripe_invoice_id TEXT UNIQUE,

    -- Amount (in cents)
    amount_due INTEGER NOT NULL,
    amount_paid INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'usd',

    -- Status
    status TEXT CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),

    -- Dates
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,

    -- PDF
    invoice_pdf_url TEXT,
    hosted_invoice_url TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PHASE 3: AUDIT & LOGGING
-- ============================================

-- Audit log
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,

    -- Actor
    tenant_id TEXT REFERENCES tenants(id),
    user_id TEXT REFERENCES users(id),
    api_key_id TEXT REFERENCES api_keys(id),

    -- Action
    action TEXT NOT NULL, -- 'user.login', 'shard.execute', 'subscription.upgrade', etc.
    resource_type TEXT, -- 'user', 'shard', 'subscription', etc.
    resource_id TEXT,

    -- Details
    details JSONB DEFAULT '{}',

    -- Request context
    ip_address TEXT,
    user_agent TEXT,
    request_id TEXT,

    -- Result
    success BOOLEAN DEFAULT true,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rate limit tracking (Redis primary, PG backup)
CREATE TABLE IF NOT EXISTS rate_limit_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Limit type
    limit_type TEXT NOT NULL, -- 'api', 'mcp', 'execution', 'trace'

    -- Window
    window_start TIMESTAMPTZ NOT NULL,
    window_size_seconds INTEGER NOT NULL,

    -- Count
    request_count INTEGER DEFAULT 0,

    UNIQUE(tenant_id, limit_type, window_start)
);

-- ============================================
-- PHASE 4: EMAIL & NOTIFICATIONS
-- ============================================

-- Email queue
CREATE TABLE IF NOT EXISTS email_queue (
    id TEXT PRIMARY KEY,

    -- Recipient
    to_email TEXT NOT NULL,
    to_name TEXT,

    -- Content
    template TEXT NOT NULL, -- 'welcome', 'verify', 'reset', 'invoice', etc.
    subject TEXT NOT NULL,
    variables JSONB DEFAULT '{}',

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),

    -- Tracking
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_attempt_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    error_message TEXT,

    -- External
    provider TEXT, -- 'resend', 'sendgrid'
    external_id TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ DEFAULT NOW()
);

-- Notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Email preferences
    email_marketing BOOLEAN DEFAULT true,
    email_product_updates BOOLEAN DEFAULT true,
    email_usage_alerts BOOLEAN DEFAULT true,
    email_billing BOOLEAN DEFAULT true,

    -- Thresholds
    usage_alert_threshold INTEGER DEFAULT 80, -- Percentage

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

-- ============================================
-- PHASE 5: MCP SERVER TRACKING
-- ============================================

-- MCP connections
CREATE TABLE IF NOT EXISTS mcp_connections (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,

    -- Connection info
    connection_type TEXT CHECK (connection_type IN ('sse', 'websocket')),
    client_info JSONB DEFAULT '{}', -- User agent, client name, etc.

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),

    -- Timestamps
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ
);

-- MCP request log (for debugging/support)
CREATE TABLE IF NOT EXISTS mcp_requests (
    id TEXT PRIMARY KEY,
    connection_id TEXT REFERENCES mcp_connections(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Request
    tool_name TEXT NOT NULL,
    arguments JSONB,

    -- Response
    success BOOLEAN,
    execution_ms INTEGER,
    error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_normalized);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at) WHERE NOT revoked;

-- API Keys (extend existing)
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id) WHERE user_id IS NOT NULL;

-- Plans
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active) WHERE is_active = true;

-- Subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Usage
CREATE INDEX IF NOT EXISTS idx_usage_tenant_date ON usage_records(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(date);

-- Invoices
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe ON invoices(stripe_invoice_id);

-- Audit
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Email
CREATE INDEX IF NOT EXISTS idx_email_status ON email_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_scheduled ON email_queue(scheduled_for) WHERE status = 'pending';

-- MCP
CREATE INDEX IF NOT EXISTS idx_mcp_conn_tenant ON mcp_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_conn_active ON mcp_connections(tenant_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_mcp_req_tenant ON mcp_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_req_created ON mcp_requests(created_at);

-- ============================================
-- SEED DATA
-- ============================================

-- Insert default plans
INSERT INTO plans (id, name, display_name, description, price_monthly, price_yearly, limits, features, sort_order, is_featured)
VALUES
    ('plan_free', 'free', 'Free', 'Try SUBSTRATE with limited features', NULL, NULL,
     '{"executions_per_day": 50, "traces_per_day": 10, "private_shards": 0, "api_requests_per_day": 100, "mcp_connections": 0, "mcp_requests_per_minute": 0, "team_members": 1, "storage_mb": 100}'::jsonb,
     '{"public_shards": true, "private_shards": false, "mcp_access": false, "api_access": false, "team_management": false, "priority_support": false}'::jsonb,
     1, false),

    ('plan_individual', 'individual', 'Individual', 'For individual developers', 1900, 19000,
     '{"executions_per_day": 1000, "traces_per_day": 100, "private_shards": 50, "api_requests_per_day": 5000, "mcp_connections": 2, "mcp_requests_per_minute": 30, "team_members": 1, "storage_mb": 1000}'::jsonb,
     '{"public_shards": true, "private_shards": true, "mcp_access": true, "api_access": true, "team_management": false, "priority_support": false}'::jsonb,
     2, true),

    ('plan_business', 'business', 'Business', 'For teams and organizations', 9900, 99000,
     '{"executions_per_day": 10000, "traces_per_day": 1000, "private_shards": 500, "api_requests_per_day": 50000, "mcp_connections": 10, "mcp_requests_per_minute": 200, "team_members": 10, "storage_mb": 10000}'::jsonb,
     '{"public_shards": true, "private_shards": true, "mcp_access": true, "api_access": true, "team_management": true, "priority_support": true}'::jsonb,
     3, false),

    ('plan_enterprise', 'enterprise', 'Enterprise', 'Custom solutions for large organizations', NULL, NULL,
     '{"executions_per_day": -1, "traces_per_day": -1, "private_shards": -1, "api_requests_per_day": -1, "mcp_connections": -1, "mcp_requests_per_minute": -1, "team_members": -1, "storage_mb": -1}'::jsonb,
     '{"public_shards": true, "private_shards": true, "mcp_access": true, "api_access": true, "team_management": true, "priority_support": true, "custom_integrations": true, "sla": true, "dedicated_support": true}'::jsonb,
     4, false)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update updated_at for users
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_usage_updated_at ON usage_records;
CREATE TRIGGER trg_usage_updated_at
    BEFORE UPDATE ON usage_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_notification_prefs_updated_at ON notification_preferences;
CREATE TRIGGER trg_notification_prefs_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get tenant limits from subscription
CREATE OR REPLACE FUNCTION get_tenant_limits(p_tenant_id TEXT)
RETURNS JSONB AS $$
DECLARE
    v_limits JSONB;
BEGIN
    SELECT p.limits INTO v_limits
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.tenant_id = p_tenant_id
      AND s.status IN ('active', 'trialing')
    ORDER BY s.created_at DESC
    LIMIT 1;

    -- Default to free plan limits if no subscription
    IF v_limits IS NULL THEN
        SELECT limits INTO v_limits FROM plans WHERE name = 'free';
    END IF;

    RETURN COALESCE(v_limits, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Get tenant features from subscription
CREATE OR REPLACE FUNCTION get_tenant_features(p_tenant_id TEXT)
RETURNS JSONB AS $$
DECLARE
    v_features JSONB;
BEGIN
    SELECT p.features INTO v_features
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.tenant_id = p_tenant_id
      AND s.status IN ('active', 'trialing')
    ORDER BY s.created_at DESC
    LIMIT 1;

    -- Default to free plan features if no subscription
    IF v_features IS NULL THEN
        SELECT features INTO v_features FROM plans WHERE name = 'free';
    END IF;

    RETURN COALESCE(v_features, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Check if tenant has feature
CREATE OR REPLACE FUNCTION tenant_has_feature(p_tenant_id TEXT, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_features JSONB;
BEGIN
    v_features := get_tenant_features(p_tenant_id);
    RETURN COALESCE((v_features->>p_feature)::boolean, false);
END;
$$ LANGUAGE plpgsql;

-- Check if tenant is within limit
CREATE OR REPLACE FUNCTION tenant_within_limit(p_tenant_id TEXT, p_limit_type TEXT, p_current_count INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_limits JSONB;
    v_limit INTEGER;
BEGIN
    v_limits := get_tenant_limits(p_tenant_id);
    v_limit := (v_limits->>p_limit_type)::integer;

    -- -1 means unlimited
    IF v_limit = -1 THEN
        RETURN true;
    END IF;

    RETURN COALESCE(p_current_count < v_limit, false);
END;
$$ LANGUAGE plpgsql;

-- Increment usage record
CREATE OR REPLACE FUNCTION increment_usage(
    p_tenant_id TEXT,
    p_field TEXT,
    p_amount INTEGER DEFAULT 1
)
RETURNS void AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_id TEXT;
BEGIN
    v_id := 'usage_' || p_tenant_id || '_' || v_today::text;

    INSERT INTO usage_records (id, tenant_id, date)
    VALUES (v_id, p_tenant_id, v_today)
    ON CONFLICT (tenant_id, date) DO NOTHING;

    EXECUTE format(
        'UPDATE usage_records SET %I = %I + $1, updated_at = NOW() WHERE tenant_id = $2 AND date = $3',
        p_field, p_field
    ) USING p_amount, p_tenant_id, v_today;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- MIGRATION LOG
-- ============================================

DO $$
BEGIN
    RAISE NOTICE 'Migration 006 complete: Production schema created';
    RAISE NOTICE 'Tables created: users, sessions, plans, subscriptions, usage_records, invoices, audit_logs, rate_limit_records, email_queue, notification_preferences, mcp_connections, mcp_requests';
    RAISE NOTICE 'Seed data: 4 plans (free, individual, business, enterprise)';
END $$;

COMMIT;
