-- Vision-aligned seed tickets for overnight autonomous work
INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, agent_name, is_agent_ticket, source, created_at) VALUES

-- Architect: Design the agent code review pipeline
('VISION-001', 'Design agent code review pipeline (ADR)',
'Design a PR-like workflow where agents can propose code changes, have them reviewed by other agents, and merge approved changes. Write an Architecture Decision Record (ADR) covering: 1) How agents propose changes (prompt revisions already exist in forge_prompt_revisions table), 2) Review workflow: propose -> review -> approve/reject, 3) Which agents review which types of changes, 4) How approved changes get applied. Store the ADR in the knowledge graph and create follow-up tickets for implementation.',
'open', 'high', 'architecture', 'Architect', 'Architect', true, 'agent', NOW()),

-- Frontend Dev: Build knowledge graph dashboard page
('VISION-002', 'Build knowledge graph visualization page',
'Build a new dashboard page that visualizes the knowledge graph. The forge DB has 423+ nodes in forge_knowledge_nodes (entity_type, label, description, mention_count) and 533+ edges in forge_knowledge_edges. Create: 1) A new React page component in apps/dashboard/client/src/pages/, 2) Add navigation link in the sidebar, 3) Show nodes grouped by entity_type with edge connections, 4) Show top nodes by mention_count, 5) Filter by entity_type and agent_id. Check existing forge admin routes for knowledge graph endpoints first. Make it visually impressive.',
'open', 'high', 'frontend', 'Frontend Dev', 'Frontend Dev', true, 'agent', NOW()),

-- Backend Dev: Add knowledge graph proxy routes to dashboard
('VISION-003', 'Add knowledge graph API proxy routes to dashboard',
'The dashboard is missing proxy routes for the knowledge graph API. Add routes to apps/dashboard/src/routes/admin-hub/proxy.js: GET /api/v1/admin/knowledge/graph -> callForgeAdmin(''/knowledge/graph''), GET /api/v1/admin/knowledge/nodes -> callForgeAdmin(''/knowledge/nodes''), GET /api/v1/admin/knowledge/search -> callForgeAdmin(''/knowledge/search''). First verify these endpoints exist in forge by checking apps/forge/src/routes/platform-admin/. Use callForgeAdmin (not callForge) since these are admin routes.',
'open', 'high', 'backend', 'Backend Dev', 'Backend Dev', true, 'agent', NOW()),

-- QA Engineer: Write integration tests
('VISION-004', 'Write integration test suite for forge API endpoints',
'Create an integration test suite for the forge API. Steps: 1) Create test directory if needed (apps/forge/tests/), 2) Write tests for critical endpoints: GET /api/v1/admin/agents, GET /api/v1/admin/executions, GET /api/v1/admin/monitoring/health, GET /api/v1/admin/cost/dashboard, GET /api/v1/admin/fleet/leaderboard, 3) Test that responses have correct shape and status codes, 4) Use fetch to hit the running forge container at http://forge:3005. Store test patterns in the knowledge graph.',
'open', 'high', 'testing', 'QA Engineer', 'QA Engineer', true, 'agent', NOW()),

-- Nexus: Design agent collaboration protocol
('VISION-005', 'Design cross-agent collaboration protocol',
'Design how agents collaborate on complex tasks. Define: 1) Task handoff protocol, 2) Use agent_call for synchronous delegation, ticket_ops for async queuing, 3) Define ticket conventions with assignee specialization tags, 4) Build a coordination chain: Architect designs -> Backend Dev builds -> QA tests -> DevOps deploys. Store the protocol in the knowledge graph and create implementation tickets.',
'open', 'high', 'coordination', 'Nexus', 'Nexus', true, 'agent', NOW()),

-- Oracle: Build value-per-dollar analysis
('VISION-006', 'Build agent value-per-dollar analysis system',
'Analyze fleet productivity and build value-per-dollar ranking. Using db_query: 1) Query forge_executions for cost, iterations per agent, 2) Query agent_tickets for tickets resolved per agent, 3) Query forge_knowledge_nodes for knowledge contributions, 4) Calculate value score = (tickets_resolved * 10 + knowledge_nodes * 5 + memories * 2) / total_cost. Store findings and recommend budget adjustments.',
'open', 'medium', 'analysis', 'Oracle', 'Oracle', true, 'agent', NOW()),

-- Genesis: Write daily system journal
('VISION-007', 'Write the first daily system journal entry',
'Write the first daily journal for Orcastr8r — the system reflecting on itself. Using memory_search and db_query: 1) Summarize activity: executions, tickets, knowledge nodes, 2) Highlight milestones: 16 agents, 100% success rate, growing knowledge graph, 3) Identify what improved and what needs work, 4) Reflect on being a self-building system, 5) Store as memory with key system-journal-2026-02-21. This becomes a daily Genesis practice.',
'open', 'medium', 'reflection', 'Genesis', 'Genesis', true, 'agent', NOW()),

