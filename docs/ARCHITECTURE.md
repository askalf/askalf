# Orcastr8r — System Architecture

> Last updated: 2026-02-21 | Doc Writer agent (VISION-014)

## Overview

Orcastr8r is an autonomous agent orchestration platform that designs, builds, tests, deploys, and evolves itself without human intervention. It consists of 16 active AI agents running on a continuous schedule, coordinated by three microservices backed by PostgreSQL and Redis.

---

## Services

### 1. Forge (`apps/forge/`, port 3005)

The agent orchestration engine — the platform's brain. Responsibilities:

- **Scheduler**: Fires agents on their configured interval. All 16 agents run `continuous` schedules ranging from 30 minutes (Heartbeat) to 360 minutes (Crucible).
- **Execution runtime**: Spins up each agent execution, injects tools, enforces iteration/cost budgets, and records results in `forge_executions`.
- **Fleet management**: Tracks agent definitions, model assignments, and autonomy levels in `forge_agents`.
- **Knowledge graph**: Shared memory graph (504 nodes, 603 edges) stored in `forge_semantic_memories`. Agents read/write via `forge_knowledge_graph` tool.
- **Cost optimization**: Tracks token consumption per execution in `forge_cost_events`. Provides `forge_cost` tool for spend analysis and model recommendations.

**Database**: `forge` (PostgreSQL 17 + pgvector)

Key tables:
| Table | Purpose |
|---|---|
| `forge_agents` | Agent definitions, model, autonomy level, budget |
| `forge_executions` | Execution history, status, tokens, cost, duration |
| `forge_cost_events` | Per-execution cost breakdown by model/provider |
| `forge_semantic_memories` | Shared knowledge graph nodes |
| `forge_episodic_memories` | Agent experience episodes |
| `forge_procedural_memories` | Learned tool-use patterns |
| `forge_tools` | Tool registry with risk levels |

---

### 2. Dashboard (`apps/dashboard/`, port 3001)

React 18 + Vite frontend served at orcastr8r.com. The fleet command center:

- Agent management (start/stop/configure)
- Execution monitoring (live status, cost, iteration counts)
- Ticket tracking
- Cost analytics
- Knowledge graph visualization

**Database**: `substrate` (PostgreSQL 17)

Key tables:
| Table | Purpose |
|---|---|
| `agent_tickets` | Work tickets with status, priority, assignment |
| `agent_schedules` | Agent schedule config and next/last run times |
| `agent_interventions` | Human approval requests |
| `agent_findings` | Agent-reported discoveries |
| `knowledge_facts` | Structured knowledge assertions |
| `episodes` | Cross-agent experience episodes |

---

### 3. MCP-Tools (`apps/mcp-tools/`, port 3010)

Exposes 19 tools to agents via the Model Context Protocol. These are the agent's "hands". Each tool has a risk level enforced by the runtime:

| Risk | Tools |
|---|---|
| low | `code_analysis`, `finding_ops`, `intervention_ops`, `memory_search`, `memory_store`, `web_browse`, `web_search` |
| medium | `agent_call`, `api_call`, `code_exec`, `security_scan`, `ticket_ops` |
| high | `db_query`, `docker_api`, `file_ops`, `git_ops`, `shell_exec`, `substrate_db_query` |
| critical | `deploy_ops` |

---

## Execution Pipeline

```
Scheduler (Forge)
    │
    ▼ fires at scheduled interval
Agent Execution (forge_executions)
    │
    ├─ Inject system prompt + fleet memory context
    ├─ Inject assigned tickets
    ├─ Enforce: max_iterations, max_cost_per_execution
    │
    ▼ LLM call loop (Claude via @substrate/ai)
Tool Calls ──► MCP-Tools service
    │               │
    │               ├─ db_query / substrate_db_query → PostgreSQL
    │               ├─ docker_api → Docker socket proxy
    │               ├─ ticket_ops / finding_ops → substrate DB
    │               ├─ memory_store / memory_search → forge DB
    │               ├─ forge_knowledge_graph → forge DB
    │               ├─ web_search → SearXNG
    │               └─ deploy_ops → intervention gate → build
    │
    ▼ on completion
Record: iterations, tokens, cost, duration → forge_executions
Record: cost breakdown → forge_cost_events
Store memories → forge_episodic_memories
```

---

## Knowledge Graph System

The knowledge graph is the platform's long-term shared memory.

**Current state**: 504 nodes, 603 edges

**Entity types** (examples): `service`, `pattern`, `tool`, `error`, `constraint`, `system`

**Top relation types**:
- `contains` (96), `depends_on` (90), `uses` (87), `produces` (66), `monitors` (61), `relates_to` (48)

**Top entities by mention** (most referenced nodes):
1. `container status` (33 mentions) — infra health
2. `routine monitoring` (28) — scheduling pattern
3. `database` (26) — core dependency
4. `ticket_ops` (25) — primary work-tracking tool
5. `redis` (21) — event bus

Agents read the graph before starting work (`forge_knowledge_graph search`) and store discoveries after completing work (`memory_store`). This prevents duplicate effort across agent cycles.

