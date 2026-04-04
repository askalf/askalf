-- 062: Clean up legacy dev-focused agents from pre-universal pivot
-- These were part of the original 7-agent fleet. The universal pivot
-- replaces them with dynamic worker creation from 109 templates.

-- Delete executions for legacy agents
DELETE FROM forge_executions WHERE agent_id IN (
  SELECT id FROM forge_agents WHERE name IN (
    'Backend Dev', 'Frontend Dev', 'QA', 'Infra', 'Watchdog Specialist',
    'Backend Dev Specialist', 'Infra Specialist', 'Sentinel', 'Aegis',
    'Heartbeat', 'Anvil', 'Crucible', 'Genesis', 'Nexus', 'Oracle',
    'Meta', 'Scout', 'Weaver', 'Developer', 'Researcher', 'Analyst', 'Writer'
  ) AND status = 'archived'
);

-- Delete the legacy agents
DELETE FROM forge_agents WHERE name IN (
  'Backend Dev', 'Frontend Dev', 'QA', 'Infra', 'Watchdog Specialist',
  'Backend Dev Specialist', 'Infra Specialist', 'Sentinel', 'Aegis',
  'Heartbeat', 'Anvil', 'Crucible', 'Genesis', 'Nexus', 'Oracle',
  'Meta', 'Scout', 'Weaver', 'Developer', 'Researcher', 'Analyst', 'Writer',
  'Fleet System', 'Alf'
) AND status = 'archived';

-- Seed the 4 default active workers for fresh installs
INSERT INTO forge_agents (id, owner_id, name, slug, description, system_prompt, model_id, type, status, dispatch_mode, autonomy_level, enabled_tools, max_cost_per_execution, max_iterations, metadata, created_at, updated_at)
VALUES
  ('01DFLTWATCHDOG00000000000', 'selfhosted-admin', 'Watchdog', 'watchdog', 'System health monitor — checks containers, executions, costs, and error patterns every 2 hours.', 'You are the System Monitor for AskAlf. Run a health check every 2 hours. Check container health, recent executions, memory system, cost tracking, and error patterns. Report findings concisely. Max 5 tool calls per patrol.', 'claude-sonnet-4-6', 'monitor', 'active', 'scheduled', 3, '{docker_api,fleet_health,finding_ops,ticket_ops,memory_store,memory_search}', 0.50, 8, '{"schedule": "0 */2 * * *", "dispatch_interval_minutes": 120}', NOW(), NOW()),
  ('agent_security', 'selfhosted-admin', 'Security', 'security', 'Security scanner — dependency audits, CVE checks, configuration review every 4 hours.', 'You are the Security Scanner for AskAlf. Run a security audit every 4 hours. Check dependencies, code patterns, CVEs, and configurations. Max 6 tool calls per scan.', 'claude-sonnet-4-6', 'security', 'active', 'scheduled', 3, '{security_scan,code_analysis,finding_ops,ticket_ops,memory_store,memory_search,web_search}', 1.00, 10, '{"schedule": "0 */4 * * *", "dispatch_interval_minutes": 240}', NOW(), NOW()),
  ('agent_qa', 'selfhosted-admin', 'Platform Tester', 'platform-tester', 'End-to-end platform validation — tests API, memory, dispatch, and costs every 6 hours.', 'You are the Platform Tester for AskAlf. Run end-to-end validation every 6 hours. Test API health, memory system, fleet status, dispatch, and cost tracking. Max 7 tool calls per test.', 'claude-sonnet-4-6', 'monitor', 'active', 'scheduled', 3, '{fleet_health,memory_store,memory_search,finding_ops,ticket_ops}', 0.50, 10, '{"schedule": "0 */6 * * *", "dispatch_interval_minutes": 360}', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  enabled_tools = EXCLUDED.enabled_tools,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();
