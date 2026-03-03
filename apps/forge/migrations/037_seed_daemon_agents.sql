-- Migration 037: Seed daemon-mode agents with schedule triggers
-- Sets Watchdog and Sentinel to daemon mode with meaningful recurring triggers

-- Set pilot agents to daemon mode
UPDATE forge_agents SET runtime_mode = 'daemon'
WHERE name IN ('Watchdog', 'Sentinel') AND status = 'active';

-- Clean up any test triggers from verification
DELETE FROM forge_agent_triggers WHERE agent_id IN (
  SELECT id FROM forge_agents WHERE name = 'Researcher'
) AND config->>'cron' = '*/5 * * * *';

-- Watchdog: health check every 15 min
INSERT INTO forge_agent_triggers (id, agent_id, trigger_type, config, prompt_template, cooldown_minutes, max_fires_per_hour, priority)
SELECT gen_random_uuid()::text, id, 'schedule',
  '{"cron": "*/15 * * * *"}'::jsonb,
  'Run a system health check. Use docker_api to check container status. Check recent error rates in forge_executions (look for failed executions in the last hour). Report any issues found.',
  14, 4, 10
FROM forge_agents WHERE name = 'Watchdog' AND status = 'active'
ON CONFLICT DO NOTHING;

-- Sentinel: security scan every hour
INSERT INTO forge_agent_triggers (id, agent_id, trigger_type, config, prompt_template, cooldown_minutes, max_fires_per_hour, priority)
SELECT gen_random_uuid()::text, id, 'schedule',
  '{"cron": "0 * * * *"}'::jsonb,
  'Run a periodic security scan. Check for any suspicious patterns in recent executions and audit logs. Review container health and network connectivity.',
  55, 1, 10
FROM forge_agents WHERE name = 'Sentinel' AND status = 'active'
ON CONFLICT DO NOTHING;
