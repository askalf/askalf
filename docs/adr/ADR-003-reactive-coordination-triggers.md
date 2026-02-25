# ADR-003: Reactive Coordination Triggers

**Status:** Accepted
**Date:** 2026-02-22
**Author:** Doc Writer
**Related:** ADR-001 (Agent Code Review Pipeline), ADR-002 (Execution Reliability)

## Context

AskAlf agents run on fixed schedules — every 30 minutes to 6 hours. This schedule-driven model works for independent work cycles, but creates a significant gap: **agents cannot react to each other's discoveries in real time**.

When Scout finds a security vulnerability, Aegis doesn't know until its next scheduled cycle hours later. When Backend Dev changes a database schema, QA Engineer doesn't know until it happens to run. Cross-domain work that should trigger collaboration instead disappears into execution logs.

The organism has a heartbeat but no nervous system.

### What existed before

- Ticket system for explicit cross-agent coordination (manual: agents deliberately create tickets for each other)
- Shared memory system for persistent knowledge (async: memories surface during the next cycle's recall phase)
- Scheduled polling (each agent reads tickets at the start of its cycle)

None of these provide **reactive** response — a signal one agent produces automatically reaching the agent that needs to act on it.

### Why not use the ticket system directly?

Agents already create explicit tickets when they know work crosses domains. The reactive system handles the case where an agent *doesn't know* its work has cross-domain implications — or where it discovered something implicitly while focused on another task.

### Why not LLM-based routing?

Routing cross-domain signals via LLM calls would:
1. Add ~$0.01–0.10 per execution in routing overhead
2. Introduce latency (LLM inference) into a hot path
3. Require careful prompt engineering to avoid hallucinated ticket targets

The signal map is deterministic, auditable, and free.

---

## Decision

Implement a **reactive trigger engine** that runs on the event bus and creates cross-agent tickets automatically when an agent's execution output contains keywords in another agent's capability domain.

### Architecture

```
Agent Execution Completes
        │
        ▼
  Event Bus ("completed")
        │
        ▼
  Reactive Trigger Engine
   ├─ Fetch full output from DB
   ├─ Load signal map (capability → keywords, cached 10min)
   ├─ Scan first 3,000 chars for keyword matches
   ├─ Filter: require ≥2 unique keyword matches per capability
   ├─ Filter: exclude source agent's own capability domains
   ├─ Filter: exclude cascade from reactive executions
   ├─ Check global rate limit (≤20 triggers/hour)
   ├─ Check per-pair cooldown (30min per source→capability pair)
   ├─ Resolve best-qualified agent via capability registry
   └─ INSERT ticket + INSERT audit record (forge_reactive_triggers)
```

### Signal Map

The signal map is built dynamically from `forge_capability_catalog` — the same table that the capability registry uses for `forge_capabilities` MCP tool queries. Each capability has a `keywords[]` array. Keywords are compiled into a single `RegExp` with word boundaries.

This means the signal map evolves as agents update their capability definitions — no code changes required.

### Rate Limiting

Two independent rate limits prevent trigger storms:

| Limit | Threshold | Scope |
|-------|-----------|-------|
| Global rate limit | 20 triggers / hour | Fleet-wide |
| Per-pair cooldown | 30 minutes | Source agent × capability domain |

Limits are enforced via DB queries on `forge_reactive_triggers` (no in-memory state, survives restarts).

### Cascade Prevention

Executions that were themselves triggered by a reactive ticket (identified by `metadata.reactive_source = true`) are skipped. This prevents: Agent A → reactive ticket → Agent B → reactive ticket → Agent A loops.

### Priority and Category

All reactive tickets are created with:
- `priority: 'medium'` — these are signals, not emergencies
- `category: <capability_name>` — matches the domain that triggered
- `source: 'reactive'`
- `is_agent_ticket: true`

Explicit agent-created tickets (priority `high` or `urgent`) take precedence in scheduling.

---

## Implementation

**Files:**
- `apps/forge/src/orchestration/reactive-triggers.ts` — core engine
- `apps/forge/src/orchestration/capability-registry.ts` — signal map source
- `apps/forge/src/orchestration/event-bus.ts` — execution event subscription
- `apps/forge/src/index.ts` — `startReactiveTriggers()` called on boot

**Database tables used:**
- `forge_capability_catalog` — keyword signal map (read)
- `forge_executions` — full output fetch, metadata check (read)
- `agent_tickets` — ticket creation (write)
- `forge_reactive_triggers` — rate limit tracking + audit log (read/write)

**Key constants (in `reactive-triggers.ts`):**

| Constant | Value | Purpose |
|----------|-------|---------|
| `MIN_OUTPUT_LENGTH` | 200 chars | Skip trivial outputs |
| `SCAN_LENGTH` | 3,000 chars | Limit scan to first N chars (performance) |
| `MIN_SIGNAL_STRENGTH` | 2 | Require ≥2 unique keyword matches |
| `MAX_SIGNALS_PER_EVENT` | 3 | Cap tickets created per execution |
| `COOLDOWN_MINUTES` | 30 | Per-pair cooldown |
| `MAX_TRIGGERS_PER_HOUR` | 20 | Global fleet rate limit |
| `MIN_PROFICIENCY` | 30 | Min capability score for target agent |
| `SIGNAL_CACHE_TTL` | 10 min | Signal map cache lifetime |

---

## Consequences

### Positive

- **Zero LLM cost** — pure keyword matching, deterministic, fast
- **Cross-domain awareness** — agents react to each other's work without explicit coordination
- **Evolving signal map** — capability keywords updated by agents propagate automatically
- **Auditable** — every trigger recorded in `forge_reactive_triggers` with source, target, keywords
- **Spam-resistant** — rate limits prevent trigger floods from noisy executions

### Negative

- **False positives** — keyword matching can fire on incidental mentions (e.g., an agent *discussing* security doesn't mean it found a vulnerability)
- **Keyword brittleness** — capabilities with sparse or poorly-chosen keywords generate weak signals
- **3,000 char scan limit** — signals buried deep in long outputs are missed
- **No severity weighting** — all reactive tickets are `medium` priority; a 2-keyword match and a 15-keyword match get the same urgency

### Known Issues

- **TOCTOU in rate limiting** — rate limit check and trigger insert are not atomic; under concurrent completions, the 20/hour limit can be exceeded by a small margin (ADR-002 recommends wrapping in a transaction)
- **Single agent resolution** — only the top-ranked agent for a capability gets the ticket; if that agent is busy, the ticket waits

---

## Alternatives Considered

### A: Agent-only explicit tickets (status quo)
Agents create tickets when they know work crosses domains. No reactive layer.

**Rejected:** Too much is missed. Agents focused on one domain don't notice cross-domain signals in their own output.

### B: LLM-based routing after each execution
Send output to an LLM that decides which agents should be notified.

**Rejected:** Cost (~$0.01–0.10/execution × 16 agents × many executions/day), latency, and fragility of LLM routing on hot path.

### C: Polling model — agents scan each other's recent outputs
Agents periodically read recent executions from other agents and decide if action is needed.

**Rejected:** Compounds the scheduling problem — agents already need to poll tickets. This doubles the polling burden and has higher latency than an event-driven approach.

### D: Pub-sub by agent subscription
Agents declare which other agents they want to monitor. Direct subscription.

**Rejected:** Creates tight coupling between agents. Adding a new agent or capability requires updating subscriber lists across the fleet.

---

## Future Work

- **Severity weighting:** High signal strength (≥5 unique keywords) could upgrade ticket priority to `high`
- **Deeper scan:** Extend `SCAN_LENGTH` or use chunked scanning for long outputs
- **Capability keyword curation:** Agents with `forge_capabilities` tool can improve their keyword lists, directly improving reactive routing accuracy
- **Trigger analytics:** Dashboard panel showing reactive trigger volume, per-capability breakdown, false positive rate (estimated via ticket resolution without action)

---

## Related Documents

- `apps/forge/src/orchestration/reactive-triggers.ts` — implementation
- `docs/adr/ADR-001-agent-code-review-pipeline.md` — proposal system (another cross-agent coordination mechanism)
- `docs/MCP_TOOLS_REFERENCE.md` — `forge_capabilities` tool for querying the capability catalog
- `CLAUDE.md` — Stage 2 (Nervous System) vision that motivated this design
