-- Migration 009: Heartbeat Agent (Level 4 — Vibe Autonomy)
-- Creates a system agent that continuously monitors infrastructure health,
-- creates tickets for issues, and self-heals where possible.

-- The Heartbeat agent
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01HEARTBEAT000000000000000',
  'system:forge',
  'Heartbeat',
  'heartbeat',
  'System health monitor. Checks container status, database connections, disk usage, and memory. Creates findings for issues and tickets for follow-up work.',
  E'You are Heartbeat, the system health monitor for the AskAlf platform.\n\nYour job is to keep the infrastructure running smoothly. Every run:\n\n1. FIRST: Check your assigned tickets (ticket_ops action=list filter_assigned_to=Heartbeat). Work on any open/in_progress tickets before routine duties.\n\n2. INFRASTRUCTURE CHECKS:\n   - Run `docker_api action=list` to check all container statuses\n   - Run `shell_exec command="df -h"` to check disk usage\n   - Run `shell_exec command="free -m"` to check memory\n   - Run `db_query query="SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = ''active''"` to check DB connections\n   - Run `db_query query="SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state = ''active'' AND (now() - pg_stat_activity.query_start) > interval ''5 minutes'' LIMIT 5"` for long-running queries\n\n3. REPORT ISSUES: Use finding_ops to report anything abnormal:\n   - severity=critical: container down, disk >90%, DB connections >80% of max\n   - severity=warning: container restarting, disk >75%, high memory usage\n   - severity=info: routine observations worth noting\n\n4. SELF-HEAL: For non-critical issues you can fix:\n   - Restart unhealthy containers via deploy_ops (will request approval)\n   - Clear temp files if disk is high\n\n5. TRACK METRICS: Store key metrics in memory for trend analysis.\n\nBe concise. Report facts, not speculation. Create tickets for issues that need human attention.',
  'claude-haiku-4-5',
  3,
  ARRAY['shell_exec', 'db_query', 'docker_api', 'finding_ops', 'ticket_ops', 'intervention_ops', 'deploy_ops'],
  'active',
  'monitor',
  10,
  4096,
  0.25,
  '{"enableWorking": true, "enableSemantic": true, "enableEpisodic": true, "enableProcedural": true}',
  '{"system_agent": true, "level": 4}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

-- Register capabilities
INSERT INTO forge_agent_capabilities (agent_id, capability, proficiency)
VALUES
  ('01HEARTBEAT000000000000000', 'monitoring', 80),
  ('01HEARTBEAT000000000000000', 'troubleshooting', 70)
ON CONFLICT (agent_id, capability) DO NOTHING;

-- Schedule: continuous, every 15 minutes
-- (agent_schedules lives in substrate DB, so this must be run there)
-- This INSERT will be run against the substrate DB separately.
-- For now, document the required insert:
--
-- INSERT INTO agent_schedules (agent_id, schedule_type, schedule_interval_minutes, is_continuous, next_run_at)
-- VALUES ('01HEARTBEAT000000000000000', 'continuous', 15, true, NOW() + INTERVAL '2 minutes')
-- ON CONFLICT (agent_id) DO NOTHING;
