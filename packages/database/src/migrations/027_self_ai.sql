-- SELF AI: Core Schema
-- One AI per user, always-on, learns you, connects to everything

-- ============================================
-- SELF INSTANCES — One per user
-- ============================================

CREATE TABLE IF NOT EXISTS self_instances (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL UNIQUE,
    tenant_id           TEXT NOT NULL,

    -- Identity
    name                VARCHAR(100) DEFAULT 'SELF' NOT NULL,
    persona             JSONB DEFAULT '{}' NOT NULL,

    -- Autonomy (1=ask everything, 3=balanced, 5=fully autonomous)
    autonomy_level      INTEGER DEFAULT 3 NOT NULL CHECK (autonomy_level BETWEEN 1 AND 5),

    -- Budget
    daily_budget_usd    NUMERIC(10,4) DEFAULT 1.0000 NOT NULL,
    monthly_budget_usd  NUMERIC(10,4) DEFAULT 20.0000 NOT NULL,
    daily_spent_usd     NUMERIC(10,4) DEFAULT 0.0000 NOT NULL,
    monthly_spent_usd   NUMERIC(10,4) DEFAULT 0.0000 NOT NULL,

    -- State
    status              VARCHAR(20) DEFAULT 'initializing' NOT NULL
                        CHECK (status IN ('initializing', 'active', 'paused', 'sleeping', 'error')),

    -- Heartbeat
    last_heartbeat      TIMESTAMPTZ,
    heartbeat_interval_ms INTEGER DEFAULT 300000 NOT NULL,

    -- Link to forge agent
    forge_agent_id      TEXT,

    -- Stats
    actions_taken       INTEGER DEFAULT 0 NOT NULL,
    approvals_requested INTEGER DEFAULT 0 NOT NULL,
    conversations       INTEGER DEFAULT 0 NOT NULL,
    total_cost_usd      NUMERIC(10,4) DEFAULT 0.0000 NOT NULL,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_self_instances_user ON self_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_self_instances_tenant ON self_instances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_self_instances_status ON self_instances(status) WHERE status = 'active';

-- ============================================
-- SELF ACTIVITIES — Everything SELF does
-- ============================================

CREATE TABLE IF NOT EXISTS self_activities (
    id                  TEXT PRIMARY KEY,
    self_id             TEXT NOT NULL REFERENCES self_instances(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL,

    type                VARCHAR(30) NOT NULL
                        CHECK (type IN (
                            'action', 'observation', 'decision', 'approval_request',
                            'approval_response', 'thought', 'memory', 'error',
                            'chat', 'integration', 'system'
                        )),
    title               TEXT NOT NULL,
    body                TEXT,
    metadata            JSONB DEFAULT '{}' NOT NULL,

    -- References
    execution_id        TEXT,
    integration_id      TEXT,
    approval_id         TEXT,
    parent_id           TEXT REFERENCES self_activities(id),

    -- Display
    visible_to_user     BOOLEAN DEFAULT true NOT NULL,
    importance          INTEGER DEFAULT 5 NOT NULL CHECK (importance BETWEEN 1 AND 10),

    -- Cost
    cost_usd            NUMERIC(10,6) DEFAULT 0 NOT NULL,
    tokens_used         INTEGER DEFAULT 0 NOT NULL,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_self_activities_feed ON self_activities(self_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_activities_type ON self_activities(self_id, type);
CREATE INDEX IF NOT EXISTS idx_self_activities_user ON self_activities(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_activities_importance ON self_activities(self_id, importance DESC)
    WHERE visible_to_user = true;

-- ============================================
-- SELF INTEGRATIONS — Connected services
-- ============================================

CREATE TABLE IF NOT EXISTS self_integrations (
    id                  TEXT PRIMARY KEY,
    self_id             TEXT NOT NULL REFERENCES self_instances(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL,

    -- Service
    provider            VARCHAR(100) NOT NULL,
    display_name        VARCHAR(255) NOT NULL,
    icon_url            TEXT,

    -- MCP
    mcp_server_id       TEXT,
    transport_type      VARCHAR(20) DEFAULT 'http' CHECK (transport_type IN ('stdio', 'sse', 'http')),
    connection_config   JSONB DEFAULT '{}' NOT NULL,

    -- Auth
    auth_type           VARCHAR(20) DEFAULT 'oauth2' NOT NULL
                        CHECK (auth_type IN ('oauth2', 'api_key', 'basic', 'none')),
    credentials         JSONB DEFAULT '{}' NOT NULL,

    -- Status
    status              VARCHAR(20) DEFAULT 'pending' NOT NULL
                        CHECK (status IN ('pending', 'connecting', 'connected', 'error', 'disconnected', 'revoked')),

    -- Polling
    poll_interval_ms    INTEGER,
    next_poll_at        TIMESTAMPTZ,
    last_sync           TIMESTAMPTZ,

    -- Permissions
    allowed_actions     TEXT[] DEFAULT '{}',
    blocked_actions     TEXT[] DEFAULT '{}',

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT unique_self_provider UNIQUE (self_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_self_integrations_self ON self_integrations(self_id);
CREATE INDEX IF NOT EXISTS idx_self_integrations_poll ON self_integrations(next_poll_at)
    WHERE status = 'connected' AND poll_interval_ms IS NOT NULL;

-- ============================================
-- SELF APPROVALS — Human-in-the-loop
-- ============================================

CREATE TABLE IF NOT EXISTS self_approvals (
    id                  TEXT PRIMARY KEY,
    self_id             TEXT NOT NULL REFERENCES self_instances(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL,

    type                VARCHAR(30) NOT NULL
                        CHECK (type IN ('action', 'budget', 'integration', 'data_access', 'confirmation', 'input')),
    title               TEXT NOT NULL,
    description         TEXT,
    context             JSONB DEFAULT '{}' NOT NULL,
    proposed_action     JSONB DEFAULT '{}' NOT NULL,
    estimated_cost      NUMERIC(10,6) DEFAULT 0 NOT NULL,

    status              VARCHAR(20) DEFAULT 'pending' NOT NULL
                        CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'auto_approved')),
    response            JSONB,
    responded_at        TIMESTAMPTZ,

    timeout_at          TIMESTAMPTZ,
    urgency             VARCHAR(10) DEFAULT 'normal' NOT NULL
                        CHECK (urgency IN ('low', 'normal', 'high', 'critical')),

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_self_approvals_pending ON self_approvals(self_id, status)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_self_approvals_user ON self_approvals(user_id, created_at DESC);

-- ============================================
-- SELF SCHEDULES — Recurring proactive tasks
-- ============================================

CREATE TABLE IF NOT EXISTS self_schedules (
    id                  TEXT PRIMARY KEY,
    self_id             TEXT NOT NULL REFERENCES self_instances(id) ON DELETE CASCADE,

    name                VARCHAR(255) NOT NULL,
    action_type         VARCHAR(100) NOT NULL,
    action_config       JSONB DEFAULT '{}' NOT NULL,

    cron_expression     VARCHAR(100),
    interval_ms         INTEGER,

    next_run_at         TIMESTAMPTZ,
    last_run_at         TIMESTAMPTZ,
    enabled             BOOLEAN DEFAULT true NOT NULL,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_self_schedules_next ON self_schedules(next_run_at)
    WHERE enabled = true;

-- ============================================
-- SELF CONVERSATIONS + MESSAGES
-- ============================================

CREATE TABLE IF NOT EXISTS self_conversations (
    id                  TEXT PRIMARY KEY,
    self_id             TEXT NOT NULL REFERENCES self_instances(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL,

    title               TEXT,
    forge_session_id    TEXT NOT NULL,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_self_conversations_self ON self_conversations(self_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_conversations_user ON self_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS self_messages (
    id                  TEXT PRIMARY KEY,
    conversation_id     TEXT NOT NULL REFERENCES self_conversations(id) ON DELETE CASCADE,

    role                VARCHAR(10) NOT NULL CHECK (role IN ('user', 'self', 'system')),
    content             TEXT NOT NULL,
    actions_taken       JSONB DEFAULT '[]' NOT NULL,

    tokens_used         INTEGER DEFAULT 0 NOT NULL,
    cost_usd            NUMERIC(10,6) DEFAULT 0 NOT NULL,

    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_self_messages_conversation ON self_messages(conversation_id, created_at ASC);
