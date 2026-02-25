# MCP Tools Reference

**Audience:** Agents running inside AskAlf
**Updated:** 2026-02-22
**Source:** `apps/mcp-tools/src/`

All tools are exposed to agents via the MCP server at port 3010. Tool calls return JSON strings.

---

## Tool Index

| Tool | Module | Purpose |
|------|--------|---------|
| `db_query` | data | Query the Forge PostgreSQL database (read-only) |
| `substrate_db_query` | data | Query the Substrate PostgreSQL database (read-only) |
| `memory_search` | data | Search fleet cognitive memory |
| `memory_store` | data | Store facts, experiences, or procedures in memory |
| `ticket_ops` | workflow | Create and manage work tickets |
| `finding_ops` | workflow | Report and manage discoveries |
| `intervention_ops` | workflow | Request or check human interventions |
| `agent_call` | workflow | Delegate a task to another agent |
| `proposal_ops` | workflow | Manage code review change proposals (ADR-001) |
| `docker_api` | infra | Inspect Docker containers |
| `deploy_ops` | infra | Check deployment status and trigger builds |
| `security_scan` | infra | Security audits (npm audit, secrets scan, etc.) |
| `code_analysis` | infra | Typecheck, dead code, complexity analysis |
| `web_search` | agent | Search the web via SearXNG |
| `web_browse` | agent | Fetch and extract text from a URL |
| `team_coordinate` | agent | Spin up multi-agent teams |
| `forge_checkpoints` | forge | Human approval checkpoints |
| `forge_capabilities` | forge | Query agent capability catalog |
| `forge_knowledge_graph` | forge | Traverse the fleet knowledge graph |
| `forge_goals` | forge | Manage agent goals |
| `forge_fleet_intel` | forge | Fleet health stats and leaderboard |
| `forge_memory` | forge | Search and store fleet memories (broader than `memory_search`) |
| `forge_cost` | forge | Cost analytics and model recommendations |
| `forge_coordination` | forge | Multi-agent coordination session management |

---

## Data Tools

### `db_query`

Execute a read-only SQL query against the **Forge** PostgreSQL database.

- Only `SELECT`, `WITH`, `EXPLAIN` allowed — no mutations
- Max 100 rows returned
- Do **not** end SQL with semicolons

**Key tables:** `forge_agents`, `forge_executions`, `forge_sessions`, `forge_cost_events`, `forge_semantic_memories`, `forge_episodic_memories`, `forge_procedural_memories`, `forge_tools`, `forge_audit_log`, `forge_change_proposals`, `forge_proposal_reviews`

```json
{
  "sql": "SELECT id, name, status FROM forge_agents WHERE status = 'active' LIMIT 10",
  "params": []
}
```

---

### `substrate_db_query`

Execute a read-only SQL query against the **Substrate** PostgreSQL database.

**Key tables:** `agent_tickets`, `agent_schedules`, `agent_interventions`, `agent_findings`, `users`, `procedural_shards`, `knowledge_facts`, `episodes`, `reasoning_traces`

```json
{
  "sql": "SELECT id, title, status, priority FROM agent_tickets WHERE assigned_to = $1",
  "params": ["Doc Writer"]
}
```

---

### `memory_search`

Search fleet cognitive memory for relevant knowledge.

```json
{
  "query": "database connection pool patterns",
  "agent_id": "optional — scope to one agent",
  "memory_type": "semantic | episodic | procedural | all",
  "limit": 5
}
```

**When to use:** Always call this before starting work. Prevents duplicating what another agent already solved.

---

### `memory_store`

Store knowledge in fleet cognitive memory. Three tiers:

| Type | Content | Extra fields |
|------|---------|-------------|
| `semantic` | Facts about the system | `importance` (0–1), `source` |
| `episodic` | What happened during a task | `action`, `outcome`, `quality` (0–1), `execution_id` |
| `procedural` | How to do something (tool sequences) | `trigger_pattern`, `tool_sequence` |

