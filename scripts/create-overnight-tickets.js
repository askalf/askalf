#!/usr/bin/env node
/**
 * Create overnight work tickets for all agents.
 * Each agent gets specific, actionable tickets matching their role.
 * Run: cat scripts/create-overnight-tickets.js | docker exec -i sprayberry-labs-api node -
 */

const http = require('http');

function adminRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost', port: 3001, method, path,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const TICKETS = [
  // =========================================
  // Backend Dev (Opus) — Critical fixes + improvements
  // =========================================
  {
    title: 'Fix metabolic/lessons endpoint database schema error',
    description: `The /api/v1/metabolic/lessons endpoint is crashing with a database schema error. This is a CRITICAL production issue.

Steps:
1. Read the endpoint handler in apps/api/src/index.ts — search for "metabolic/lessons"
2. Check the database schema for the relevant tables
3. Identify the schema mismatch
4. Fix the query or add the missing column/table
5. Test the endpoint

Use the substrate_db_query tool to inspect the schema. Use file_ops to read and fix the code.
This ticket is also listed as ticket 00MLHG1KNJ2C57588EF6784CAF — resolve that one too when done.`,
    priority: 'urgent',
    category: 'bug-fix',
    agent_id: '01KGXGV6RSSKVXEF8X2S79R3KR',
    agent_name: 'Backend Dev',
  },
  {
    title: 'Audit API error handling — ensure all endpoints return proper error responses',
    description: `Review all API endpoints in apps/api/src/index.ts for proper error handling patterns.

Check for:
1. Endpoints that throw unhandled errors (no try/catch)
2. Endpoints returning raw error objects instead of sanitized messages
3. Missing status codes (e.g., returning 200 for errors)
4. SQL injection vectors in any dynamic queries

Read the main API file, audit each endpoint's error handling, and create findings for any issues discovered.
Use finding_ops to report issues. Do NOT modify code — just audit and report.`,
    priority: 'high',
    category: 'audit',
    agent_id: '01KGXGV6RSSKVXEF8X2S79R3KR',
    agent_name: 'Backend Dev',
  },

  // =========================================
  // Frontend Dev (Opus) — Dashboard improvements
  // =========================================
  {
    title: 'Dashboard performance audit — identify slow-loading pages and optimize',
    description: `Audit the dashboard app (apps/dashboard/) for performance issues.

Tasks:
1. Review all page components for unnecessary re-renders or expensive computations
2. Check for missing React.memo, useMemo, or useCallback where appropriate
3. Identify components that fetch data on every render instead of caching
4. Look for large bundle imports that could be lazy-loaded
5. Check if any CSS animations cause layout thrashing

Read the main pages: OrchestrationHub.tsx, ContentShards.tsx, Analytics.tsx, CodeReview.tsx.
Create findings for each issue discovered with severity and suggested fix.`,
    priority: 'medium',
    category: 'performance',
    agent_id: '01KGXGV6R7KD6F3WD0MGASRHYY',
    agent_name: 'Frontend Dev',
  },
  {
    title: 'Implement error boundary components for dashboard resilience',
    description: `The dashboard needs error boundaries to prevent white-screen crashes.

Tasks:
1. Read the existing dashboard structure (apps/dashboard/src/App.tsx, routes)
2. Create an ErrorBoundary component that catches React render errors
3. Wrap major page sections with error boundaries
4. Show a user-friendly error state with "retry" button
5. Log errors to console with component stack trace

Create the ErrorBoundary component and integrate it into the app layout.
Work on branch agent/frontend-dev/error-boundaries.`,
    priority: 'medium',
    category: 'feature',
    agent_id: '01KGXGV6R7KD6F3WD0MGASRHYY',
    agent_name: 'Frontend Dev',
  },

  // =========================================
  // Architect (Opus) — System design
  // =========================================
  {
    title: 'Design proposal: Agent execution retry and circuit breaker pattern',
    description: `The agent fleet needs better resilience. When executions fail, they should retry with backoff.

Design a proposal covering:
1. Retry policy: which failures are retryable (transient) vs permanent
2. Exponential backoff with jitter
3. Circuit breaker: if an agent fails N times in a row, pause its schedule temporarily
4. Dead letter queue: failed executions that need human review
5. How this integrates with the existing worker.ts and container-result-listener.ts

Review the current execution flow:
- apps/forge/src/runtime/worker.ts (execution dispatch)
- apps/forge/src/runtime/container-result-listener.ts (result handling)
- apps/dashboard/src/routes/admin-hub.js (scheduler)

Write your design as a finding with category "architecture" and include SQL schema changes if needed.
Do NOT implement — just design and document.`,
    priority: 'high',
    category: 'architecture',
    agent_id: '01KGXGV6QBPG0S0VGRY64T7D1W',
    agent_name: 'Architect',
  },
  {
    title: 'Review database indexing strategy and propose optimizations',
    description: `Audit all database tables in both 'substrate' and 'forge' databases for missing or redundant indexes.

Steps:
1. Query pg_stat_user_tables for sequential scan counts (high seq scans = missing index)
2. Query pg_stat_user_indexes for unused indexes (never scanned = waste)
3. Check all foreign keys have corresponding indexes
4. Look for composite index opportunities on frequently-joined columns
5. Check index bloat with pg_stat_all_indexes

Use substrate_db_query to run these diagnostic queries. Create findings for each optimization opportunity.`,
    priority: 'medium',
    category: 'performance',
    agent_id: '01KGXGV6QBPG0S0VGRY64T7D1W',
    agent_name: 'Architect',
  },

  // =========================================
  // QA Engineer (Opus) — Testing
  // =========================================
  {
    title: 'Comprehensive Forge API endpoint validation',
    description: `Test every Forge API endpoint for correctness, edge cases, and error handling.

Endpoints to test:
1. GET/POST /api/v1/forge/agents — list and create agents
2. GET/PUT /api/v1/forge/agents/:id — read and update agent
3. POST /api/v1/forge/executions — trigger execution
4. GET /api/v1/forge/executions — list executions with pagination
5. GET /api/v1/forge/executions/:id — execution detail + SSE stream
6. Fleet memory endpoints: fleet/stats, fleet/search, fleet/recent
7. Coordination endpoints: sessions, plans, stats

For each endpoint, test:
- Valid request → expected response
- Missing required fields → proper 400 error
- Invalid ID → proper 404 error
- Pagination parameters work correctly

Use api_call tool with base URL http://forge:3005. Report findings for any failures.`,
    priority: 'high',
    category: 'testing',
    agent_id: '01KGXGV6S74J5BKEZHDJ8Q672K',
    agent_name: 'QA Engineer',
  },
  {
    title: 'Validate agent container health and MCP tool connectivity',
    description: `Check that all 18 agent containers are healthy and their MCP tools are accessible.

Steps:
1. Query Redis for agent heartbeats: check keys agent:*:heartbeat
2. Query Redis for agent statuses: check keys agent:*:status
3. For each agent, verify heartbeat is recent (< 2 minutes old)
4. Check if any agent is stuck in "processing" state for too long
5. Test MCP connectivity by calling a simple tool (like ticket_ops list) through each MCP server:
   - http://mcp-workflow:3010/mcp
   - http://mcp-data:3011/mcp
   - http://mcp-infra:3012/mcp
   - http://mcp-alf:3013/mcp

Report findings for any unhealthy agents or unreachable MCP servers.`,
    priority: 'high',
    category: 'testing',
    agent_id: '01KGXGV6S74J5BKEZHDJ8Q672K',
    agent_name: 'QA Engineer',
  },

  // =========================================
  // DevOps (Haiku) — Infrastructure
  // =========================================
  {
    title: 'Docker security audit — scan all containers for vulnerabilities',
    description: `Run a security audit of the Docker infrastructure.

Steps:
1. List all running containers and their image versions
2. Check for containers running as root (security risk)
3. Verify all containers have cap_drop: ALL
4. Check for containers with privileged mode
5. Verify read_only filesystem is enabled where appropriate
6. Check if any containers expose unnecessary ports
7. Review volume mounts for overly permissive access (rw when ro would suffice)

Use docker_api to inspect each container. Use security_scan for additional checks.
Create findings for each vulnerability discovered with severity ratings.`,
    priority: 'high',
    category: 'security',
    agent_id: '01KGXGV6SKXJKJMF3K4HQSQ8VB',
    agent_name: 'DevOps',
  },
  {
    title: 'Monitor and report container resource usage overnight',
    description: `Track resource utilization across all containers for capacity planning.

Steps:
1. Check docker stats for all containers (CPU%, memory usage, network I/O)
2. Identify containers using more than 70% of their memory limit
3. Check disk usage on all volumes
4. Monitor Redis memory usage (INFO memory)
5. Check PostgreSQL connection count and pool utilization
6. Report on the total fleet resource footprint

Use docker_api for container stats. Use db_query for database stats.
Create a comprehensive finding with resource utilization data.`,
    priority: 'medium',
    category: 'monitoring',
    agent_id: '01KGXGV6SKXJKJMF3K4HQSQ8VB',
    agent_name: 'DevOps',
  },

  // =========================================
  // API Tester (Haiku) — Endpoint testing
  // =========================================
  {
    title: 'Full regression test of public API endpoints',
    description: `Test all public-facing API endpoints on api.askalf.org for correctness.

Endpoints to test:
1. Health endpoints: /health, /api/v1/health
2. Chat endpoints: POST /api/chat/completions, GET /api/chat/sessions
3. Shard endpoints: GET /api/v1/shards, GET /api/v1/shards/search
4. Auth endpoints: verify token validation works
5. Analytics endpoints: GET /api/v1/analytics/*

For each endpoint:
- Test happy path with valid params
- Test error paths (missing auth, bad params)
- Measure response time
- Verify response format matches expected schema

Use api_call tool with base URL http://api:3000. Report findings for any failures or slow responses (>1s).`,
    priority: 'medium',
    category: 'testing',
    agent_id: '01KGXGV6T1N9RJMHF44MFX6WA3',
    agent_name: 'API Tester',
  },

  // =========================================
  // Data Engineer (Sonnet) — Database work
  // =========================================
  {
    title: 'Database query performance audit — identify and fix slow queries',
    description: `Audit PostgreSQL for slow queries and optimization opportunities.

Steps:
1. Check pg_stat_statements for slowest queries (if enabled)
2. Run EXPLAIN ANALYZE on key queries:
   - SELECT from agent_tickets with status filter
   - SELECT from forge_executions with date range
   - SELECT from procedural_shards with text search
   - SELECT from forge_agents with joins
3. Check table bloat: SELECT schemaname, relname, n_dead_tup, n_live_tup FROM pg_stat_user_tables
4. Check for tables needing VACUUM or ANALYZE
5. Review connection pool stats

Use substrate_db_query for both substrate and forge databases.
Create findings for each slow query or optimization opportunity with specific recommendations.`,
    priority: 'medium',
    category: 'performance',
    agent_id: '01KGXGV6TD7REMT407ZV7QTSB6',
    agent_name: 'Data Engineer',
  },
  {
    title: 'Audit data integrity across all agent-related tables',
    description: `Check for data integrity issues across agent tables.

Checks to run:
1. Orphaned records: forge_executions referencing non-existent agents
2. Tickets assigned to agents that don't exist
3. Schedules for agents that have been deleted
4. Duplicate agent names or IDs
5. Executions stuck in 'pending' or 'running' status for >1 hour
6. Check that all foreign key relationships are consistent
7. Verify no NULL values in required fields

Run queries against both substrate and forge databases.
Create findings for any integrity issues found.`,
    priority: 'medium',
    category: 'audit',
    agent_id: '01KGXGV6TD7REMT407ZV7QTSB6',
    agent_name: 'Data Engineer',
  },

  // =========================================
  // Doc Writer (Sonnet) — Documentation
  // =========================================
  {
    title: 'Generate comprehensive API documentation for the Forge API',
    description: `Create documentation for all Forge API endpoints.

Tasks:
1. Read apps/forge/src/routes/ — document every route file
2. For each endpoint, document:
   - HTTP method and path
   - Required/optional parameters
   - Request body schema
   - Response format with examples
   - Authentication requirements
   - Error responses
3. Read the existing agent execution flow and document the lifecycle
4. Document the MCP tool system (which tools are available, what they do)

Write the documentation as a finding with category "documentation".
Include a table of contents and organized sections.`,
    priority: 'medium',
    category: 'documentation',
    agent_id: '01KGXGV6TY5VJ7GAK9JW1T79SZ',
    agent_name: 'Doc Writer',
  },
  {
    title: 'Document the agent container architecture and deployment guide',
    description: `Create operational documentation for the agent container fleet.

Cover:
1. Architecture overview: daemon, Redis pub/sub, credential management
2. How to add a new agent to the fleet
3. How to update agent configurations (CLAUDE.md, MCP config)
4. Debugging guide: how to check agent logs, heartbeats, stuck tasks
5. Schedule management: how to change frequencies
6. OAuth credential setup and rotation
7. Common failure modes and troubleshooting

Read:
- apps/agent-container/src/agent-daemon.ts
- docker-compose.agents.yml
- scripts/generate-agent-config.js

Write as a finding with category "documentation".`,
    priority: 'medium',
    category: 'documentation',
    agent_id: '01KGXGV6TY5VJ7GAK9JW1T79SZ',
    agent_name: 'Doc Writer',
  },

  // =========================================
  // Forge Smith (Opus) — Self-improvement
  // =========================================
  {
    title: 'Audit and optimize agent tool configurations across the fleet',
    description: `Review all agent MCP configurations and tool access to ensure optimal setup.

Steps:
1. Read all agent-configs/*/mcp.json files to see which MCP servers each agent uses
2. Check if any agent is missing tools they need for their role
3. Check if any agent has tools they shouldn't (principle of least privilege)
4. Verify all 4 MCP servers are in each config: workflow, data, infra, alf
5. Check that MCP server URLs are correct and using streamable HTTP transport
6. Review CLAUDE.md files for accuracy and completeness

Create findings for any misconfigured agents. For each finding, include the specific fix needed.`,
    priority: 'high',
    category: 'audit',
    agent_id: '01KGXG4SS55GBA5SRZBVV8E1NR',
    agent_name: 'Forge Smith',
  },

  // =========================================
  // Herald (Sonnet) — Communications
  // =========================================
  {
    title: 'Generate comprehensive fleet activity report for the last 24 hours',
    description: `Create a detailed status report covering all fleet activity.

Include:
1. Total executions in last 24h: completed vs failed, by agent
2. Ticket throughput: opened vs resolved, by priority
3. Agent availability: uptime per agent based on heartbeat data
4. Cost summary: total spend by agent and model tier
5. Notable findings: any critical or high-severity findings from agents
6. Knowledge crystallization: new shards created, packs updated

Query the forge_executions, agent_tickets, and agent_findings tables.
Use substrate_db_query for substrate DB and db_query for forge DB.
Create a finding with category "report" containing the full formatted report.`,
    priority: 'medium',
    category: 'report',
    agent_id: '01KGXG4SV2ZQH936ZQVJ81JP9M',
    agent_name: 'Herald',
  },

  // =========================================
  // Quartermaster (Haiku) — Resources
  // =========================================
  {
    title: 'Audit fleet cost efficiency and resource allocation',
    description: `Analyze the cost-effectiveness of the agent fleet.

Steps:
1. Query forge_executions for cost per agent over last 7 days
2. Calculate cost per successful execution vs failed
3. Identify most expensive agents (cost per value delivered)
4. Check model tier appropriateness: are Opus agents doing work that Haiku could handle?
5. Review budget limits per agent (MAX_BUDGET_USD) vs actual spending
6. Recommend budget adjustments

Use db_query against the forge database for execution cost data.
Create a finding with category "cost-analysis" with recommendations.`,
    priority: 'medium',
    category: 'cost-analysis',
    agent_id: '01KGXG4STMCPSY1F60ZX5TBZFX',
    agent_name: 'Quartermaster',
  },

  // =========================================
  // Concierge (Haiku) — User experience
  // =========================================
  {
    title: 'Audit ALF chat experience and identify improvement opportunities',
    description: `Test the ALF chat system from a user perspective.

Steps:
1. Check recent chat sessions for error rates
2. Query chat_messages for sessions where tool_use was triggered — verify it worked correctly
3. Check shard fast-path hit rate (questions answered instantly vs requiring LLM)
4. Review ALF profile data quality — are profiles being maintained?
5. Check for common user questions that ALF struggles with
6. Identify gaps in the knowledge base that users are asking about

Use substrate_db_query against the substrate database (chat_sessions, chat_messages tables).
Create findings for any issues with the chat experience.`,
    priority: 'medium',
    category: 'user-experience',
    agent_id: '01KGXG4ST1DR9KPM6S4EB56A6G',
    agent_name: 'Concierge',
  },

  // =========================================
  // Shard Curator (Sonnet) — Knowledge work
  // =========================================
  {
    title: 'Mine fleet memory for new knowledge shards — overnight crystallization run',
    description: `Run a comprehensive knowledge crystallization cycle.

Tasks:
1. Query fleet episodic memory for high-quality episodes (quality >= 0.8) from last 48h
2. Identify recurring patterns or insights across multiple agent experiences
3. Group related episodes into candidate knowledge themes
4. For each theme with 3+ supporting episodes:
   a. Create a new candidate shard with crystallized knowledge
   b. Include source episode references in metadata
5. Check orphaned promoted shards (not in any pack) and organize them into existing or new packs
6. Propose new packs via intervention if you identify a clear knowledge category gap

Use memory_search to find episodic memories. Use substrate_db_query for shard/pack operations.
Target: Create at least 3 new candidate shards from fleet intelligence.`,
    priority: 'high',
    category: 'knowledge',
    agent_id: '01KH295596E1CVNTRQDHWZXKEB',
    agent_name: 'Shard Curator',
  },

  // =========================================
  // Nightwatch (Haiku) — Security monitoring
  // =========================================
  {
    title: 'Overnight security monitoring — check for anomalies and threats',
    description: `Run a comprehensive security scan of the entire infrastructure.

Checks:
1. Verify all services are running and healthy (docker ps)
2. Check for failed login attempts or unusual auth patterns
3. Review recent agent executions for any that attempted unauthorized operations
4. Check Redis for unexpected keys or data patterns
5. Verify Cloudflare tunnel is active and routing correctly
6. Check for any exposed ports that shouldn't be public
7. Review Docker logs for any error patterns indicating intrusion attempts
8. Verify all TLS certificates are valid

Use security_scan and docker_api tools. Create findings for any security concerns.`,
    priority: 'high',
    category: 'security',
    agent_id: '01KGXG4SRNPS9XT49VR1N8FSMB',
    agent_name: 'Nightwatch',
  },

  // =========================================
  // Metabolist (Haiku) — Convergence
  // =========================================
  {
    title: 'Convergence metrics analysis and environmental impact report',
    description: `Analyze the convergence cycle and environmental impact data.

Steps:
1. Call GET /api/v1/convergence for current metrics (water saved, carbon saved, power saved)
2. Calculate trend: are metrics improving over time?
3. Check shard hit rate (knowledge reuse = water savings)
4. Analyze which knowledge domains have highest convergence impact
5. Identify areas where the system could save more resources
6. Generate a formatted environmental impact summary

Use the GET /api/v1/convergence endpoint for convergence data. Use substrate_db_query for other queries as needed.
Create a finding with category "convergence" containing the full analysis.`,
    priority: 'medium',
    category: 'convergence',
    agent_id: '01KH1ZKR0001CONVERGENCEOP01',
    agent_name: 'Metabolist',
  },

  // =========================================
  // Overseer (Haiku) — Fleet management
  // =========================================
  {
    title: 'Fleet execution success rate audit — identify underperforming agents',
    description: `Analyze execution success rates across the entire fleet.

Steps:
1. Query forge_executions grouped by agent_id for last 7 days
2. Calculate success rate (completed / total) per agent
3. Identify agents with < 80% success rate
4. For failing agents, analyze common error patterns
5. Check if failures correlate with specific times, models, or task types
6. Recommend specific fixes for underperforming agents

Use db_query against the forge database.
Create findings for underperforming agents with root cause analysis.
If any agent is consistently failing, create an intervention for human review.`,
    priority: 'high',
    category: 'fleet-management',
    agent_id: '01KGXG4SVERD6E8BHKVMK6JTBY',
    agent_name: 'Overseer',
  },

  // =========================================
  // Sentinel (Haiku) — System monitoring
  // =========================================
  {
    title: 'Comprehensive infrastructure health check — all services and databases',
    description: `Run a full infrastructure health check.

Check all services:
1. API (api:3000): GET /health
2. Forge (forge:3005): GET /health
3. Dashboard (dashboard:3002): accessible
4. MCP servers: workflow:3010, data:3011, infra:3012, alf:3013
5. Redis: PING response, memory usage, connected clients
6. PostgreSQL: connection count, database sizes, replication lag
7. SearXNG (searxng:8080): search functionality
8. Cloudflare tunnel status

For each service, report: status (up/down), response time, any errors.
Use api_call for HTTP checks, db_query for database checks, docker_api for container health.
Create a finding with the complete health report.`,
    priority: 'high',
    category: 'monitoring',
    agent_id: '01KGXG4SNRAAGWE0F4Z44NXB5S',
    agent_name: 'Sentinel',
  },

  // =========================================
  // Librarian (Sonnet) — already has 2 tickets, add 1 more
  // =========================================
  {
    title: 'Knowledge base quality audit — validate all promoted shards',
    description: `Audit the quality of all promoted knowledge shards.

Steps:
1. Query all promoted shards: SELECT id, title, content, quality_score, created_at FROM procedural_shards WHERE status = 'promoted'
2. For each shard, evaluate:
   - Is the content accurate and up-to-date?
   - Is the quality_score appropriate?
   - Is it properly categorized?
   - Does it have good search metadata?
3. Check for duplicate or near-duplicate shards
4. Check for stale shards (> 30 days old with outdated information)
5. Verify all shards in packs are accessible and well-organized

Use substrate_db_query for all queries. Create findings for quality issues.
Do NOT create new shards — that's Shard Curator's job. Focus on auditing quality.`,
    priority: 'medium',
    category: 'quality',
    agent_id: '01KGXG4SSG50D7HRJ811F6XZ3X',
    agent_name: 'Librarian',
  },
];

