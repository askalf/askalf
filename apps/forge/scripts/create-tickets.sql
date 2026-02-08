-- Build tickets for the agent fleet - comprehensive build plan
-- Phase 1: Validation, monitoring, design
-- Phase 2: Core feature implementation
-- Phase 3: Polish and advanced features

-- ARCHITECT - System design and coordination
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-ARCH-001', 'Design Agent-to-Agent Communication Protocol', E'Design the protocol for agents to hand off tasks to each other. Define message format, routing rules, and the handoff table schema. This enables the parent_task_id and handoff_to_agent_id fields the Tasks page expects.', 'open', 'high', 'feature', 'system', 'Architect', '01KGXGV6QBPG0S0VGRY64T7D1W', 'Architect', false, 'human', '{"build_phase": 1}'),
('TKT-ARCH-002', 'Design Findings and Insights System', E'Design how agents report findings (the agent_findings table is created). Define: when agents should create findings, severity classification rules, deduplication strategy. This powers the Reports > Findings tab.', 'open', 'high', 'feature', 'system', 'Architect', '01KGXGV6QBPG0S0VGRY64T7D1W', 'Architect', false, 'human', '{"build_phase": 1}'),
('TKT-ARCH-003', 'Design Intervention Request System', E'Design how agents create intervention requests when they need human approval. Define trigger conditions, intervention types (approval, clarification, escalation), and how responses flow back to the agent.', 'open', 'high', 'feature', 'system', 'Architect', '01KGXGV6QBPG0S0VGRY64T7D1W', 'Architect', false, 'human', '{"build_phase": 1}');

-- BACKEND DEV - API and server-side implementation
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-BACK-001', 'Implement Agent Findings Creation API', E'Add POST /api/v1/forge/findings endpoint to Forge. Agents call this to report findings. Fields: agent_id, finding (text), severity (info/warning/critical), category, execution_id. Store in substrate DB via admin-hub proxy or direct route.', 'open', 'high', 'feature', 'system', 'Backend Dev', '01KGXGV6RSSKVXEF8X2S79R3KR', 'Backend Dev', false, 'human', '{"build_phase": 2}'),
('TKT-BACK-002', 'Implement Intervention Creation from Agents', E'Add mechanism for agents to create interventions. When an agent tool execution hits a threshold (cost, risk level, destructive action), automatically create an agent_interventions record. The engine should pause and wait for human response.', 'open', 'high', 'feature', 'system', 'Backend Dev', '01KGXGV6RSSKVXEF8X2S79R3KR', 'Backend Dev', false, 'human', '{"build_phase": 2}'),
('TKT-BACK-003', 'Implement Task Handoff Mechanism', E'Add ability for one agent execution to spawn child executions for other agents. Add parent_execution_id to execution metadata. The Forge POST /executions should accept parent_execution_id and handoff_to_agent_id fields.', 'open', 'medium', 'feature', 'system', 'Backend Dev', '01KGXGV6RSSKVXEF8X2S79R3KR', 'Backend Dev', false, 'human', '{"build_phase": 2}'),
('TKT-BACK-004', 'Add Execution Logging to Engine', E'Modify the ReAct engine to store iteration details in execution metadata. Each iteration should log: thinking, tool_calls made, tool results, response. This data powers the task detail logs view.', 'open', 'high', 'feature', 'system', 'Backend Dev', '01KGXGV6RSSKVXEF8X2S79R3KR', 'Backend Dev', false, 'human', '{"build_phase": 2}');

