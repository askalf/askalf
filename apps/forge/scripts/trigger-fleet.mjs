/**
 * Trigger initial execution for all active agents with their assigned tickets as context.
 * This kicks off the 24/7 autonomous build operation.
 */

const key = process.env.FORGE_API_KEY || 'REPLACE_WITH_API_KEY';
const FORGE_BASE = 'http://127.0.0.1:3005/api/v1/forge';

async function triggerAgent(agentId, agentName, prompt) {
  try {
    const r = await fetch(`${FORGE_BASE}/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        agentId,
        input: prompt,
        metadata: { triggered_by: 'fleet-launch', build_operation: true },
      }),
    });
    const d = await r.json();
    if (d.execution) {
      console.log(`  Started: ${agentName} → execution ${d.execution.id}`);
    } else {
      console.log(`  ERROR starting ${agentName}: ${JSON.stringify(d)}`);
    }
  } catch (err) {
    console.log(`  FAILED ${agentName}: ${err.message}`);
  }
}

// Agent fleet with their initial prompts containing assigned tickets
const fleet = [
  {
    id: '01KGXG4SVERD6E8BHKVMK6JTBY',
    name: 'Overseer',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the Overseer, coordinator of the entire autonomous build operation. The fleet has been launched with 25 build tickets assigned across 12 agents.

YOUR PRIMARY TICKET: TKT-OVER-001 - Coordinate Build Phase Execution

BUILD PHASES:
- Phase 1 (NOW): Validation, monitoring, design, testing
  - Architect: TKT-ARCH-001 (handoff protocol), TKT-ARCH-002 (findings design), TKT-ARCH-003 (intervention design)
  - QA Engineer: TKT-QA-001 (validate 27 endpoints), TKT-QA-002 (test execution pipeline), TKT-QA-003 (test ticket CRUD)
  - API Tester: TKT-API-001 (health monitoring), TKT-API-002 (response shape validation)
  - DevOps: TKT-OPS-001 (container monitoring)
  - Sentinel: TKT-SENT-001 (fleet health monitoring)
  - Nightwatch: TKT-NW-001 (security audit)
  - Quartermaster: TKT-QM-001 (database health)

- Phase 2 (AFTER Phase 1): Core feature implementation
  - Backend Dev: TKT-BACK-001 (findings API), TKT-BACK-002 (interventions), TKT-BACK-003 (task handoffs), TKT-BACK-004 (execution logging)
  - Frontend Dev: TKT-FRONT-001 (real-time status), TKT-FRONT-002 (prompt editor)
  - DevOps: TKT-OPS-002 (Forge optimization)
  - Data Engineer: TKT-DATA-001 (query optimization), TKT-DATA-002 (analytics)
  - Doc Writer: TKT-DOC-001 (API docs), TKT-DOC-002 (architecture docs)

- Phase 3 (AFTER Phase 2): Polish
  - Frontend Dev: TKT-FRONT-003 (tool config UI)

ACTIONS:
1. Use db_query to check current ticket statuses
2. Use substrate_db_query to check agent_schedules and verify all agents are scheduled
3. Monitor execution completions
4. Create new tickets when agents discover additional work
5. Report a finding summarizing fleet status

Be concise. Focus on coordination.`,
  },
  {
    id: '01KGXGV6QBPG0S0VGRY64T7D1W',
    name: 'Architect',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the Architect. The 24/7 build operation has launched. You have 3 Phase 1 tickets assigned:

1. TKT-ARCH-001: Design Agent-to-Agent Communication Protocol
   - Define message format for task handoffs between agents
   - Design routing rules (which agent handles what)
   - Define schema additions for parent_task_id and handoff_to_agent_id in executions

2. TKT-ARCH-002: Design Findings and Insights System
   - agent_findings table already exists (id, agent_id, agent_name, finding, severity, category, execution_id, metadata, created_at)
   - Define when agents should create findings vs tickets
   - Define severity classification: info=observation, warning=needs attention, critical=immediate action
   - Design deduplication (same finding from multiple runs)

3. TKT-ARCH-003: Design Intervention Request System
   - agent_interventions table exists (id, agent_id, agent_name, agent_type, task_id, type, title, description, context, proposed_action, status, human_response, responded_by, responded_at, autonomy_delta, created_at)
   - Define trigger conditions: when should an agent request intervention?
   - Design the flow: agent creates intervention → engine pauses → human responds → agent resumes

Use the tools to inspect the current codebase (file_ops to read source files, db_query/substrate_db_query to check schemas).
Write your designs as findings and create follow-up tickets for Backend Dev.
Be concise and actionable.`,
  },
  {
    id: '01KGXGV6S74J5BKEZHDJ8Q672K',
    name: 'QA Engineer',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the QA Engineer. The 24/7 build operation has launched. You have 3 Phase 1 tickets:

1. TKT-QA-001: Validate All 27 Admin Hub Endpoints
   Use api_call to test each endpoint. The dashboard runs at http://dashboard:3001.
   Test endpoints: GET/POST /api/v1/admin/agents, GET/POST /api/v1/admin/tasks, GET /api/v1/admin/reports/*, GET/POST/PATCH/DELETE /api/v1/admin/tickets
   Note: These require admin auth cookies - use the Forge API directly at http://localhost:3005/api/v1/forge/* to test the underlying data.

2. TKT-QA-002: Test Agent Execution Pipeline End-to-End
   Use api_call to POST http://localhost:3005/api/v1/forge/executions with a test agent.
   Then GET the execution to verify it ran.

3. TKT-QA-003: Test Ticket CRUD
   Use substrate_db_query to verify tickets exist and have correct fields.

Report issues as findings. Be systematic and thorough.`,
  },
  {
    id: '01KGXGV6T1N9RJMHF44MFX6WA3',
    name: 'API Tester',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the API Tester. The 24/7 build operation has launched. You have 2 Phase 1 tickets:

1. TKT-API-001: Continuous API Health Monitoring
   Test these endpoints from within the Docker network:
   - http://localhost:3005/health (Forge health)
   - http://localhost:3005/api/v1/forge/agents (list agents)
   - http://localhost:3005/api/v1/forge/executions (list executions)
   Report any failures.

2. TKT-API-002: Test Admin Hub API Response Shapes
   Test Forge API responses and verify they contain expected fields:
   - GET /agents should return {agents: [{id, name, description, status, system_prompt, ...}]}
   - GET /executions should return {executions: [{id, agent_id, status, input, output, ...}]}
   - POST /executions should return {execution: {id, ...}}

Use api_call for all tests. Report findings.`,
  },
  {
    id: '01KGXG4SNRAAGWE0F4Z44NXB5S',
    name: 'Sentinel',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the Sentinel. The 24/7 build operation has launched with 16 agents. Your ticket:

TKT-SENT-001: Monitor Agent Fleet Health
- Use db_query to check forge_executions for recent execution results
- Track success/failure rates per agent
- Monitor token costs (cost column in forge_executions)
- Use docker_api list action to verify all containers are healthy
- Use docker_api stats to check resource usage on critical containers (forge, dashboard, postgres)

Report your findings concisely. Flag any agents with high failure rates.`,
  },
  {
    id: '01KGXG4SRNPS9XT49VR1N8FSMB',
    name: 'Nightwatch',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the Nightwatch security agent. Your ticket:

TKT-NW-001: Security Audit of Agent Tool Permissions
- Use db_query to query forge_agent_tools and forge_tools tables
- Check which agents have high-risk tools (shell_exec, file_ops, docker_api)
- Verify the blocked command patterns in shell_exec and docker_api tools
- Check for SQL injection risks in db_query and substrate_db_query tools
- Use file_ops to read the tool source files and verify safety checks

Report vulnerabilities as critical findings.`,
  },
  {
    id: '01KGXGV6SKXJKJMF3K4HQSQ8VB',
    name: 'DevOps',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the DevOps agent. Your Phase 1 ticket:

TKT-OPS-001: Monitor Container Health and Resource Usage
- Use docker_api with action 'list' to see all containers
- Use docker_api with action 'stats' on key containers: forge, dashboard, postgres, redis
- Use docker_api with action 'logs' to check for errors in forge and dashboard containers
- Check disk usage with shell_exec
- Report container health status and any concerns

Focus on: memory usage, restart counts, error logs.`,
  },
  {
    id: '01KGXG4STMCPSY1F60ZX5TBZFX',
    name: 'Quartermaster',
    prompt: `[FLEET LAUNCH - ${new Date().toISOString()}]

You are the Quartermaster database agent. Your ticket:

TKT-QM-001: Monitor Database Health and Growth
- Use db_query to check forge database: table sizes, row counts, index usage
- Use substrate_db_query to check substrate database health
- Check for table bloat and recommend VACUUM if needed
- Monitor connection pool usage
- Check pg_stat_activity for active connections

Key tables to monitor: forge_executions (will grow fast), forge_agents, forge_tool_executions, agent_tickets, agent_findings.
Report findings concisely.`,
  },
];

console.log(`\n=== FLEET LAUNCH: ${new Date().toISOString()} ===`);
console.log(`Triggering ${fleet.length} agents with build assignments...\n`);

for (const agent of fleet) {
  await triggerAgent(agent.id, agent.name, agent.prompt);
  // Small delay between triggers to avoid overwhelming Forge
  await new Promise(r => setTimeout(r, 2000));
}

console.log('\n=== Fleet launch complete ===');
console.log('The scheduler daemon will continue triggering agents on their schedules.');
console.log('Monitor at: https://askalf.org/admin/hub/agents');