```json
{
  "type": "episodic",
  "content": "Investigated duplicate dispatch bug in scheduler",
  "action": "Read scheduler.ts, traced race condition in status check",
  "outcome": "Found that 'pending' status was not blocked, only 'running'",
  "quality": 1.0,
  "agent_id": "my-agent-id"
}
```

---

## Workflow Tools

### `ticket_ops`

Create and manage work tickets tracked in the Substrate database.

**Actions:** `create`, `update`, `assign`, `list`, `get`, `add_note`, `audit_history`

```json
// Create
{
  "action": "create",
  "title": "Document proposal_ops tool",
  "description": "Full context here...",
  "priority": "medium",
  "assigned_to": "Doc Writer",
  "category": "documentation"
}

// Update status
{
  "action": "update",
  "ticket_id": "01ABC...",
  "status": "in_progress"
}

// Resolve
{
  "action": "update",
  "ticket_id": "01ABC...",
  "status": "resolved",
  "resolution": "Wrote docs/MCP_TOOLS_REFERENCE.md covering all 24 tools"
}

// List assigned to me
{
  "action": "list",
  "filter_assigned_to": "Doc Writer",
  "filter_status": "open"
}
```

**Priorities:** `low`, `medium`, `high`, `urgent`

---

### `finding_ops`

Report discoveries that the fleet should know about.

**Actions:** `create`, `list`, `get`, `promote`

```json
{
  "action": "create",
  "finding": "proposal_ops tool exists but has no documentation for agents",
  "severity": "warning",
  "category": "documentation",
  "agent_name": "Doc Writer"
}
```

**Severities:** `info`, `warning`, `critical`

> Only file findings for genuinely important discoveries — not routine observations.

---

### `intervention_ops`

Request a human decision or escalation.

**Actions:** `create`, `list`, `get`, `check`

```json
// Request approval
{
  "action": "create",
  "type": "approval",
  "title": "Merge migration 017 to production",
  "description": "Schema change adds new index on forge_executions...",
  "proposed_action": "Run migration and deploy",
  "agent_name": "DevOps"
}

// Check status later
{
  "action": "check",
  "intervention_id": "01ABC..."
}
```

**Types:** `approval`, `escalation`, `feedback`, `error`, `resource`

---

### `agent_call`

Delegate a task to another agent by ID. Runs the agent synchronously and returns its output.

```json
{
  "agent_id": "01ANVIL0000000000000000000",
  "input": "Review the schema migration for correctness and flag any issues",
  "caller_agent_name": "Backend Dev"
}
```

> Use `db_query` against `forge_agents` to look up agent IDs by name.

---

### `proposal_ops`

**Manage code review change proposals** — the peer review pipeline from ADR-001. Agents that write code should use this instead of committing directly to critical paths.

**Actions:** `create`, `submit`, `review`, `list`, `get`, `apply`, `revise`

**Proposal lifecycle:**
```
draft → pending_review → approved → applied
                       ↓
              revision_requested → draft (cycle)
                       ↓
                    rejected
```

**Proposal types:** `prompt_revision`, `code_change`, `config_change`, `schema_change`
**Risk levels:** `low`, `medium`, `high`, `critical`
**Reviewer verdicts:** `approve`, `reject`, `request_changes`, `comment`

#### Create a proposal

```json
{
  "action": "create",
  "proposal_type": "code_change",
  "title": "Fix race condition in scheduler dispatch",
  "description": "The scheduler checks only 'running' status but must also block 'pending' to prevent duplicate dispatch.",
  "author_agent_id": "01ANVIL0000000000000000000",
  "risk_level": "high",
  "required_reviews": 1,
  "file_changes": [
    {
      "path": "apps/forge/src/runtime/scheduler.ts",
      "action": "modify",
      "old_content": "WHERE status = 'running'",
      "new_content": "WHERE status IN ('running', 'pending')",
      "diff": "- WHERE status = 'running'\n+ WHERE status IN ('running', 'pending')"
    }
  ]
}
```

#### Submit for review (transitions draft → pending_review)

```json
{
  "action": "submit",
  "proposal_id": "01ABC..."
}
```

#### Review a proposal

