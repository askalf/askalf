-- Add 'brain_question' to agent_tickets source constraint
-- Required by core engine knowledge review and brain question dispatch
ALTER TABLE agent_tickets DROP CONSTRAINT IF EXISTS agent_tickets_source_check;
ALTER TABLE agent_tickets ADD CONSTRAINT agent_tickets_source_check
  CHECK (source = ANY (ARRAY['human','agent','reactive','system','auto_from_finding','autonomy-loop','nl_dispatch','monitoring','brain_question','qa','security','watchdog','scheduler']));

-- Add missing updated_at column to agent_interventions
-- Referenced by stale intervention cleanup in core engine
ALTER TABLE agent_interventions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add missing columns to channel_messages (004c created a simplified version)
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS channel_config_id TEXT;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS external_message_id TEXT;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS external_channel_id TEXT;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS external_user_id TEXT;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'received';