-- Weaver: Build knowledge graph connections
('VISION-008', 'Synthesize knowledge graph — connect islands',
'Analyze the knowledge graph for disconnected components and build bridges. 1) Find nodes that should be connected but are not, 2) Find agents with related findings that have not shared knowledge, 3) Create new edges connecting related concepts, 4) Identify top 10 most important nodes and ensure they are well-connected. The graph should be dense and interconnected, not isolated islands.',
'open', 'medium', 'knowledge', 'Weaver', 'Weaver', true, 'agent', NOW()),

-- Crucible: Experiment with execution optimization
('VISION-009', 'Run prompt effectiveness experiment',
'Design and run an A/B experiment on agent prompts. Hypothesis: Agents with specific per-cycle goals produce more value than those with general instructions. 1) Analyze last 10 executions per agent, 2) Score output quality — actionable vs observational, 3) Calculate tokens-per-useful-action ratio, 4) Propose prompt improvements for 3 lowest-performing agents via prompt revisions. Store experiment results in knowledge graph.',
'open', 'medium', 'evolution', 'Crucible', 'Crucible', true, 'agent', NOW()),

-- Anvil: Build something new
('VISION-010', 'Build agent execution timeline component',
'Build a visual timeline showing agent executions over 24 hours. 1) Create backend endpoint returning executions with started_at, completed_at, agent_id, cost, status, 2) Create frontend React component with color-coded bars (opus=purple, sonnet=blue, haiku=green), 3) Width proportional to duration, 4) Click for execution details. This becomes the heartbeat visualization of the platform.',
'open', 'high', 'builder', 'Anvil', 'Anvil', true, 'agent', NOW()),

-- Scout: Research best practices
('VISION-011', 'Research autonomous agent orchestration patterns',
'Research how other autonomous agent systems work. Use web_search to find: 1) Multi-agent orchestration frameworks (CrewAI, AutoGen, LangGraph), 2) How they handle agent coordination and task decomposition, 3) Best practices for agent memory and knowledge sharing, 4) Cost optimization strategies for LLM-based agents. Summarize findings in the knowledge graph with actionable recommendations for Orcastr8r.',
'open', 'medium', 'research', 'Scout', 'Scout', true, 'agent', NOW()),

-- DevOps: Improve deployment pipeline
('VISION-012', 'Add automated health checks after deployments',
'Improve the deployment pipeline with post-deploy health verification. 1) After any service rebuild, automatically hit its health endpoint, 2) If health check fails, alert via finding_ops, 3) Add a deployment log to the forge DB tracking build timestamps and results, 4) Check that all containers are healthy after any restart. This is the foundation for agents being able to safely deploy their own code.',
'open', 'medium', 'infrastructure', 'DevOps', 'DevOps', true, 'agent', NOW()),

-- Aegis: Security hardening
('VISION-013', 'Audit agent MCP tool permissions',
'Audit the security of agent MCP tool access. 1) Check which agents have access to which tools, 2) Verify that haiku-tier agents (Heartbeat, Aegis, DevOps) cannot execute destructive operations, 3) Check that shell_exec and file_ops have proper sandboxing, 4) Verify intervention_ops is required for dangerous actions. Report findings and fix any permission gaps.',
'open', 'medium', 'security', 'Aegis', 'Aegis', true, 'agent', NOW()),

-- Doc Writer: Document the system
('VISION-014', 'Write comprehensive system architecture documentation',
'Document the Orcastr8r system architecture. 1) Read all source files in apps/forge/src/ to understand the codebase, 2) Document the execution pipeline: scheduler -> worker -> CLI -> MCP tools, 3) Document the knowledge graph system, 4) Document the cost optimization system, 5) Write it as a markdown file in docs/architecture.md. This documentation helps new agents (and humans) understand how everything fits together.',
'open', 'medium', 'documentation', 'Doc Writer', 'Doc Writer', true, 'agent', NOW()),

-- Meta: Architecture review
('VISION-015', 'Review system architecture for evolution readiness',
'Analyze the current architecture and identify what needs to change for full autonomous evolution. 1) Can agents safely deploy code changes? What is missing? 2) Is the knowledge graph being used effectively for decision-making? 3) Are agent prompts leading to real code output or just monitoring? 4) What is the biggest bottleneck preventing the system from building itself faster? Store findings as an ADR in the knowledge graph.',
'open', 'medium', 'architecture', 'Meta', 'Meta', true, 'agent', NOW())

ON CONFLICT (id) DO NOTHING;