```json
{
  "action": "review",
  "proposal_id": "01ABC...",
  "reviewer_agent_id": "01KGXGV6S74J5BKEZHDJ8Q672K",
  "verdict": "approve",
  "comment": "Fix looks correct — blocking both statuses prevents the race",
  "analysis": { "tests_pass": true, "risk_assessment": "low blast radius" }
}
```

#### List proposals

```json
{
  "action": "list",
  "filter_status": "pending_review",
  "filter_type": "code_change"
}
```

#### Apply an approved proposal

```json
{
  "action": "apply",
  "proposal_id": "01ABC..."
}
```

#### Revise after changes requested

```json
{
  "action": "revise",
  "proposal_id": "01ABC...",
  "description": "Updated approach per reviewer feedback",
  "file_changes": [...]
}
```

**Reviewer matrix (per ADR-001):**

| Proposal type | Assigned reviewers |
|---------------|--------------------|
| `prompt_revision` | Meta, Architect |
| `code_change` | QA Engineer, Architect |
| `config_change` | QA Engineer, Architect |
| `schema_change` | QA Engineer, Architect |

High/critical risk proposals also require a human checkpoint via `forge_checkpoints`.

---

## Infrastructure Tools

### `docker_api`

Inspect Docker containers — read-only. No destructive operations.

**Actions:** `list`, `inspect`, `logs`, `stats`, `exec`, `top`

```json
// List all containers
{ "action": "list" }

// Get logs for a container
{ "action": "logs", "container": "forge", "tail": 50 }

// Run a read-only command inside a container
{ "action": "exec", "container": "forge", "command": ["node", "--version"] }
```

> `exec` into production containers is blocked for safety.

---

### `deploy_ops`

Check deployment status and trigger builds.

**Actions:** `status`, `logs`, `restart`, `build`, `health_check`

**Services:** `dashboard`, `forge`, `nginx`, `self`, `mcp-tools`, `searxng`, `askalf`

```json
// Check service health
{ "action": "health_check", "service": "forge" }

// View deployment logs
{ "action": "logs", "service": "forge", "tail": 100 }

// Trigger a build (requires an approved intervention ID)
{
  "action": "build",
  "service": "forge",
  "intervention_id": "01ABC...",
  "agent_name": "DevOps"
}
```

> `restart` and `build` require a pre-approved human intervention. Request one via `intervention_ops` first.

---

### `security_scan`

Security auditing tools.

**Actions:** `npm_audit`, `dependency_check`, `file_permissions`, `env_leak_check`, `docker_security`

```json
{ "action": "npm_audit", "package_dir": "apps/forge" }
{ "action": "env_leak_check", "scan_path": "apps/forge/src" }
{ "action": "docker_security", "container": "forge" }
```

---

### `code_analysis`

Static code analysis.

**Actions:** `typecheck`, `dead_code`, `import_analysis`, `complexity`, `todo_scan`

```json
{ "action": "typecheck", "package_dir": "apps/forge" }
{ "action": "todo_scan", "scan_path": "apps/forge/src" }
{ "action": "complexity", "file_path": "apps/forge/src/runtime/scheduler.ts" }
```

---

## Agent Tools

### `web_search`

Search the web via the self-hosted SearXNG instance. Aggregates Google, Bing, DuckDuckGo, Wikipedia, GitHub, StackOverflow.

```json
{
  "query": "Node.js pg pool connection timeout best practices",
  "max_results": 10
}
```

---

### `web_browse`

Fetch a URL and extract its text content. HTML is stripped.

```json
{
  "url": "https://node-postgres.com/apis/pool",
  "selector": "article",
  "max_length": 8000
}
```

---

### `team_coordinate`

Create a multi-agent team for complex tasks.

**Patterns:**
- `pipeline` — agents run sequentially (A → B → C), each receiving the previous output
- `fan-out` — agents run in parallel on the same input
- `consensus` — parallel analysis then a synthesizer agent merges results

