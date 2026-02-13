INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, source, metadata) VALUES

-- BACKEND DEV: Real code fixes
('seed_bd_001', 'Implement web_search tool integration with Brave Search API',
 'The web_search tool at apps/forge/src/tools/built-in/web-search.ts is a complete stub (line 54 has TODO). Implement actual web search using the Brave Search API (or Serper as fallback). The BRAVE_SEARCH_KEY or SERPER_API_KEY env vars should be checked. Return structured results with title, url, snippet. This unblocks agents from doing real research. Reference the existing tool structure in other built-in tools like code-analysis.ts for patterns.',
 'open', 'high', 'feature', 'system', 'Backend Dev', 'human',
 '{"phase": "overnight", "files": ["apps/forge/src/tools/built-in/web-search.ts"]}'::jsonb),

('seed_bd_002', 'Add resolution column to agent_tickets table and update ticket_ops tool',
 'Agents keep failing when trying to resolve tickets with a resolution note because the agent_tickets table has no resolution column. The ticket_ops tool tries to set resolution but it goes into metadata jsonb instead. Add a proper TEXT resolution column via migration (028_ticket_resolution.sql) and update the ticket_ops tool handler to use it. This is a recurring pain point visible in agent_findings errors.',
 'open', 'urgent', 'database', 'system', 'Backend Dev', 'human',
 '{"phase": "overnight", "files": ["packages/database/src/migrations/", "apps/forge/src/tools/built-in/"]}'::jsonb),

-- DEVOPS: Infrastructure hardening
('seed_do_001', 'Add rate limiting to Forge SSE streaming endpoints',
 'The Forge SSE endpoints (used for execution streaming) have no per-connection rate limiting. An abusive client could open many SSE connections and exhaust server resources. Check apps/forge/src/routes/ for SSE endpoints and add connection limits (max 5 per IP, max 50 total). Reference the rate limiting pattern already in apps/dashboard/src/server.js.',
 'open', 'medium', 'security', 'system', 'DevOps', 'human',
 '{"phase": "overnight", "files": ["apps/forge/src/routes/"]}'::jsonb),

('seed_do_002', 'Audit and harden Dockerfile security for all services',
 'Review all Dockerfiles in apps/*/Dockerfile for security best practices: (1) Verify non-root user is used consistently, (2) Check that no secrets are baked in, (3) Verify .dockerignore excludes .env files, (4) Check for pinned base image versions vs floating tags, (5) Verify multi-stage builds do not leak build deps. Report findings via finding_ops. Do NOT make changes to Dockerfiles directly.',
 'open', 'medium', 'security', 'system', 'DevOps', 'human',
 '{"phase": "overnight", "files": ["apps/api/Dockerfile", "apps/forge/Dockerfile", "apps/dashboard/Dockerfile", "apps/self/Dockerfile", "apps/mcp/Dockerfile"]}'::jsonb),

-- NIGHTWATCH: Security sweep
('seed_nw_001', 'Full security audit: npm audit + env leak check + secret scanning',
 'Run a comprehensive security sweep: (1) security_scan action=npm_audit on all packages, (2) security_scan action=env_leak_check to scan for hardcoded secrets in codebase, (3) Check all .env.example files for leaked real values, (4) Scan git history for any committed secrets using shell_exec. Report all findings with severity levels. This is a routine overnight sweep.',
 'open', 'high', 'security', 'system', 'Nightwatch', 'human',
 '{"phase": "overnight"}'::jsonb),

-- QA ENGINEER: Testing
('seed_qa_001', 'Test all dashboard admin API endpoints for auth bypass and error handling',
 'Systematically test every /api/v1/admin/* endpoint on the dashboard (app.askalf.org) for: (1) Auth bypass - call without session cookie, verify 401, (2) Invalid params - send garbage IDs, verify 404 not 500, (3) Missing required fields - verify 400 with useful error, (4) SQL injection - try basic payloads in search/filter params. Use api_call tool. Document all findings.',
 'open', 'high', 'testing', 'system', 'QA Engineer', 'human',
 '{"phase": "overnight"}'::jsonb),

-- DATA ENGINEER: Database optimization
('seed_de_001', 'Analyze slow queries and recommend index optimizations',
 'Use substrate_db_query to analyze database performance: (1) Query pg_stat_user_tables for sequential scans on large tables, (2) Check pg_stat_user_indexes for unused indexes, (3) Run EXPLAIN ANALYZE on the most common queries (agent_tickets lookups, agent_findings filters, shard_executions joins), (4) Check table bloat with pgstattuple estimates, (5) Check for missing indexes on foreign keys. Create a detailed finding with specific CREATE INDEX recommendations.',
 'open', 'medium', 'optimization', 'system', 'Data Engineer', 'human',
 '{"phase": "overnight"}'::jsonb),

