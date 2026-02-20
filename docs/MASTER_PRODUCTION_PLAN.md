# SUBSTRATE: Master Production Plan

## Product Vision

**SUBSTRATE** is an AI cognitive memory system that learns patterns from LLM interactions and crystallizes them into reusable procedural shards, dramatically reducing token usage while building persistent memory across sessions.

**Target Market:**
- Individual developers using AI coding assistants
- Development teams wanting shared AI memory
- Enterprises needing consistent AI behavior

**Revenue Model:**
- Free trial (limited)
- Individual subscription ($19/month)
- Business subscription ($99/month)
- Enterprise (custom pricing)

---

## System Architecture

```
                                    INTERNET
                                        │
                           ┌────────────┴────────────┐
                           │         NGINX           │
                           │    (SSL Termination)    │
                           │      Load Balancer      │
                           └────────────┬────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        │               │               │               │               │
        ▼               ▼               ▼               ▼               ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   WEBSITE     │ │     API       │ │ USER DASHBOARD│ │ADMIN DASHBOARD│ │  MCP SERVER   │
│ amnesia.tax  │ │api.amnesia.tax│ │app.amnesia.tax│ │admin.substrate│ │mcp.amnesia.tax│
│    :3002      │ │    :3000      │ │    :3003      │ │    :3001      │ │    :3004      │
│               │ │               │ │               │ │               │ │               │
│ • Landing    │ │ • Auth        │ │ • My Shards   │ │ • All Users   │ │ • SSE/WS      │
│ • Demo       │ │ • Execute     │ │ • Traces      │ │ • All Tenants │ │ • Tool Calls  │
│ • Pricing    │ │ • Memory      │ │ • Episodes    │ │ • System      │ │ • Auth        │
│ • Signup     │ │ • Billing     │ │ • Settings    │ │ • Config      │ │ • Rate Limit  │
│ • Login      │ │ • Tenants     │ │ • Billing     │ │ • Logs        │ │               │
└───────────────┘ └───────┬───────┘ └───────────────┘ └───────────────┘ └───────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│    WORKER     │ │   POSTGRES    │ │     REDIS     │
│  (Metabolic)  │ │  (pgvector)   │ │   (Cache)     │
│               │ │               │ │               │
│ • Crystallize │ │ • Users       │ │ • Sessions    │
│ • Promote     │ │ • Tenants     │ │ • Rate Limits │
│ • Decay       │ │ • Shards      │ │ • Job Queue   │
│ • Email Queue │ │ • Traces      │ │ • Pub/Sub     │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## Repository Structure

```
substrate/
├── apps/
│   ├── api/                    # Core API server
│   ├── worker/                 # Background job processor
│   ├── website/                # Public marketing website
│   ├── user-dashboard/         # User portal
│   ├── admin-dashboard/        # Admin console
│   └── mcp-server/             # Universal hosted MCP
│
├── packages/
│   ├── core/                   # Core utilities (existing)
│   ├── database/               # Database client (existing)
│   ├── ai/                     # AI integrations (existing)
│   ├── memory/                 # Memory systems (existing)
│   ├── metabolic/              # Metabolic cycles (existing)
│   ├── sandbox/                # Code execution (existing)
│   ├── events/                 # Event bus (existing)
│   ├── observability/          # Logging (existing)
│   ├── auth/                   # Authentication (NEW)
│   ├── billing/                # Stripe integration (NEW)
│   ├── email/                  # Email sending (NEW)
│   └── limits/                 # Rate limiting & quotas (NEW)
│
├── infrastructure/
│   ├── nginx/                  # Reverse proxy config
│   ├── ssl/                    # SSL certificates
│   ├── prometheus/             # Metrics collection
│   ├── grafana/                # Dashboards
│   └── scripts/                # Deployment scripts
│
├── migrations/                 # All database migrations
├── tests/                      # E2E and integration tests
├── docs/                       # Documentation
│
├── docker-compose.yml          # Development
├── docker-compose.prod.yml     # Production
├── .env.example                # Environment template
├── MASTER_PRODUCTION_PLAN.md   # This file
└── README.md
```

---

## Phase 1: Database Schema & Migrations

### 1.1 Complete Database Schema

Create `packages/database/migrations/006_production_schema.sql`:

```sql
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

-- API Keys table (improved from existing)
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Key data (store hash, not plaintext)
    key_prefix TEXT NOT NULL, -- First 8 chars for identification (sk_xxxxxxxx)
    key_hash TEXT NOT NULL UNIQUE,

    -- Metadata
    name TEXT NOT NULL,
    description TEXT,

    -- Permissions
    scopes TEXT[] DEFAULT ARRAY['read', 'write', 'execute'],

    -- Usage tracking
    last_used_at TIMESTAMPTZ,
    usage_count INTEGER DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at) WHERE NOT revoked;