-- FRONTEND DEV - UI improvements
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-FRONT-001', 'Add Real-Time Execution Status to Agent Cards', E'Agent cards show idle/running but need real-time progress. Add a progress indicator showing current iteration count, tokens used so far, and elapsed time for running agents. Poll the task detail endpoint.', 'open', 'medium', 'improvement', 'system', 'Frontend Dev', '01KGXGV6R7KD6F3WD0MGASRHYY', 'Frontend Dev', false, 'human', '{"build_phase": 2}'),
('TKT-FRONT-002', 'Implement Agent System Prompt Editor', E'The create agent modal has a system_prompt textarea but editing existing agent system prompts is not possible. Add an edit mode to the agent detail modal that allows updating name, description, and system_prompt via PATCH.', 'open', 'medium', 'feature', 'system', 'Frontend Dev', '01KGXGV6R7KD6F3WD0MGASRHYY', 'Frontend Dev', false, 'human', '{"build_phase": 2}'),
('TKT-FRONT-003', 'Add Agent Tool Configuration UI', E'Agents have tools assigned but there is no UI to view or change tool assignments. Add a Tools section to the agent detail modal showing assigned tools with toggles to enable/disable.', 'open', 'medium', 'feature', 'system', 'Frontend Dev', '01KGXGV6R7KD6F3WD0MGASRHYY', 'Frontend Dev', false, 'human', '{"build_phase": 3}');

-- QA ENGINEER - Testing
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-QA-001', 'Validate All 27 Admin Hub Endpoints', E'Systematically test every admin hub endpoint. For each: verify auth required, verify response shape matches frontend expectations, test error cases. Report any mismatches as new tickets.', 'open', 'high', 'task', 'system', 'QA Engineer', '01KGXGV6S74J5BKEZHDJ8Q672K', 'QA Engineer', false, 'human', '{"build_phase": 1}'),
('TKT-QA-002', 'Test Agent Execution Pipeline End-to-End', E'Test the full execution flow: create agent, run agent, verify execution created, verify engine runs, verify tool calls work, verify completion stored. Test with each tool type.', 'open', 'high', 'task', 'system', 'QA Engineer', '01KGXGV6S74J5BKEZHDJ8Q672K', 'QA Engineer', false, 'human', '{"build_phase": 1}'),
('TKT-QA-003', 'Test Ticket CRUD Operations', E'Test create, read, update, delete tickets via the API. Verify filters (status, source, assigned_to) work correctly. Verify pagination returns correct totalPages, hasNext, hasPrev.', 'open', 'medium', 'task', 'system', 'QA Engineer', '01KGXGV6S74J5BKEZHDJ8Q672K', 'QA Engineer', false, 'human', '{"build_phase": 1}');

-- DEVOPS - Infrastructure
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-OPS-001', 'Monitor Container Health and Resource Usage', E'Set up continuous monitoring of all Docker containers. Track CPU, memory, disk usage. Create findings for any container using >80% memory or >90% CPU. Report container restart events.', 'open', 'high', 'task', 'system', 'DevOps', '01KGXGV6SKXJKJMF3K4HQSQ8VB', 'DevOps', false, 'human', '{"build_phase": 1}'),
('TKT-OPS-002', 'Optimize Forge Container Performance', E'Profile the Forge container - check memory usage, connection pool stats, Node.js heap. Ensure the container can handle multiple concurrent agent executions without OOM. Recommend resource limits.', 'open', 'medium', 'task', 'system', 'DevOps', '01KGXGV6SKXJKJMF3K4HQSQ8VB', 'DevOps', false, 'human', '{"build_phase": 2}');

-- API TESTER - Endpoint validation
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-API-001', 'Continuous API Health Monitoring', E'Continuously test critical API endpoints: health checks, auth flows, agent CRUD, execution creation. Report any failures as urgent tickets. Test from within Docker network.', 'open', 'high', 'task', 'system', 'API Tester', '01KGXGV6T1N9RJMHF44MFX6WA3', 'API Tester', false, 'human', '{"build_phase": 1}'),
('TKT-API-002', 'Test Admin Hub API Response Shapes', E'Validate every admin hub endpoint returns the exact shape the frontend expects. Check: pagination object presence, field names, data types. Report discrepancies as new tickets.', 'open', 'high', 'task', 'system', 'API Tester', '01KGXGV6T1N9RJMHF44MFX6WA3', 'API Tester', false, 'human', '{"build_phase": 1}');

