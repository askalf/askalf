-- Dev Agent Work Tickets — Batch Insert
-- Run: docker exec -i substrate-prod-postgres psql -U substrate -d substrate < scripts/create-dev-tickets.sql

-- Frontend Dev (01KGXGV6R7KD6F3WD0MGASRHYY)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Add file tree viewer with per-file syntax-highlighted diffs to Git Space',
   'The Git Space diff panel currently shows a single unified diff. Add a collapsible file tree sidebar within the diff view that lets users click individual files to see their diff in isolation. Use the existing /git-space/files endpoint data. Highlight additions/deletions in the tree. Keep the full diff view as default, file tree as an enhancement.',
   'Frontend Dev', '01KGXGV6R7KD6F3WD0MGASRHYY', 'Frontend Dev', true, 'open', 'high', 'system', 'human'),

  (gen_random_uuid()::text, 'Add React.lazy code splitting for heavy dashboard pages',
   'OrchestrationHub, FleetMemory, GitSpace, and CodeReview pages are all loaded eagerly. Add React.lazy + Suspense wrappers for these routes to reduce initial bundle size. Add a minimal loading skeleton component. Measure bundle size before/after.',
   'Frontend Dev', '01KGXGV6R7KD6F3WD0MGASRHYY', 'Frontend Dev', true, 'open', 'medium', 'system', 'human'),

  (gen_random_uuid()::text, 'Build real-time notifications toast system for dashboard',
   'Add a toast notification system to the dashboard that displays agent alerts, execution completions, and intervention requests. Use a simple stack in bottom-right corner. Auto-dismiss after 8s. Store last 20 notifications in zustand. Add a notification bell icon in the header with unread count badge.',
   'Frontend Dev', '01KGXGV6R7KD6F3WD0MGASRHYY', 'Frontend Dev', true, 'open', 'medium', 'system', 'human');

-- Backend Dev (01KGXGV6RSSKVXEF8X2S79R3KR)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Add WebSocket support for real-time execution status updates',
   'Replace the SSE polling pattern for execution status with WebSocket connections. Use fastify-websocket in the Forge API. Emit execution status changes (pending→running→completed/failed) and tool call progress. Keep SSE as fallback. Update the dashboard store to prefer WS when available.',
   'Backend Dev', '01KGXGV6RSSKVXEF8X2S79R3KR', 'Backend Dev', true, 'open', 'high', 'system', 'human'),

  (gen_random_uuid()::text, 'Add API rate limiting per API key with configurable tiers',
   'Implement rate limiting on the Forge API using a Redis-backed sliding window. Default: 100 req/min per API key. Add a rate_limit column to forge_api_keys table. Return X-RateLimit-Remaining and X-RateLimit-Reset headers. Return 429 with retry-after when exceeded.',
   'Backend Dev', '01KGXGV6RSSKVXEF8X2S79R3KR', 'Backend Dev', true, 'open', 'medium', 'system', 'human'),

  (gen_random_uuid()::text, 'Add execution cost tracking dashboard endpoint',
   'Create GET /api/v1/forge/analytics/costs that returns daily/weekly/monthly cost breakdowns per agent. Aggregate from forge_executions (input_tokens, output_tokens, cost columns). Include top-5 most expensive agents, cost trend over last 30 days, and projected monthly spend.',
   'Backend Dev', '01KGXGV6RSSKVXEF8X2S79R3KR', 'Backend Dev', true, 'open', 'medium', 'system', 'human');

-- Architect (01KGXGV6QBPG0S0VGRY64T7D1W)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Design webhook/notification system for agent events',
   'Design a notification system that routes agent events (execution complete, intervention needed, finding created, high-severity alert) to configurable destinations: dashboard toasts, email, webhook URL, Slack. Create the schema design, event taxonomy, and routing rules. Write the design doc to /workspace/docs/NOTIFICATIONS.md.',
   'Architect', '01KGXGV6QBPG0S0VGRY64T7D1W', 'Architect', true, 'open', 'high', 'system', 'human'),

  (gen_random_uuid()::text, 'Audit all 20 agent tools for error handling consistency',
   'Review every tool implementation in apps/forge/src/tools/. Check: (1) all tools return structured error responses, (2) timeout handling exists, (3) input validation covers edge cases, (4) no unhandled promise rejections, (5) sensitive data is not leaked in error messages. Create a findings report as a ticket for Backend Dev with specific fixes needed.',
   'Architect', '01KGXGV6QBPG0S0VGRY64T7D1W', 'Architect', true, 'open', 'medium', 'system', 'human');