-- ARCHITECT: Code quality review
('seed_ar_001', 'Architecture review: identify tight coupling and circular dependencies',
 'Analyze the substrate monorepo architecture: (1) Use code_analysis action=import_analysis on each app to map inter-package dependencies, (2) Check for circular imports between packages, (3) Identify modules with high complexity scores (code_analysis action=complexity), (4) Check if apps are properly isolated or leaking implementation details, (5) Review the shared packages (database, auth) for proper abstraction boundaries. Create a detailed architecture findings report.',
 'open', 'medium', 'architecture', 'system', 'Architect', 'human',
 '{"phase": "overnight", "files": ["apps/", "packages/"]}'::jsonb),

-- SENTINEL: Fleet monitoring
('seed_sn_001', 'Generate comprehensive fleet health baseline report',
 'Create a baseline health report for the entire agent fleet: (1) Query execution stats per agent over last 24h - success rate, avg cost, avg tokens, avg duration, (2) Identify agents with highest failure rates, (3) Calculate total fleet cost for the last 24h, (4) Check which agents have stale schedules (last_run_at > 3 hours ago), (5) Verify all continuous agents are being restarted properly. Store results as an info finding. This becomes the overnight monitoring baseline.',
 'open', 'medium', 'monitoring', 'system', 'Sentinel', 'human',
 '{"phase": "overnight"}'::jsonb),

-- FRONTEND DEV: Dashboard improvements
('seed_fd_001', 'Add ticket resolution display to dashboard ticket detail view',
 'The dashboard ticket detail view does not display ticket resolution notes. Check the React dashboard source at apps/dashboard/public/app/ for the ticket components. The resolution is currently stored in metadata.resolution jsonb field on agent_tickets. Update the ticket detail component to show the resolution when a ticket is resolved. Also show the updated_at timestamp as resolved-at when status=resolved.',
 'open', 'medium', 'frontend', 'system', 'Frontend Dev', 'human',
 '{"phase": "overnight", "files": ["apps/dashboard/public/app/"]}'::jsonb),

-- LIBRARIAN: Knowledge quality
('seed_lib_001', 'Audit knowledge_facts table for stale, duplicate, and low-confidence entries',
 'Comprehensive knowledge quality audit: (1) substrate_db_query to find knowledge_facts with confidence < 0.5, (2) Find facts with identical or near-identical subjects, (3) Find facts older than 30 days that have never been updated, (4) Check for facts that contradict each other (same subject, conflicting predicates), (5) Count facts by category to identify gaps. Report findings with specific cleanup recommendations.',
 'open', 'medium', 'data_quality', 'system', 'Librarian', 'human',
 '{"phase": "overnight"}'::jsonb),

-- DOC WRITER: Documentation
('seed_dw_001', 'Document all Forge tool capabilities and usage patterns',
 'Create comprehensive documentation for all 15 built-in Forge tools: api_call, code_exec, web_browse, shell_exec, file_ops, db_query, docker_api, substrate_db_query, ticket_ops, finding_ops, intervention_ops, git_ops, deploy_ops, security_scan, code_analysis. For each tool: (1) Read the implementation in apps/forge/src/tools/built-in/, (2) Document all actions/parameters, (3) Include usage examples, (4) Note any limitations or gotchas. Write to a markdown file at docs/forge-tools.md.',
 'open', 'medium', 'documentation', 'system', 'Doc Writer', 'human',
 '{"phase": "overnight", "files": ["apps/forge/src/tools/built-in/"]}' ::jsonb),

-- HERALD: Status report
('seed_hr_001', 'Generate overnight fleet activity report template',
 'Create a comprehensive fleet activity report covering: (1) Total executions in last 24h by agent, (2) Ticket throughput - created vs resolved vs still open, (3) Cost summary - total spend, top 3 costliest agents, (4) Notable findings by severity, (5) Intervention response times, (6) Scheduler health - any missed ticks or errors. Query substrate_db_query for all data. Store as an info finding with the full report.',
 'open', 'medium', 'monitoring', 'system', 'Herald', 'human',
 '{"phase": "overnight"}'::jsonb),

-- OVERSEER: Coordination
('seed_ov_001', 'Review and triage all stale tickets older than 12 hours',
 'Audit the full ticket backlog: (1) Find all open/in_progress tickets older than 12 hours, (2) Check if assigned agents are actually scheduled and active, (3) Reassign orphaned tickets if the assigned agent is paused or decommissioned, (4) Escalate any urgent tickets that have been stale >6h, (5) Close duplicate tickets (same title/description from different agents). Report a summary finding of actions taken.',
 'open', 'high', 'coordination', 'system', 'Overseer', 'human',
 '{"phase": "overnight"}'::jsonb)

ON CONFLICT (id) DO NOTHING
RETURNING id, assigned_to, priority, title;
