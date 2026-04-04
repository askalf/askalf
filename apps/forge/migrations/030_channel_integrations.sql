-- 030_channel_integrations.sql
-- Channel integrations: API, Webhooks, Slack, Discord, Telegram, WhatsApp

-- Channel configurations (per-user channel setup)
CREATE TABLE IF NOT EXISTS channel_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('api', 'webhooks', 'slack', 'discord', 'telegram', 'whatsapp')),
  name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}',  -- encrypted tokens stored here
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active config per channel type per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_configs_user_type
  ON channel_configs (user_id, channel_type) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_channel_configs_tenant ON channel_configs (tenant_id);

-- Channel messages (maps inbound messages to executions for reply routing)
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channel_config_id TEXT NOT NULL REFERENCES channel_configs(id) ON DELETE CASCADE,
  execution_id TEXT,
  channel_type TEXT NOT NULL,
  external_message_id TEXT,
  external_channel_id TEXT,
  external_user_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')) DEFAULT 'inbound',
  content TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'dispatched', 'replied', 'failed')) DEFAULT 'received',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_execution ON channel_messages (execution_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_config ON channel_messages (channel_config_id);

-- Webhook deliveries (outbound webhook delivery tracking with retry)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  channel_config_id TEXT NOT NULL REFERENCES channel_configs(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'execution.completed',
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')) DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON webhook_deliveries (next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_config ON webhook_deliveries (channel_config_id);
