# SUBSTRATE SaaS Production Plan

## Overview

Transform SUBSTRATE from a development system into a production SaaS platform with:
- Public demo website with rate-limited access
- User authentication and dashboards
- Admin management console
- Tiered subscription system (Free, Individual, Business)
- Private shards overlaying public shard system

---

## Current State (Completed)

- [x] Multi-tenant data isolation (owner_id, visibility)
- [x] Public/private shard visibility filtering
- [x] API with tenant context (X-Tenant-ID header)
- [x] Tenant creation with API keys
- [x] Clean public data (sensitive data purged)
- [x] Dashboard with public-only default view
- [x] 4-tier memory system (procedural, episodic, semantic, working)
- [x] Metabolic cycles (crystallize, promote, decay)
- [x] MCP server for Claude Desktop integration

---

## Phase 1: Authentication System

### 1.1 Database Schema Updates

```sql
-- Users table (extends tenants)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN DEFAULT false,
  verification_token TEXT,
  reset_token TEXT,
  reset_token_expires TIMESTAMPTZ,
  role TEXT DEFAULT 'user', -- 'user', 'admin', 'super_admin'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- Sessions table
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

### 1.2 Auth Package (@substrate/auth)

Create `packages/auth/` with:

```
packages/auth/
├── src/
│   ├── index.ts          # Exports
│   ├── password.ts       # Bcrypt hashing
│   ├── tokens.ts         # JWT/session tokens
│   ├── sessions.ts       # Session management
│   ├── users.ts          # User CRUD
│   └── middleware.ts     # Auth middleware for Fastify
├── package.json
└── tsconfig.json
```

**Key functions:**
- `hashPassword(password)` / `verifyPassword(password, hash)`
- `createSession(userId)` / `validateSession(token)` / `revokeSession(token)`
- `createUser({ email, password, tenantId })`
- `verifyEmail(token)` / `requestPasswordReset(email)` / `resetPassword(token, newPassword)`
- `authMiddleware` - Fastify hook to validate session cookies

### 1.3 API Auth Endpoints

Add to `apps/api/src/routes/auth.ts`:

```
POST /api/v1/auth/register     - Create account (creates user + tenant)
POST /api/v1/auth/login        - Login, returns session cookie
POST /api/v1/auth/logout       - Revoke session
POST /api/v1/auth/verify-email - Verify email with token
POST /api/v1/auth/forgot-password - Request reset email
POST /api/v1/auth/reset-password  - Reset with token
GET  /api/v1/auth/me           - Get current user info
```

### 1.4 Session Cookie Strategy

- HTTP-only secure cookies for web sessions
- Bearer tokens for API access (existing system)
- Session expiry: 7 days (configurable)
- Refresh on activity

---

## Phase 2: Subscription & Tier System

### 2.1 Database Schema

```sql
-- Subscription plans
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- 'free', 'individual', 'business'
  display_name TEXT NOT NULL,
  price_monthly INTEGER,        -- cents, NULL for free
  price_yearly INTEGER,
  limits JSONB NOT NULL,        -- { executions_per_day, private_shards, api_requests, etc }
  features JSONB NOT NULL,      -- { mcp_access, priority_support, team_members, etc }
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT DEFAULT 'active', -- 'active', 'cancelled', 'past_due', 'trialing'
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage tracking
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  executions INTEGER DEFAULT 0,
  api_requests INTEGER DEFAULT 0,
  private_shards INTEGER DEFAULT 0,
  tokens_saved INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, period_start)
);
```

### 2.2 Default Plans

```javascript
const PLANS = {
  free: {
    name: 'free',
    display_name: 'Free Trial',
    price_monthly: 0,
    limits: {
      executions_per_day: 50,
      private_shards: 0,
      api_requests_per_day: 100,
      trace_ingestion_per_day: 10,
    },
    features: {
      public_shards: true,
      mcp_access: false,
      api_access: false,
      priority_support: false,
    }
  },
  individual: {
    name: 'individual',
    display_name: 'Individual',
    price_monthly: 1900, // $19/month
    limits: {
      executions_per_day: 1000,
      private_shards: 50,
      api_requests_per_day: 5000,
      trace_ingestion_per_day: 100,
    },
    features: {
      public_shards: true,
      mcp_access: true,
      api_access: true,
      priority_support: false,
    }
  },
  business: {
    name: 'business',
    display_name: 'Business',
    price_monthly: 9900, // $99/month
    limits: {
      executions_per_day: 10000,
      private_shards: 500,
      api_requests_per_day: 50000,
      trace_ingestion_per_day: 1000,
      team_members: 10,
    },
    features: {
      public_shards: true,
      mcp_access: true,
      api_access: true,
      priority_support: true,
      team_management: true,
      custom_integrations: true,
    }
  }
};
```

### 2.3 Rate Limiting Package (@substrate/limits)

```
packages/limits/
├── src/
│   ├── index.ts
│   ├── rate-limiter.ts    # Redis-based rate limiting
│   ├── usage-tracker.ts   # Track usage per tenant
│   ├── quota-checker.ts   # Check if tenant within limits
│   └── middleware.ts      # Fastify rate limit middleware
```

**Key functions:**
- `checkQuota(tenantId, 'executions')` - Returns { allowed: boolean, remaining: number }
- `incrementUsage(tenantId, 'executions', count)`
- `getUsage(tenantId, period)` - Get usage stats
- `rateLimitMiddleware({ key: 'ip' | 'tenant', limit, window })`

---

## Phase 3: Public Demo Website

### 3.1 Website Structure

```
apps/website/
├── public/
│   ├── index.html         # Landing page
│   ├── demo.html          # Interactive demo
│   ├── pricing.html       # Pricing page
│   ├── login.html         # Login page
│   ├── register.html      # Registration page
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── demo.js        # Demo interaction
│       ├── auth.js        # Auth forms
│       └── api.js         # API client
├── src/
│   └── server.js          # Static file server + proxy
├── package.json
└── Dockerfile
```

### 3.2 Landing Page Sections

1. **Hero** - "AI That Learns Your Patterns" + demo CTA
2. **How It Works** - Visual explanation of shard system
3. **Live Demo** - Embedded demo widget (rate-limited)
4. **Pricing** - Three tier cards
5. **Features** - Grid of capabilities
6. **Testimonials** - Social proof (future)
7. **CTA** - Sign up / Start trial

### 3.3 Demo Widget

Interactive demo that:
- Shows example inputs
- Executes against public shards
- Displays shard matching + execution
- Rate limited: 10 requests per IP per hour
- Prompts signup after limit reached

### 3.4 Demo API Endpoint

```
POST /api/v1/demo/execute
- No authentication required
- Rate limited by IP (10/hour)
- Only public shards
- Returns: { output, shardName, executionMs, remaining: 8 }
```

---

## Phase 4: User Dashboard

### 4.1 Dashboard Structure

```
apps/user-dashboard/
├── public/
│   ├── index.html         # Dashboard shell
│   ├── css/
│   │   └── dashboard.css
│   └── js/
│       ├── app.js         # Main app
│       ├── components/    # UI components
│       │   ├── stats.js
│       │   ├── shards.js
│       │   ├── traces.js
│       │   ├── episodes.js
│       │   └── settings.js
│       └── api.js         # Authenticated API client
├── src/
│   └── server.js
├── package.json
└── Dockerfile
```

### 4.2 Dashboard Pages

1. **Overview** - Stats, recent activity, usage meter
2. **My Shards** - Private shards (create, view, test)
3. **Traces** - Ingested traces, synthesis status
4. **Episodes** - Execution history, lessons learned
5. **API Keys** - Manage API keys
6. **Settings** - Account, billing, team (if business)
7. **Upgrade** - Plan comparison, upgrade flow

### 4.3 Key Features

- **Shard Overlay Visualization** - Show public base + private overlay
- **Usage Dashboard** - Real-time usage vs limits
- **Trace Ingestion** - UI to manually add traces
- **Shard Testing** - Test private shards before promotion
- **Export** - Export shards/traces

---

## Phase 5: Admin Dashboard

### 5.1 Admin Structure

```
apps/admin-dashboard/
├── public/
│   ├── index.html
│   ├── css/
│   │   └── admin.css
│   └── js/
│       ├── app.js
│       ├── pages/
│       │   ├── overview.js
│       │   ├── users.js
│       │   ├── tenants.js
│       │   ├── shards.js
│       │   ├── system.js
│       │   └── logs.js
│       └── api.js
├── src/
│   └── server.js
├── package.json
└── Dockerfile
```

### 5.2 Admin Pages

1. **System Overview**
   - Total users, tenants, shards
   - Execution volume charts
   - Revenue metrics
   - System health

2. **Users Management**
   - List all users
   - Search/filter
   - View user details
   - Impersonate (for support)
   - Suspend/ban

3. **Tenants Management**
   - All tenants
   - Usage per tenant
   - Upgrade/downgrade
   - Data export

4. **Shards Management**
   - All public shards
   - Promote/demote
   - View execution stats
   - Manual intervention

5. **System Config**
   - Plan limits
   - Feature flags
   - Maintenance mode
   - Rate limits

6. **Logs & Audit**
   - API request logs
   - Auth events
   - Admin actions
   - Error tracking

### 5.3 Admin Authentication

- Separate admin login (`/admin/login`)
- Role-based: `admin`, `super_admin`
- 2FA required for super_admin
- Audit log all admin actions

---

## Phase 6: Stripe Integration

### 6.1 Package (@substrate/billing)

```
packages/billing/
├── src/
│   ├── index.ts
│   ├── stripe.ts          # Stripe client wrapper
│   ├── customers.ts       # Customer management
│   ├── subscriptions.ts   # Subscription CRUD
│   ├── webhooks.ts        # Webhook handlers
│   └── invoices.ts        # Invoice management
```

### 6.2 Stripe Setup

1. Create Stripe products for each plan
2. Set up webhook endpoint
3. Handle subscription lifecycle:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

### 6.3 Billing API Endpoints

```
POST /api/v1/billing/checkout     - Create Stripe checkout session
POST /api/v1/billing/portal       - Create Stripe billing portal session
GET  /api/v1/billing/subscription - Get current subscription
POST /api/v1/billing/webhook      - Stripe webhook handler
```

---

## Phase 7: Email System

### 7.1 Email Types

1. **Welcome** - After registration
2. **Email Verification** - Verify link
3. **Password Reset** - Reset link
4. **Subscription Confirmation** - After payment
5. **Usage Warning** - Approaching limits
6. **Trial Ending** - 3 days before trial ends

### 7.2 Email Package (@substrate/email)

```
packages/email/
├── src/
│   ├── index.ts
│   ├── client.ts          # SendGrid/Resend client
│   ├── templates/         # Email templates
│   │   ├── welcome.ts
│   │   ├── verify.ts
│   │   ├── reset.ts
│   │   └── ...
│   └── sender.ts          # Queue-based sender
```

### 7.3 Email Provider

Recommend: **Resend** (simple, good DX) or **SendGrid** (enterprise)

---

## Phase 8: Production Infrastructure

### 8.1 Updated Docker Compose

```yaml
services:
  # Databases
  postgres:
    image: pgvector/pgvector:pg17
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: substrate
      POSTGRES_USER: substrate
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U substrate"]

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  # Core Services
  api:
    build: ./apps/api
    environment:
      - DATABASE_URL=postgresql://substrate:${DB_PASSWORD}@postgres:5432/substrate
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  worker:
    build: ./apps/worker
    environment:
      - DATABASE_URL=postgresql://substrate:${DB_PASSWORD}@postgres:5432/substrate
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis

  # Web Applications
  website:
    build: ./apps/website
    ports:
      - "80:3000"

  user-dashboard:
    build: ./apps/user-dashboard

  admin-dashboard:
    build: ./apps/admin-dashboard

  # Infrastructure
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./infrastructure/nginx/ssl:/etc/nginx/ssl
    depends_on:
      - api
      - website
      - user-dashboard
      - admin-dashboard

  # Monitoring
  prometheus:
    image: prom/prometheus
    volumes:
      - ./infrastructure/prometheus:/etc/prometheus

  grafana:
    image: grafana/grafana
    volumes:
      - grafana_data:/var/lib/grafana