-- QA Engineer (01KGXGV6S74J5BKEZHDJ8Q672K)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Write integration tests for Git Space merge and deploy flow',
   'Create integration tests covering: (1) branch listing returns correct metadata, (2) diff endpoint returns valid unified diff, (3) merge endpoint creates merge commit and deletes branch, (4) deploy endpoint restarts specified containers, (5) health check returns container status. Test both success and error paths. Use the existing test patterns in the codebase.',
   'QA Engineer', '01KGXGV6S74J5BKEZHDJ8Q672K', 'QA Engineer', true, 'open', 'high', 'system', 'human'),

  (gen_random_uuid()::text, 'Test all agent tools for edge cases and error paths',
   'Systematically test each of the 20 agent tools with: (1) missing required parameters, (2) invalid parameter types, (3) oversized inputs, (4) concurrent execution, (5) timeout scenarios. Document which tools handle errors gracefully vs crash. Create tickets for any tools that need fixes.',
   'QA Engineer', '01KGXGV6S74J5BKEZHDJ8Q672K', 'QA Engineer', true, 'open', 'medium', 'system', 'human');

-- API Tester (01KGXGV6T1N9RJMHF44MFX6WA3)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Load test admin-hub endpoints and identify bottlenecks',
   'Run load tests against key admin-hub endpoints: GET /agents, GET /executions, GET /git-space/branches, GET /interventions. Measure p50/p95/p99 response times at 10, 50, 100 concurrent requests. Identify any endpoints that degrade under load. Report findings with specific recommendations.',
   'API Tester', '01KGXGV6T1N9RJMHF44MFX6WA3', 'API Tester', true, 'open', 'high', 'system', 'human'),

  (gen_random_uuid()::text, 'Validate all Forge API response schemas and document discrepancies',
   'Call every Forge API endpoint and validate the response shape matches what the dashboard expects. Check: (1) all documented fields are present, (2) types match (string vs number vs null), (3) pagination responses are consistent, (4) error responses follow a standard format. Document any discrepancies found.',
   'API Tester', '01KGXGV6T1N9RJMHF44MFX6WA3', 'API Tester', true, 'open', 'medium', 'system', 'human');

-- DevOps (01KGXGV6SKXJKJMF3K4HQSQ8VB)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Set up automated backup verification script',
   'Create a script that runs daily to verify database backups are valid. Check: (1) backup files exist in /backups/daily/, (2) most recent backup is < 25 hours old, (3) backup file size is reasonable (not empty, not truncated), (4) pg_restore --list succeeds on the backup. Report failures via agent_findings with severity=critical.',
   'DevOps', '01KGXGV6SKXJKJMF3K4HQSQ8VB', 'DevOps', true, 'open', 'high', 'system', 'human'),

  (gen_random_uuid()::text, 'Add Prometheus-compatible metrics endpoint for container monitoring',
   'Add GET /metrics endpoint to the API server that exports Prometheus-format metrics: container count, execution counts by status, agent schedule health, database connection pool stats, Redis memory usage, request latency histograms. Use prom-client library.',
   'DevOps', '01KGXGV6SKXJKJMF3K4HQSQ8VB', 'DevOps', true, 'open', 'medium', 'system', 'human');

-- Herald (01KGXG4SV2ZQH936ZQVJ81JP9M)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Build daily fleet summary report generator',
   'Create a daily summary report that aggregates: (1) total executions (completed/failed/cost), (2) tickets resolved vs created, (3) findings by severity, (4) top agent performers, (5) any agents with >50% failure rate, (6) total API token spend. Store the report as a finding with type=report. Schedule to run at 00:00 UTC daily.',
   'Herald', '01KGXG4SV2ZQH936ZQVJ81JP9M', 'Herald', true, 'open', 'high', 'system', 'human');

-- Forge Smith (01KGXG4SS55GBA5SRZBVV8E1NR)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Audit and optimize Forge database queries',
   'Analyze forge database performance: (1) Enable pg_stat_statements and identify top 10 slowest queries, (2) Check for missing indexes on forge_executions (agent_id+status, created_at), forge_tool_executions, forge_sessions, (3) Look for N+1 query patterns in routes, (4) Create any missing indexes. Report findings.',
   'Forge Smith', '01KGXG4SS55GBA5SRZBVV8E1NR', 'Forge Smith', true, 'open', 'high', 'system', 'human');

-- Librarian (01KGXG4SSG50D7HRJ811F6XZ3X)
INSERT INTO agent_tickets (id, title, description, assigned_to, agent_id, agent_name, is_agent_ticket, status, priority, created_by, source)
VALUES
  (gen_random_uuid()::text, 'Index and catalog all agent-generated findings and documentation',
   'Query all agent_findings and categorize them by: type (security, performance, bug, improvement), severity, affected service, resolution status. Build a summary index showing coverage gaps — which services have no findings, which have stale findings (>7 days unresolved). Store the catalog as a semantic memory entry for other agents to reference.',
   'Librarian', '01KGXG4SSG50D7HRJ811F6XZ3X', 'Librarian', true, 'open', 'medium', 'system', 'human');