```json
{
  "agent_id": "01NEXUS000000000000000000",
  "agent_name": "Nexus",
  "title": "Audit and fix scheduler race condition",
  "pattern": "pipeline",
  "tasks": [
    {
      "title": "Analyze root cause",
      "description": "Read scheduler.ts and identify all race conditions in agent dispatch",
      "agentName": "Architect"
    },
    {
      "title": "Implement fix",
      "description": "Apply the fix identified in the analysis step",
      "agentName": "Anvil",
      "dependencies": ["Analyze root cause"]
    }
  ]
}
```

---

## Forge Tools

### `forge_checkpoints`

Manage human approval checkpoints — pauses that require a human to approve/reject before the system proceeds.

**Actions:** `list`, `get`, `respond`

```json
// List pending
{ "action": "list" }

// Approve
{ "action": "respond", "checkpoint_id": "01ABC...", "status": "approved", "response": {} }
```

---

### `forge_capabilities`

Discover which agents have specific skills.

**Actions:** `find`, `catalog`, `agent_profile`

```json
// Find agents who can do security work
{ "action": "find", "capability": "security_analysis", "min_proficiency": 70 }

// View full catalog
{ "action": "catalog" }
```

---

### `forge_knowledge_graph`

Traverse the fleet's shared knowledge graph (1200+ nodes).

**Actions:** `traverse`, `stats`, `search`

```json
{ "action": "search", "query": "scheduler race condition" }
{ "action": "stats" }
{ "action": "traverse", "node_id": "01ABC..." }
```

---

### `forge_goals`

Manage agent goals.

**Actions:** `list`, `get`, `approve`, `reject`

```json
{ "action": "list", "status": "proposed" }
{ "action": "approve", "goal_id": "01ABC..." }
```

---

### `forge_fleet_intel`

Fleet-wide health and performance.

**Actions:** `stats`, `leaderboard`, `health`

```json
{ "action": "health" }
{ "action": "leaderboard" }
```

---

### `forge_memory`

Broader memory search/store that covers all agents and tiers.

**Actions:** `search`, `recent`, `store`

```json
{ "action": "search", "query": "proposal review workflow", "tier": "semantic" }
{ "action": "recent", "limit": 10 }
```

> Prefer `memory_search` for quick lookups. Use `forge_memory` when you need cross-agent or tier-filtered searches.

---

### `forge_cost`

Cost analytics and model selection.

**Actions:** `dashboard`, `optimal_model`, `recommend`

```json
{ "action": "dashboard" }
{
  "action": "optimal_model",
  "task_type": "code_review",
  "complexity": "medium"
}
```

---

### `forge_coordination`

View and manage multi-agent coordination sessions.

**Actions:** `list`, `get`, `stats`, `cancel`

```json
{ "action": "list" }
{ "action": "stats" }
{ "action": "get", "session_id": "01ABC..." }
```

---

## Patterns and Best Practices

### Before starting any work
```
1. memory_search("your task keywords") — check fleet knowledge
2. ticket_ops(list, filter_assigned_to=self) — pick up existing work
3. db_query / substrate_db_query — understand current system state
```

### After completing work
```
1. memory_store(episodic) — what you did and what you learned
2. ticket_ops(update, status=resolved) — close your ticket with resolution notes
3. finding_ops(create) — if you discovered something important for the fleet
```

### When writing code
```
1. code_analysis(typecheck) — verify types pass before proposing
2. proposal_ops(create + submit) — put code through review pipeline
3. ticket_ops(add_note) — note that proposal was created, include ID
```

### When crossing domains
```
- Security issues → ticket to Aegis
- Infrastructure → ticket to DevOps
- Backend/API code → ticket to Backend Dev
- Frontend/UI → ticket to Frontend Dev
- Architecture → ticket to Architect
- Testing → ticket to QA Engineer
```

---

## Related Documentation

- `docs/AGENT_ARCHITECTURE.md` — How agents are built and invoked
- `docs/adr/ADR-001-agent-code-review-pipeline.md` — Design of `proposal_ops`
- `docs/FORGE_API_DOCUMENTATION.md` — Full Forge REST API reference
- `CLAUDE.md` — Agent rules, role descriptions, ticket discipline
