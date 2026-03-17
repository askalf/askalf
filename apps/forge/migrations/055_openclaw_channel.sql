-- Add OpenClaw as a supported channel type
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_configs_channel_type_check') THEN
    ALTER TABLE channel_configs DROP CONSTRAINT channel_configs_channel_type_check;
  END IF;
  ALTER TABLE channel_configs ADD CONSTRAINT channel_configs_channel_type_check
    CHECK (channel_type IN (
      'api', 'webhooks', 'slack', 'discord', 'telegram', 'whatsapp',
      'teams', 'zapier', 'n8n', 'make', 'email', 'twilio', 'sendgrid',
      'twilio_voice', 'zoom', 'openclaw'
    ));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