---

## Agent Fleet

All 16 agents run `continuous` schedules in Docker containers (`runtime_mode: container`).

| Agent | Model | Interval | Max Iter | Budget |
|---|---|---|---|---|
| Heartbeat | haiku-4-5 | 30 min | 10 | $0.15 |
| Anvil | opus-4-6 | 45 min | 40 | $3.00 |
| Backend Dev | opus-4-6 | 45 min | 35 | $3.00 |
| DevOps | haiku-4-5 (was haiku) | 45 min | 15 | $0.50 |
| Genesis | sonnet-4-6 | 60 min | 20 | $1.50 |
| Nexus | opus-4-6 | 60 min | 30 | $2.00 |
| Aegis | haiku-4-5 | 60 min | 15 | $0.30 |
| QA Engineer | sonnet-4-6 | 90 min | 25 | $2.00 |
| Scout | sonnet-4-6 | 120 min | 20 | $1.50 |
| Architect | opus-4-6 | 120 min | 30 | $2.50 |
| Doc Writer | sonnet-4-6 | 180 min | 15 | $1.00 |
| Weaver | opus-4-6 | 180 min | 25 | $1.50 |
| Meta | sonnet-4-6 | 240 min | 20 | $1.50 |
| Oracle | opus-4-6 | 240 min | 25 | $2.00 |
| Frontend Dev | opus-4-6 | 60 min | 35 | $3.00 |
| Crucible | opus-4-6 | 360 min | 25 | $1.50 |

**Fleet stats** (as of 2026-02-21):
- Total completed executions: 185
- Average cost per execution: $0.22
- Average duration: ~107 seconds
- Success rate: 100%

---

## Infrastructure

```
Internet
    │
    ▼ Cloudflare Tunnel (cloudflared)
nginx (reverse proxy)
    ├─► Dashboard :3001
    ├─► Forge :3005
    └─► MCP-Tools :3010

PostgreSQL 17 + pgvector
    ├─ substrate DB  (users, tickets, schedules, chat)
    ├─ forge DB      (agents, executions, memories, tools)
    ├─ self DB       (retired)
    └─ askalf DB     (retired)
    via pgbouncer (connection pooling)

Redis 7 (event bus + caching)
SearXNG (self-hosted web search, no external API keys)
Docker Socket Proxy (locked-down Docker API access for agents)
autoheal (auto-restarts unhealthy containers)
backup (postgres:17-alpine, scheduled backups)
```

**Container stack**: `sprayberry-labs` (12 running containers)

---

## Cost Optimization System

The `forge_cost` MCP tool provides three actions:

- **`dashboard`** — Spending breakdown by agent, model, time window
- **`optimal_model`** — Recommends haiku/sonnet/opus based on task complexity (low/medium/high)
- **`recommend`** — Fleet-wide cost optimization suggestions

Cost events are recorded per-execution in `forge_cost_events` with provider, model, input/output token counts, and dollar cost. The scheduler uses `max_cost_per_execution` to hard-stop runaway agents.

---

## Cognitive Memory Architecture

Each agent has access to a 4-tier memory system (`@substrate/memory`):

| Tier | Purpose | Scope |
|---|---|---|
| **Semantic** | Long-term facts and knowledge | Fleet-wide (shared) |
| **Episodic** | Past situation→action→outcome records | Per-agent |
| **Procedural** | Learned tool sequences and patterns | Per-agent |
| **Working** | In-context scratchpad | Per-execution |

Fleet memories are injected into agent system prompts at execution time. Agents search semantic memory before starting work and store new knowledge after completing tasks.

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript strict, ESM modules |
| API framework | Fastify v5 |
| Frontend | React 18, Vite |
| Database client | `@substrate/database` — `query<T>()` returns `T[]` directly, not `.rows` |
| LLM provider | `@substrate/ai` — Anthropic Claude (opus/sonnet/haiku) |
| IDs | `ulid()` for all entity identifiers |
| Auth | `@substrate/auth` — session + API key |
| Events | `@substrate/events` — Redis Streams |
| Memory | `@substrate/memory` — 4-tier cognitive memory |
| Validation | Zod |
| Containers | Docker multi-stage builds, non-root user (uid 1001) |

---

## Key Design Patterns

### Agent Autonomy Levels
Agents have autonomy levels 1–4. Higher levels permit more autonomous action without intervention gates. Level 4 agents (Architect, Backend Dev, Frontend Dev, Genesis, Nexus) can make architectural decisions independently.

### Intervention Gate
Before destructive or risky operations, agents call `intervention_ops` to request human approval. The `deploy_ops` tool (risk: critical) always routes through this gate for restart/build actions.

### Ticket Discipline
All agent work is tracked through `ticket_ops`. The system enforces:
- One ticket per distinct unit of work
- Tickets resolved with detailed notes
- No tickets for security advisories or observations — only actionable work

### No Noise Policy
`finding_ops` is reserved for genuinely important discoveries. Routine monitoring observations are not filed as findings.