-- API Keys
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- Subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Usage
CREATE INDEX IF NOT EXISTS idx_usage_tenant_date ON usage_records(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(date);

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

-- Create system tenant if not exists
INSERT INTO tenants (id, name, slug, tier, created_at, updated_at)
VALUES ('tenant_system', 'System', 'system', 'system', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
```

### 1.2 Migration Checklist

- [ ] Backup existing production database
- [ ] Run migration in transaction
- [ ] Verify all tables created
- [ ] Verify indexes created
- [ ] Verify seed data inserted
- [ ] Test rollback procedure

---

## Phase 2: Core Packages

### 2.1 @substrate/auth

```
packages/auth/
├── src/
│   ├── index.ts              # Exports
│   ├── types.ts              # Type definitions
│   ├── password.ts           # Password hashing (bcrypt)
│   ├── tokens.ts             # Token generation (crypto)
│   ├── sessions.ts           # Session management
│   ├── users.ts              # User CRUD operations
│   ├── api-keys.ts           # API key management
│   ├── oauth.ts              # OAuth providers (future)
│   └── middleware/
│       ├── session.ts        # Session cookie middleware
│       ├── api-key.ts        # API key middleware
│       └── require-auth.ts   # Auth requirement middleware
├── package.json
└── tsconfig.json
```

**Key Functions:**

```typescript
// Password
hashPassword(password: string): Promise<string>
verifyPassword(password: string, hash: string): Promise<boolean>
validatePasswordStrength(password: string): { valid: boolean; errors: string[] }

// Users
createUser(data: CreateUserInput): Promise<User>
getUserById(id: string): Promise<User | null>
getUserByEmail(email: string): Promise<User | null>
updateUser(id: string, data: UpdateUserInput): Promise<User>
deleteUser(id: string): Promise<void>
verifyEmail(token: string): Promise<boolean>
requestPasswordReset(email: string): Promise<void>
resetPassword(token: string, newPassword: string): Promise<boolean>

// Sessions
createSession(userId: string, metadata: SessionMetadata): Promise<Session>
validateSession(token: string): Promise<Session | null>
refreshSession(token: string): Promise<Session>
revokeSession(token: string): Promise<void>
revokeAllUserSessions(userId: string): Promise<number>

// API Keys
createApiKey(tenantId: string, name: string): Promise<{ key: string; apiKey: ApiKey }>
validateApiKey(key: string): Promise<ApiKey | null>
revokeApiKey(id: string): Promise<void>
listApiKeys(tenantId: string): Promise<ApiKey[]>

// Middleware
sessionMiddleware(request: FastifyRequest): Promise<void>
apiKeyMiddleware(request: FastifyRequest): Promise<void>
requireAuth(roles?: string[]): FastifyMiddleware
```

### 2.2 @substrate/billing

```
packages/billing/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── stripe.ts             # Stripe client wrapper
│   ├── customers.ts          # Customer management
│   ├── subscriptions.ts      # Subscription CRUD
│   ├── invoices.ts           # Invoice management
│   ├── webhooks.ts           # Webhook handlers
│   ├── usage.ts              # Usage-based billing
│   └── plans.ts              # Plan management
├── package.json
└── tsconfig.json
```

**Key Functions:**

```typescript
// Customers
createCustomer(tenantId: string, email: string): Promise<string>
getCustomer(tenantId: string): Promise<Stripe.Customer | null>
updateCustomer(tenantId: string, data: UpdateCustomerData): Promise<void>

// Subscriptions
createCheckoutSession(tenantId: string, planId: string, interval: 'month' | 'year'): Promise<string>
createBillingPortalSession(tenantId: string): Promise<string>
getSubscription(tenantId: string): Promise<Subscription | null>
cancelSubscription(tenantId: string, atPeriodEnd: boolean): Promise<void>
reactivateSubscription(tenantId: string): Promise<void>

// Webhooks
handleWebhook(payload: Buffer, signature: string): Promise<void>

// Usage
recordUsage(tenantId: string, type: UsageType, count: number): Promise<void>
getUsage(tenantId: string, startDate: Date, endDate: Date): Promise<UsageRecord[]>
checkQuota(tenantId: string, type: UsageType): Promise<QuotaStatus>
```

### 2.3 @substrate/email

```
packages/email/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── client.ts             # Email provider client
│   ├── queue.ts              # Email queue management
│   ├── sender.ts             # Send from queue
│   └── templates/
│       ├── base.ts           # Base template
│       ├── welcome.ts
│       ├── verify-email.ts
│       ├── password-reset.ts
│       ├── subscription-confirmed.ts
│       ├── subscription-canceled.ts
│       ├── usage-warning.ts
│       ├── trial-ending.ts
│       ├── invoice.ts
│       └── team-invite.ts
├── package.json
└── tsconfig.json
```

**Key Functions:**

```typescript
// Queue
queueEmail(params: QueueEmailParams): Promise<string>
processEmailQueue(batchSize: number): Promise<ProcessResult>

// Direct send (for urgent emails)
sendEmail(params: SendEmailParams): Promise<SendResult>

// Templates
renderTemplate(template: string, variables: Record<string, unknown>): string
getSubject(template: string, variables: Record<string, unknown>): string
```

### 2.4 @substrate/limits

```
packages/limits/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── rate-limiter.ts       # Redis-based rate limiting
│   ├── quota.ts              # Quota checking
│   ├── usage-tracker.ts      # Usage recording
│   └── middleware/
│       ├── rate-limit.ts     # Rate limit middleware
│       └── quota-check.ts    # Quota check middleware
├── package.json
└── tsconfig.json
```

**Key Functions:**

```typescript
// Rate Limiting
checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>
getRateLimitStatus(key: string): Promise<RateLimitStatus>

// Quotas
checkQuota(tenantId: string, type: QuotaType): Promise<QuotaResult>
incrementUsage(tenantId: string, type: QuotaType, amount?: number): Promise<void>
getUsageStats(tenantId: string, date?: Date): Promise<UsageStats>
resetDailyUsage(): Promise<void> // Called by cron

// Middleware
rateLimitMiddleware(options: RateLimitOptions): FastifyMiddleware
quotaMiddleware(type: QuotaType): FastifyMiddleware
```

---

## Phase 3: API Server Updates

### 3.1 New Route Structure

```
apps/api/src/
├── index.ts                  # Main entry point
├── routes/
│   ├── auth.ts               # Authentication endpoints
│   ├── users.ts              # User management
│   ├── tenants.ts            # Tenant management (existing, updated)
│   ├── billing.ts            # Billing endpoints
│   ├── execute.ts            # Shard execution (existing, updated)
│   ├── shards.ts             # Shard management (existing, updated)
│   ├── traces.ts             # Trace ingestion (existing, updated)
│   ├── episodes.ts           # Episode management (existing, updated)
│   ├── facts.ts              # Fact management (existing, updated)
│   ├── contexts.ts           # Working memory (existing, updated)
│   ├── metabolic.ts          # Metabolic cycles (existing)
│   ├── admin.ts              # Admin-only endpoints
│   └── webhooks.ts           # External webhooks
├── middleware/
│   ├── auth.ts               # Auth middleware
│   ├── tenant.ts             # Tenant context (existing, updated)
│   ├── rate-limit.ts         # Rate limiting
│   └── error-handler.ts      # Error handling
└── utils/
    ├── validation.ts         # Input validation (Zod schemas)
    └── responses.ts          # Standardized responses
```

### 3.2 Auth Endpoints

```
POST   /api/v1/auth/register          # Create account
POST   /api/v1/auth/login             # Login
POST   /api/v1/auth/logout            # Logout
POST   /api/v1/auth/refresh           # Refresh session
GET    /api/v1/auth/me                # Get current user
POST   /api/v1/auth/verify-email      # Verify email
POST   /api/v1/auth/resend-verification # Resend verification
POST   /api/v1/auth/forgot-password   # Request password reset
POST   /api/v1/auth/reset-password    # Reset password
POST   /api/v1/auth/change-password   # Change password (authenticated)
```

### 3.3 User Endpoints

```
GET    /api/v1/users/me               # Get current user profile
PATCH  /api/v1/users/me               # Update profile
DELETE /api/v1/users/me               # Delete account
GET    /api/v1/users/me/api-keys      # List API keys
POST   /api/v1/users/me/api-keys      # Create API key
DELETE /api/v1/users/me/api-keys/:id  # Revoke API key
GET    /api/v1/users/me/sessions      # List active sessions
DELETE /api/v1/users/me/sessions/:id  # Revoke session
DELETE /api/v1/users/me/sessions      # Revoke all sessions
```

### 3.4 Billing Endpoints

```
GET    /api/v1/billing/plans          # List available plans
GET    /api/v1/billing/subscription   # Get current subscription
POST   /api/v1/billing/checkout       # Create checkout session
POST   /api/v1/billing/portal         # Create billing portal session
POST   /api/v1/billing/cancel         # Cancel subscription
POST   /api/v1/billing/reactivate     # Reactivate subscription
GET    /api/v1/billing/invoices       # List invoices
GET    /api/v1/billing/usage          # Get usage stats
POST   /api/v1/webhooks/stripe        # Stripe webhook
```

### 3.5 Admin Endpoints

```
# Users
GET    /api/v1/admin/users            # List all users
GET    /api/v1/admin/users/:id        # Get user details
PATCH  /api/v1/admin/users/:id        # Update user
POST   /api/v1/admin/users/:id/suspend # Suspend user
POST   /api/v1/admin/users/:id/unsuspend # Unsuspend user
DELETE /api/v1/admin/users/:id        # Delete user
POST   /api/v1/admin/users/:id/impersonate # Impersonate user

# Tenants
GET    /api/v1/admin/tenants          # List all tenants
GET    /api/v1/admin/tenants/:id      # Get tenant details
PATCH  /api/v1/admin/tenants/:id      # Update tenant
GET    /api/v1/admin/tenants/:id/usage # Get tenant usage

# System
GET    /api/v1/admin/stats            # System statistics
GET    /api/v1/admin/health           # Health check
POST   /api/v1/admin/maintenance      # Toggle maintenance mode
GET    /api/v1/admin/audit-logs       # View audit logs
GET    /api/v1/admin/config           # Get system config
PATCH  /api/v1/admin/config           # Update system config
```

---

## Phase 4: Universal MCP Server

### 4.1 MCP Server Structure

```
apps/mcp-server/
├── src/
│   ├── index.ts              # Main entry point
│   ├── server.ts             # MCP server setup
│   ├── transports/
│   │   ├── sse.ts            # Server-Sent Events transport
│   │   └── websocket.ts      # WebSocket transport
│   ├── auth/
│   │   ├── api-key.ts        # API key validation
│   │   └── connection.ts     # Connection management
│   ├── handlers/
│   │   ├── tools.ts          # Tool handlers
│   │   └── resources.ts      # Resource handlers
│   ├── middleware/
│   │   ├── rate-limit.ts     # MCP-specific rate limiting
│   │   └── usage.ts          # Usage tracking
│   └── tools/
│       ├── execute.ts        # execute_shard
│       ├── search.ts         # search_shards
│       ├── ingest.ts         # ingest_trace
│       ├── episodes.ts       # recall_episodes, record_episode
│       ├── knowledge.ts      # query_knowledge, store_fact
│       ├── working.ts        # Working memory tools
│       └── stats.ts          # get_stats
├── Dockerfile
├── package.json
└── tsconfig.json
```

### 4.2 MCP Server Implementation

```typescript
// apps/mcp-server/src/server.ts

import Fastify from 'fastify';
import { initializePool } from '@substrate/database';
import { validateApiKey } from '@substrate/auth';
import { checkRateLimit, checkQuota } from '@substrate/limits';

const app = Fastify({ logger: true });

// SSE endpoint
app.get('/v1/sse', async (request, reply) => {
  // Extract API key
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return reply.code(401).send({ error: 'API key required' });
  }

  // Validate API key
  const keyData = await validateApiKey(apiKey);
  if (!keyData) {
    return reply.code(401).send({ error: 'Invalid API key' });
  }

  // Check MCP access
  const hasAccess = await checkFeatureAccess(keyData.tenantId, 'mcp_access');
  if (!hasAccess) {
    return reply.code(403).send({ error: 'MCP access not included in your plan' });
  }

  // Check connection limit
  const connections = await getActiveConnections(keyData.tenantId);
  const limit = await getConnectionLimit(keyData.tenantId);
  if (connections >= limit) {
    return reply.code(429).send({ error: 'Connection limit reached' });
  }

  // Create connection record
  const connectionId = await createConnection(keyData.tenantId, keyData.id);

  // Set up SSE
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  // Handle MCP protocol over SSE
  const mcpHandler = createMCPHandler(keyData.tenantId, connectionId);

  // ... SSE message handling
});

// WebSocket endpoint (alternative)
app.register(fastifyWebsocket);
app.get('/v1/ws', { websocket: true }, async (connection, request) => {
  // Similar auth flow
  // Handle MCP protocol over WebSocket
});
```

### 4.3 MCP Tool Implementation Pattern

```typescript
// apps/mcp-server/src/tools/execute.ts

export async function handleExecuteShard(
  tenantId: string,
  args: ExecuteShardArgs
): Promise<MCPToolResult> {
  // Check quota
  const quota = await checkQuota(tenantId, 'executions');
  if (!quota.allowed) {
    return {
      success: false,
      error: `Daily execution limit reached (${quota.used}/${quota.limit})`,
      code: 'QUOTA_EXCEEDED',
    };
  }

  // Check rate limit
  const rateLimit = await checkRateLimit(
    `mcp:${tenantId}`,
    await getMCPRateLimit(tenantId),
    60 // per minute
  );
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Rate limit exceeded. Try again in ${rateLimit.retryAfter}s`,
      code: 'RATE_LIMITED',
    };
  }

  // Call internal API (reuse existing logic)
  const result = await internalAPI.execute(tenantId, args);

  // Track usage
  await incrementUsage(tenantId, 'executions');
  await incrementUsage(tenantId, 'mcp_requests');

  return result;
}
```

---

## Phase 5: Website

### 5.1 Website Structure

```
apps/website/
├── public/
│   ├── index.html            # Landing page
│   ├── pricing.html          # Pricing page
│   ├── demo.html             # Interactive demo
│   ├── docs.html             # Documentation (or link to docs site)
│   ├── login.html            # Login page
│   ├── register.html         # Registration page
│   ├── forgot-password.html  # Password reset request
│   ├── reset-password.html   # Password reset form
│   ├── verify-email.html     # Email verification
│   ├── css/
│   │   ├── styles.css        # Main styles
│   │   └── components.css    # Component styles
│   ├── js/
│   │   ├── app.js            # Main application
│   │   ├── api.js            # API client
│   │   ├── auth.js           # Auth handling
│   │   ├── demo.js           # Demo widget
│   │   └── components/
│   │       ├── navbar.js
│   │       ├── pricing-card.js
│   │       └── demo-widget.js
│   └── images/
│       ├── logo.svg
│       ├── hero-illustration.svg
│       └── ...
├── src/
│   └── server.js             # Static file server
├── Dockerfile
└── package.json
```

### 5.2 Landing Page Sections

1. **Hero**
   - Headline: "AI Memory That Learns & Saves Tokens"
   - Subheadline: "SUBSTRATE crystallizes LLM patterns into reusable procedures, reducing API costs by up to 90%"
   - CTA: "Try Demo" / "Start Free Trial"
   - Hero illustration showing the memory system

2. **How It Works**
   - Step 1: Ingest traces from LLM interactions
   - Step 2: Metabolic cycles crystallize patterns into shards
   - Step 3: Execute shards instead of LLM calls
   - Visual diagram of the pipeline

3. **Live Demo**
   - Interactive widget to test shard execution
   - Shows: Input → Shard Match → Output → Tokens Saved
   - Rate limited (10/hour for anonymous)

4. **Features Grid**
   - Procedural Memory (Shards)
   - Episodic Memory (SAO Chains)
   - Semantic Memory (Truth Store)
   - Working Memory (Context Liquidation)
   - Universal MCP Server
   - Multi-Tenant Isolation

5. **Pricing**
   - Three-tier pricing cards
   - Feature comparison table
   - FAQ section

6. **Testimonials/Social Proof**
   - Placeholder for future testimonials
   - Stats: "X shards executed, Y tokens saved"

7. **CTA Section**
   - "Start Building AI Memory Today"
   - Sign up form or button

8. **Footer**
   - Links: Docs, API, Status, Blog, Contact
   - Legal: Privacy, Terms
   - Social links

### 5.3 Demo Widget

```javascript
// apps/website/public/js/demo.js

class SubstrateDemo {
  constructor(container) {
    this.container = container;
    this.remaining = 10;
    this.render();
  }

  async execute(input) {
    if (this.remaining <= 0) {
      this.showUpgradePrompt();
      return;
    }

    this.setLoading(true);

    try {
      const response = await fetch('/api/v1/demo/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });

      const result = await response.json();
      this.remaining = result.remaining ?? this.remaining - 1;
      this.showResult(result);
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.setLoading(false);
    }
  }

  showResult(result) {
    // Show shard match, output, execution time, tokens saved
  }

  showUpgradePrompt() {
    // Show signup CTA when limit reached
  }
}
```

---

## Phase 6: User Dashboard

### 6.1 Dashboard Structure

```
apps/user-dashboard/
├── public/
│   ├── index.html            # Dashboard shell
│   ├── css/
│   │   ├── dashboard.css
│   │   └── components.css
│   └── js/
│       ├── app.js            # Main application
│       ├── router.js         # Client-side routing
│       ├── api.js            # Authenticated API client
│       ├── state.js          # State management
│       └── pages/
│           ├── overview.js   # Dashboard home
│           ├── shards.js     # Shard management
│           ├── traces.js     # Trace viewer
│           ├── episodes.js   # Episode viewer
│           ├── facts.js      # Fact viewer
│           ├── contexts.js   # Working memory
│           ├── api-keys.js   # API key management
│           ├── mcp.js        # MCP setup instructions
│           ├── settings.js   # Account settings
│           ├── billing.js    # Billing & subscription
│           └── team.js       # Team management (business)
├── src/
│   └── server.js
├── Dockerfile
└── package.json
```

### 6.2 Dashboard Pages

**Overview (Home)**
- Usage meter (executions, API calls, storage)
- Recent activity feed
- Quick stats cards
- Alerts (approaching limits, etc.)

**My Shards**
- List of private shards
- Create new shard (manual)
- Test shard execution
- View shard details
- Promote/demote lifecycle
- Delete shard

**Traces**
- List ingested traces
- Filter by status (pending, synthesized)
- View trace details
- Delete traces

**Episodes**
- List episodes
- Filter by type, success
- View episode chains
- Search episodes

**Facts**
- List facts
- Filter by category, confidence
- Add new fact
- Edit/delete facts

**Working Memory**
- Active contexts
- Session browser
- Liquidation controls

**API Keys**
- List API keys
- Create new key (shows once)
- Revoke keys
- Usage per key

**MCP Setup**
- Connection instructions
- Config examples for different clients
- Test connection
- Active connections list

**Settings**
- Profile (name, email, avatar)
- Password change
- Notification preferences
- Danger zone (delete account)

**Billing**
- Current plan
- Usage this period
- Upgrade/downgrade
- Payment method
- Invoice history

**Team (Business only)**
- Team members list
- Invite member
- Remove member
- Role management

---

## Phase 7: Admin Dashboard

### 7.1 Admin Structure

```
apps/admin-dashboard/
├── public/
│   ├── index.html
│   ├── login.html            # Separate admin login
│   ├── css/
│   │   └── admin.css
│   └── js/
│       ├── app.js
│       ├── router.js
│       ├── api.js
│       └── pages/
│           ├── overview.js   # System overview
│           ├── users.js      # User management
│           ├── tenants.js    # Tenant management
│           ├── shards.js     # All shards
│           ├── subscriptions.js # Subscription management
│           ├── revenue.js    # Revenue analytics
│           ├── logs.js       # Audit logs
│           ├── config.js     # System config
│           └── health.js     # System health
├── src/
│   └── server.js
├── Dockerfile
└── package.json
```

### 7.2 Admin Pages

**System Overview**
- Total users, tenants, subscriptions
- Revenue (MRR, ARR)
- Active MCP connections
- System health indicators
- Recent signups
- Recent errors

**Users**
- Searchable user list
- User details panel
- Suspend/unsuspend
- Password reset
- Impersonate
- Delete user

**Tenants**
- All tenants with usage
- Subscription status
- Manual plan override
- Usage graphs
- Export data

**Shards (Public)**
- All public shards
- Execution stats
- Confidence trends
- Manual promote/demote
- Flag problematic shards

**Subscriptions**
- All subscriptions
- Revenue by plan
- Churn tracking
- Failed payments
- Manual interventions

**Revenue**
- MRR/ARR trends
- Revenue by plan
- Churn rate
- LTV calculations
- Cohort analysis

**Audit Logs**
- Searchable logs
- Filter by action, user, tenant
- Export logs

**System Config**
- Plan limits (editable)
- Feature flags
- Maintenance mode
- Rate limit settings
- Email settings

**Health**
- Database connections
- Redis status
- Worker status
- API latency
- Error rates
- Disk usage

---

## Phase 8: Production Infrastructure

### 8.1 Docker Compose Production

```yaml
# docker-compose.prod.yml

version: '3.8'

name: substrate-prod

services:
  # ===========================================
  # DATABASES
  # ===========================================
  postgres:
    image: pgvector/pgvector:pg17
    container_name: substrate-postgres
    environment:
      POSTGRES_USER: substrate
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: substrate
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U substrate"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal
    deploy:
      resources:
        limits:
          memory: 2G

  redis:
    image: redis:7-alpine
    container_name: substrate-redis
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal
    deploy:
      resources:
        limits:
          memory: 512M

  # ===========================================
  # CORE SERVICES
  # ===========================================
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: substrate-api
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://substrate:${DB_PASSWORD}@postgres:5432/substrate
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      SESSION_SECRET: ${SESSION_SECRET}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}
      RESEND_API_KEY: ${RESEND_API_KEY}
      BASE_URL: https://api.amnesia.tax
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - internal
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 1G
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    container_name: substrate-worker
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://substrate:${DB_PASSWORD}@postgres:5432/substrate
      REDIS_URL: redis://redis:6379
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      RESEND_API_KEY: ${RESEND_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - internal
    restart: unless-stopped

  mcp-server:
    build:
      context: .
      dockerfile: apps/mcp-server/Dockerfile
    container_name: substrate-mcp
    environment:
      NODE_ENV: production
      PORT: 3004
      DATABASE_URL: postgresql://substrate:${DB_PASSWORD}@postgres:5432/substrate
      REDIS_URL: redis://redis:6379
      API_INTERNAL_URL: http://api:3000
    depends_on:
      - api
      - redis
    networks:
      - internal
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 512M
    restart: unless-stopped

  # ===========================================
  # WEB APPLICATIONS
  # ===========================================
  website:
    build:
      context: .
      dockerfile: apps/website/Dockerfile
    container_name: substrate-website
    environment:
      NODE_ENV: production
      PORT: 3002
    networks:
      - internal
    restart: unless-stopped

  user-dashboard:
    build:
      context: .
      dockerfile: apps/user-dashboard/Dockerfile
    container_name: substrate-user-dashboard
    environment:
      NODE_ENV: production
      PORT: 3003
      API_URL: https://api.amnesia.tax
    networks:
      - internal
    restart: unless-stopped

  admin-dashboard:
    build:
      context: .
      dockerfile: apps/admin-dashboard/Dockerfile
    container_name: substrate-admin-dashboard
    environment:
      NODE_ENV: production
      PORT: 3001
      API_URL: https://api.amnesia.tax
    networks:
      - internal
    restart: unless-stopped

  # ===========================================
  # REVERSE PROXY
  # ===========================================
  nginx:
    image: nginx:alpine
    container_name: substrate-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infrastructure/nginx/conf.d:/etc/nginx/conf.d:ro
      - ./infrastructure/ssl:/etc/nginx/ssl:ro
      - ./infrastructure/nginx/logs:/var/log/nginx
    depends_on:
      - api
      - website
      - user-dashboard
      - admin-dashboard
      - mcp-server
    networks:
      - internal
      - external
    restart: unless-stopped

  # ===========================================
  # MONITORING
  # ===========================================
  prometheus:
    image: prom/prometheus:latest
    container_name: substrate-prometheus
    volumes:
      - ./infrastructure/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
    networks:
      - internal
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    container_name: substrate-grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
      GF_SERVER_ROOT_URL: https://metrics.amnesia.tax
    volumes:
      - grafana_data:/var/lib/grafana
      - ./infrastructure/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
      - ./infrastructure/grafana/datasources:/etc/grafana/provisioning/datasources:ro
    networks:
      - internal
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  prometheus_data:
  grafana_data:

networks:
  internal:
    driver: bridge
  external:
    driver: bridge
```

### 8.2 Nginx Configuration

```nginx
# infrastructure/nginx/nginx.conf

user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct=$upstream_connect_time uht=$upstream_header_time urt=$upstream_response_time';

    access_log /var/log/nginx/access.log main;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
    limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/s;
    limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

    # Upstreams
    upstream api {
        least_conn;
        server api:3000;
        keepalive 32;
    }

    upstream mcp {
        least_conn;
        server mcp-server:3004;
        keepalive 32;
    }

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Include site configs
    include /etc/nginx/conf.d/*.conf;
}
```

```nginx
# infrastructure/nginx/conf.d/substrate.conf

# NOTE: Using Cloudflare Tunnel - SSL terminated at Cloudflare
# Redirect HTTP to HTTPS (handled by Cloudflare, but kept for direct access)
server {
    listen 80;
    server_name amnesia.tax www.amnesia.tax api.amnesia.tax app.amnesia.tax admin.amnesia.tax mcp.amnesia.tax;
    return 301 https://$server_name$request_uri;
}

# Main website
server {
    listen 443 ssl http2;
    server_name amnesia.tax www.amnesia.tax;

    # Cloudflare Origin Certificate (or self-signed for tunnel)
    ssl_certificate /etc/nginx/ssl/amnesia.tax.crt;
    ssl_certificate_key /etc/nginx/ssl/amnesia.tax.key;

    location / {
        proxy_pass http://website:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Demo endpoint proxied to API
    location /api/v1/demo {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# API
server {
    listen 443 ssl http2;
    server_name api.amnesia.tax;

    ssl_certificate /etc/nginx/ssl/amnesia.tax.crt;
    ssl_certificate_key /etc/nginx/ssl/amnesia.tax.key;

    # Auth endpoints - stricter rate limit
    location /api/v1/auth {
        limit_req zone=auth_limit burst=10 nodelay;
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Webhook endpoints - no rate limit
    location /api/v1/webhooks {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Stripe-Signature $http_stripe_signature;
    }

    # All other API endpoints
    location / {
        limit_req zone=api_limit burst=50 nodelay;
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# User Dashboard
server {
    listen 443 ssl http2;
    server_name app.amnesia.tax;

    ssl_certificate /etc/nginx/ssl/amnesia.tax.crt;
    ssl_certificate_key /etc/nginx/ssl/amnesia.tax.key;

    location / {
        proxy_pass http://user-dashboard:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Admin Dashboard
server {
    listen 443 ssl http2;
    server_name admin.amnesia.tax;

    ssl_certificate /etc/nginx/ssl/amnesia.tax.crt;
    ssl_certificate_key /etc/nginx/ssl/amnesia.tax.key;

    # IP whitelist for admin (optional)
    # allow 1.2.3.4;
    # deny all;

    location / {
        proxy_pass http://admin-dashboard:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# MCP Server
server {
    listen 443 ssl http2;
    server_name mcp.amnesia.tax;

    ssl_certificate /etc/nginx/ssl/amnesia.tax.crt;
    ssl_certificate_key /etc/nginx/ssl/amnesia.tax.key;

    # SSE endpoint
    location /v1/sse {
        proxy_pass http://mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        chunked_transfer_encoding off;
    }

    # WebSocket endpoint
    location /v1/ws {
        proxy_pass http://mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }
}

# Metrics (internal only)
server {
    listen 443 ssl http2;
    server_name metrics.amnesia.tax;

    ssl_certificate /etc/nginx/ssl/amnesia.tax.crt;
    ssl_certificate_key /etc/nginx/ssl/amnesia.tax.key;

    # Require basic auth or IP whitelist
    auth_basic "Metrics";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://grafana:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

### 8.3 Environment Variables

```bash
# .env.production

# ===========================================
# DATABASE
# ===========================================
DB_PASSWORD=<generate-secure-password-64-chars>

# ===========================================
# SECURITY
# ===========================================
JWT_SECRET=<generate-secure-random-64-chars>
SESSION_SECRET=<generate-secure-random-64-chars>

# ===========================================
# AI PROVIDERS
# ===========================================
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# ===========================================
# STRIPE
# ===========================================
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_INDIVIDUAL_MONTHLY=price_...
STRIPE_PRICE_INDIVIDUAL_YEARLY=price_...
STRIPE_PRICE_BUSINESS_MONTHLY=price_...
STRIPE_PRICE_BUSINESS_YEARLY=price_...

# ===========================================
# EMAIL
# ===========================================
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@amnesia.tax
EMAIL_REPLY_TO=support@amnesia.tax

# ===========================================
# MONITORING
# ===========================================
SENTRY_DSN=https://...@sentry.io/...
GRAFANA_PASSWORD=<secure-password>

# ===========================================
# URLS
# ===========================================
BASE_URL=https://api.amnesia.tax
WEBSITE_URL=https://amnesia.tax
APP_URL=https://app.amnesia.tax
ADMIN_URL=https://admin.amnesia.tax
MCP_URL=https://mcp.amnesia.tax
```

---

## Phase 9: Security Checklist

### 9.1 Authentication Security

- [ ] Password minimum 12 characters
- [ ] Password complexity requirements
- [ ] Bcrypt with cost factor 12
- [ ] Account lockout after 5 failed attempts
- [ ] Email verification required
- [ ] Password reset tokens expire in 1 hour
- [ ] Session tokens are cryptographically random
- [ ] Sessions expire after 7 days of inactivity
- [ ] Ability to revoke all sessions

### 9.2 API Security

- [ ] All endpoints require authentication (except public)
- [ ] API keys are hashed (never stored plaintext)
- [ ] API keys shown only once on creation
- [ ] Rate limiting on all endpoints
- [ ] Request validation with Zod
- [ ] SQL injection prevention (parameterized queries)
- [ ] CORS configured properly
- [ ] No sensitive data in logs

### 9.3 Session Security

- [ ] HTTP-only cookies
- [ ] Secure flag (HTTPS only)
- [ ] SameSite=Lax or Strict
- [ ] CSRF protection
- [ ] Session ID rotation on login

### 9.4 Infrastructure Security

- [ ] HTTPS everywhere (no HTTP)
- [ ] TLS 1.2+ only
- [ ] Strong cipher suites
- [ ] Security headers (HSTS, CSP, X-Frame-Options, etc.)
- [ ] Database not exposed to internet
- [ ] Redis not exposed to internet
- [ ] Secrets in environment variables
- [ ] Regular dependency updates
- [ ] Container security scanning

### 9.5 Data Security

- [ ] Tenant isolation enforced at database level
- [ ] Users can only access their own data
- [ ] Admins have audit trail
- [ ] Data encryption at rest (PostgreSQL)
- [ ] Backups encrypted
- [ ] PII handling compliant

### 9.6 Monitoring & Response

- [ ] Failed login attempt logging
- [ ] Suspicious activity alerts
- [ ] Error tracking (Sentry)
- [ ] Audit log for sensitive actions
- [ ] Incident response plan

---

## Phase 10: Testing Strategy

### 10.1 Unit Tests

```
packages/*/tests/
├── unit/
│   ├── *.test.ts
```

- Test all utility functions
- Test business logic
- Mock external dependencies

### 10.2 Integration Tests

```
tests/integration/
├── auth.test.ts
├── billing.test.ts
├── execute.test.ts
├── mcp.test.ts
```

- Test API endpoints
- Test database operations
- Use test database

### 10.3 E2E Tests

```
tests/e2e/
├── signup-flow.test.ts
├── subscription-flow.test.ts
├── shard-execution.test.ts
├── mcp-connection.test.ts
```

- Test complete user flows
- Use Playwright or Cypress
- Run against staging environment

### 10.4 Load Tests

```
tests/load/
├── api-load.js          # k6 scripts
├── mcp-load.js
```

- Test API under load
- Test MCP server under load
- Establish baseline performance

### 10.5 Security Tests

- OWASP ZAP scan
- Dependency vulnerability scan
- Penetration testing (before launch)

---

## Phase 11: Launch Checklist

### Pre-Launch

- [ ] All tests passing
- [ ] Security audit complete
- [ ] Load testing complete
- [ ] Monitoring configured
- [ ] Alerting configured
- [ ] Backup strategy tested
- [ ] SSL certificates installed
- [ ] DNS configured
- [ ] Stripe products created
- [ ] Email templates tested
- [ ] Documentation complete
- [ ] Privacy policy published
- [ ] Terms of service published
- [ ] Support email configured

### Launch Day

- [ ] Final database migration
- [ ] Deploy all services
- [ ] Verify health checks
- [ ] Test signup flow
- [ ] Test payment flow
- [ ] Test MCP connection
- [ ] Monitor error rates
- [ ] Monitor performance
- [ ] Announce launch

### Post-Launch

- [ ] Monitor user signups
- [ ] Monitor error rates
- [ ] Address issues quickly
- [ ] Gather feedback
- [ ] Plan iteration

---

## Implementation Order

### Sprint 1: Foundation (Week 1-2)
1. Database schema migration
2. @substrate/auth package
3. Auth API endpoints
4. Session management

### Sprint 2: Billing (Week 3)
1. @substrate/billing package
2. Stripe integration
3. Billing API endpoints
4. Webhook handlers

### Sprint 3: Rate Limiting & Email (Week 4)
1. @substrate/limits package
2. @substrate/email package
3. Email templates
4. Usage tracking

### Sprint 4: Website (Week 5)
1. Landing page
2. Pricing page
3. Demo widget
4. Auth pages (login, register, etc.)

### Sprint 5: User Dashboard (Week 6-7)
1. Dashboard shell
2. Overview page
3. Shard management
4. Settings & billing

### Sprint 6: Admin Dashboard (Week 8)
1. Admin auth
2. User management
3. System overview
4. Audit logs

### Sprint 7: MCP Server (Week 9)
1. SSE transport
2. Auth integration
3. Rate limiting
4. All tools

### Sprint 8: Production (Week 10)
1. Infrastructure setup
2. SSL certificates
3. Deployment automation
4. Monitoring setup

### Sprint 9: Testing & Security (Week 11)
1. Complete test suites
2. Security audit
3. Load testing
4. Bug fixes

### Sprint 10: Launch (Week 12)
1. Final review
2. Documentation
3. Launch
4. Monitor & iterate

---

## Success Metrics

### Business Metrics
- Monthly Recurring Revenue (MRR)
- Annual Recurring Revenue (ARR)
- Customer Acquisition Cost (CAC)
- Lifetime Value (LTV)
- Churn Rate
- Net Promoter Score (NPS)

### Product Metrics
- Daily Active Users (DAU)
- Monthly Active Users (MAU)
- Executions per user
- Shards created per user
- MCP connections per user
- Feature adoption rates

### Technical Metrics
- API uptime (target: 99.9%)
- API latency p50, p95, p99
- Error rate (target: <0.1%)
- Database query performance
- MCP connection stability

---

## Support & Operations

### Support Channels
- Email: support@amnesia.tax
- Documentation: docs.amnesia.tax
- Status page: status.amnesia.tax
- Discord/Slack community (future)

### On-Call Rotation
- Define on-call schedule
- Escalation procedures
- Incident response playbooks

### Maintenance Windows
- Weekly maintenance: Sunday 2-4 AM UTC
- Emergency maintenance: As needed with notice
- Database maintenance: Monthly

---

*Document Version: 1.0*
*Created: January 11, 2026*
*Last Updated: January 11, 2026*

---

## Quick Reference

### Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm build                # Build all packages
pnpm dev                  # Start development servers
pnpm test                 # Run tests

# Docker (Development)
docker-compose up -d                    # Start all services
docker-compose logs -f api              # View logs
docker-compose down                     # Stop services

# Docker (Production)
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml logs -f

# Database
pnpm migrate              # Run migrations
pnpm migrate:rollback     # Rollback last migration
docker exec substrate-postgres pg_dump -U substrate substrate > backup.sql

# Deployment
./infrastructure/scripts/deploy.sh      # Deploy to production
./infrastructure/scripts/rollback.sh    # Rollback deployment
```

### Key URLs (Production)

**Domain:** amnesia.tax (via Cloudflare Tunnel)

| Service | URL |
|---------|-----|
| Website | https://amnesia.tax |
| API | https://api.amnesia.tax |
| User Dashboard | https://app.amnesia.tax |
| Admin Dashboard | https://admin.amnesia.tax |
| MCP Server | https://mcp.amnesia.tax |
| Metrics | https://metrics.amnesia.tax |
| Status | https://status.amnesia.tax |
| Docs | https://docs.amnesia.tax |

### Key Contacts

- Technical Lead: [Name]
- Product Lead: [Name]
- DevOps: [Name]
- Support: support@amnesia.tax

---

**This is the master plan. Follow it step by step. No shortcuts.**