```

### 8.2 Nginx Routing

```nginx
# Public website
server {
  server_name substrate.io www.substrate.io;
  location / { proxy_pass http://website:3000; }
  location /api { proxy_pass http://api:3000; }
}

# User dashboard
server {
  server_name app.substrate.io;
  location / { proxy_pass http://user-dashboard:3000; }
  location /api { proxy_pass http://api:3000; }
}

# Admin dashboard
server {
  server_name admin.substrate.io;
  location / { proxy_pass http://admin-dashboard:3000; }
  location /api { proxy_pass http://api:3000; }
}
```

### 8.3 Environment Variables

```bash
# Database
DB_PASSWORD=secure_password_here

# Auth
JWT_SECRET=random_64_char_string
SESSION_SECRET=random_64_char_string

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_INDIVIDUAL=price_xxx
STRIPE_PRICE_BUSINESS=price_xxx

# Email
RESEND_API_KEY=re_xxx
EMAIL_FROM=noreply@substrate.io

# AI
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx

# Monitoring
SENTRY_DSN=https://xxx@sentry.io/xxx
```

---

## Phase 9: Security Hardening

### 9.1 Security Checklist

- [ ] HTTPS everywhere (SSL/TLS)
- [ ] HTTP security headers (HSTS, CSP, etc.)
- [ ] SQL injection prevention (parameterized queries ✓)
- [ ] XSS prevention (output encoding)
- [ ] CSRF protection (tokens)
- [ ] Rate limiting on all endpoints
- [ ] Input validation (Zod schemas ✓)
- [ ] Password hashing (bcrypt, min 12 rounds)
- [ ] Session security (HTTP-only, secure, SameSite)
- [ ] API key hashing (store hashed, show once)
- [ ] Audit logging
- [ ] Dependency scanning (npm audit)
- [ ] Secrets management (env vars, not in code)

### 9.2 Security Headers

```javascript
// Fastify helmet plugin
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
});
```

---

## Phase 10: Monitoring & Observability

### 10.1 Metrics (Prometheus)

- Request rate, latency, errors (RED)
- Shard execution metrics
- Database connection pool
- Redis memory/connections
- User signups, logins
- Subscription conversions

### 10.2 Logging (Structured)

```javascript
logger.info({
  event: 'shard_execution',
  tenantId: 'tenant_xxx',
  shardId: 'shd_xxx',
  success: true,
  executionMs: 12,
  matchMethod: 'intent',
});
```

### 10.3 Error Tracking (Sentry)

- Capture all unhandled errors
- Add user context
- Track performance

### 10.4 Alerting

- API error rate > 1%
- Latency p99 > 500ms
- Database connections exhausted
- Redis memory > 80%
- Failed payments

---

## Implementation Order

### Sprint 1: Auth & Users (Week 1-2)
1. [ ] Auth package (@substrate/auth)
2. [ ] Users database schema
3. [ ] Auth API endpoints
4. [ ] Session management
5. [ ] Basic login/register pages

### Sprint 2: Subscriptions (Week 3)
1. [ ] Plans & subscriptions schema
2. [ ] Limits package (@substrate/limits)
3. [ ] Usage tracking
4. [ ] Rate limiting middleware
5. [ ] Stripe integration

### Sprint 3: Public Website (Week 4)
1. [ ] Landing page design
2. [ ] Demo widget
3. [ ] Demo API endpoint
4. [ ] Pricing page
5. [ ] Signup flow

### Sprint 4: User Dashboard (Week 5-6)
1. [ ] Dashboard shell
2. [ ] Overview page
3. [ ] Shards management
4. [ ] Traces view
5. [ ] Settings & billing

### Sprint 5: Admin Dashboard (Week 7)
1. [ ] Admin auth (roles)
2. [ ] System overview
3. [ ] User management
4. [ ] Tenant management
5. [ ] System config

### Sprint 6: Production (Week 8)
1. [ ] SSL certificates
2. [ ] Nginx configuration
3. [ ] Environment setup
4. [ ] Monitoring & alerts
5. [ ] Security audit
6. [ ] Load testing
7. [ ] Launch!

---

## Files to Create

```
substrate/
├── packages/
│   ├── auth/              # NEW - Authentication
│   ├── limits/            # NEW - Rate limiting & usage
│   ├── billing/           # NEW - Stripe integration
│   └── email/             # NEW - Email sending
├── apps/
│   ├── website/           # NEW - Public marketing site
│   ├── user-dashboard/    # NEW - User dashboard
│   └── admin-dashboard/   # REPLACE - Admin dashboard
└── infrastructure/
    ├── nginx/
    │   └── nginx.conf     # UPDATE - Multi-domain routing
    └── prometheus/
        └── prometheus.yml # NEW - Metrics config
```

---

## Commands Reference

```bash
# Development
pnpm install                    # Install all deps
pnpm run build                  # Build all packages
pnpm run dev                    # Start dev servers

# Database
pnpm run migrate                # Run migrations
pnpm run migrate:create <name>  # Create migration

# Docker
docker-compose up -d            # Start all services
docker-compose logs -f api      # View API logs
docker-compose down             # Stop all services

# Testing
pnpm run test                   # Run all tests
pnpm run test:e2e              # E2E tests
```

---

## Success Metrics

1. **User Acquisition**
   - Demo → Signup conversion: >5%
   - Signup → Paid conversion: >10%

2. **Engagement**
   - Daily active users
   - Executions per user
   - Private shards created

3. **Revenue**
   - MRR growth
   - Churn rate <5%
   - LTV:CAC ratio >3

4. **Technical**
   - API uptime >99.9%
   - p99 latency <200ms
   - Error rate <0.1%

---

*Last updated: January 11, 2026*
*Plan version: 1.0*