-- DATA ENGINEER - Database optimization
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-DATA-001', 'Optimize Forge Database Queries', E'Analyze slow queries in both forge and substrate databases. Check index usage, suggest missing indexes, review EXPLAIN plans for the most common queries. Focus on executions table which will grow fast.', 'open', 'medium', 'task', 'system', 'Data Engineer', '01KGXGV6TD7REMT407ZV7QTSB6', 'Data Engineer', false, 'human', '{"build_phase": 2}'),
('TKT-DATA-002', 'Build Execution Analytics Aggregations', E'Create materialized views or summary queries for: executions per day, avg duration by agent, token usage trends, cost by agent. These feed the Reports metrics page.', 'open', 'medium', 'feature', 'system', 'Data Engineer', '01KGXGV6TD7REMT407ZV7QTSB6', 'Data Engineer', false, 'human', '{"build_phase": 2}');

-- DOC WRITER - Documentation
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-DOC-001', 'Document Agent Hub API Endpoints', E'Write comprehensive API documentation for all 27 admin hub endpoints. Include: URL, method, auth requirements, request body schema, response schema, example requests and responses.', 'open', 'medium', 'task', 'system', 'Doc Writer', '01KGXGV6TY5VJ7GAK9JW1T79SZ', 'Doc Writer', false, 'human', '{"build_phase": 2}'),
('TKT-DOC-002', 'Document Agent Fleet Architecture', E'Write architecture documentation covering: agent types, tool assignments, execution pipeline, scheduler system, intervention flow, findings system. Include diagrams.', 'open', 'medium', 'task', 'system', 'Doc Writer', '01KGXGV6TY5VJ7GAK9JW1T79SZ', 'Doc Writer', false, 'human', '{"build_phase": 2}');

-- SENTINEL - System monitoring
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-SENT-001', 'Monitor Agent Fleet Health', E'Continuously monitor all agent executions. Track: success/failure rates, execution durations, token costs. Alert (create findings) when any agent has >50% failure rate or costs exceed budget.', 'open', 'high', 'task', 'system', 'Sentinel', '01KGXG4SNRAAGWE0F4Z44NXB5S', 'Sentinel', false, 'human', '{"build_phase": 1}');

-- OVERSEER - Fleet coordination
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-OVER-001', 'Coordinate Build Phase Execution', E'Oversee the entire build operation. Phase 1 tickets must complete before Phase 2 starts. Monitor ticket progress, update statuses, create new tickets for discovered work. Ensure all agents are productive.', 'open', 'urgent', 'task', 'system', 'Overseer', '01KGXG4SVERD6E8BHKVMK6JTBY', 'Overseer', false, 'human', '{"build_phase": 1}');

-- QUARTERMASTER - Database maintenance
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-QM-001', 'Monitor Database Health and Growth', E'Track table sizes, index bloat, connection pool usage across both forge and substrate databases. Run VACUUM ANALYZE periodically. Report any concerning growth patterns as findings.', 'open', 'medium', 'task', 'system', 'Quartermaster', '01KGXG4STMCPSY1F60ZX5TBZFX', 'Quartermaster', false, 'human', '{"build_phase": 1}');

-- NIGHTWATCH - Security monitoring
INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata) VALUES
('TKT-NW-001', 'Security Audit of Agent Tool Permissions', E'Audit all agent tool assignments. Verify: no agent has unnecessary high-risk tools, blocked command patterns are comprehensive, SQL injection prevention is solid. Report vulnerabilities as critical findings.', 'open', 'high', 'task', 'system', 'Nightwatch', '01KGXG4SRNPS9XT49VR1N8FSMB', 'Nightwatch', false, 'human', '{"build_phase": 1}');