(async () => {
  console.log(`Creating ${TICKETS.length} overnight tickets...\n`);

  let created = 0;
  let failed = 0;

  for (const ticket of TICKETS) {
    try {
      const res = await adminRequest('POST', '/api/v1/admin/tickets', {
        title: ticket.title,
        description: ticket.description,
        status: 'open',
        priority: ticket.priority,
        category: ticket.category,
        agent_id: ticket.agent_id,
        agent_name: ticket.agent_name,
        is_agent_ticket: true,
        source: 'human',
        metadata: { overnight_batch: true, created_by: 'fleet-commander' },
      });
      if (res.status === 201) {
        created++;
        console.log(`OK [${ticket.priority.padEnd(6)}] ${ticket.agent_name.padEnd(16)} → ${ticket.title.substring(0, 70)}`);
      } else {
        failed++;
        console.log(`FAIL ${ticket.agent_name}: ${res.status} ${JSON.stringify(res.data).substring(0, 200)}`);
      }
    } catch (err) {
      failed++;
      console.log(`ERROR ${ticket.agent_name}: ${err.message}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Created: ${created}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total tickets in queue:`);

  // Show ticket counts by agent
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://substrate:substrate@postgres:5432/substrate' });
  const result = await pool.query(`
    SELECT agent_name, status, count(*)
    FROM agent_tickets
    WHERE status IN ('open', 'in_progress')
    GROUP BY agent_name, status
    ORDER BY agent_name, status
  `);
  for (const row of result.rows) {
    console.log(`  ${(row.agent_name || 'unassigned').padEnd(18)} ${row.status.padEnd(12)} ${row.count}`);
  }
  await pool.end();

  console.log('\nDone! Fleet is loaded for overnight operations.');
})();
