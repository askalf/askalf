-- 044_expand_channel_types.sql
-- Expand channel_configs to support all 15 channel types
-- Previously only allowed: api, webhooks, slack, discord, telegram, whatsapp
-- Now adds: teams, zapier, n8n, make, email, twilio, sendgrid, twilio_voice, zoom

-- Drop the old constraint and add the expanded one
ALTER TABLE channel_configs DROP CONSTRAINT IF EXISTS channel_configs_channel_type_check;
ALTER TABLE channel_configs ADD CONSTRAINT channel_configs_channel_type_check
  CHECK (channel_type IN (
    'api', 'webhooks', 'slack', 'discord', 'telegram', 'whatsapp',
    'teams', 'zapier', 'n8n', 'make', 'email', 'twilio', 'sendgrid', 'twilio_voice', 'zoom'
  ));

-- Also expand the unique index to allow multiple configs per user per type
-- (e.g. user might have multiple Slack workspaces)
-- Keep the original constraint as-is since it only enforces one active per type
