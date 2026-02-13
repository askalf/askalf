# Agent Architecture: The Kubernetes of AI

## Vision

Forge is THE agent system — the Kubernetes equivalent for AI agents. Not a chatbot wrapper. A full platform for running, orchestrating, and managing AI agents at scale with complete lifecycle management: code, git, review, deploy.

---

## 4 Approaches to Embed Claude Code

| Approach | Method | Startup | Best For |
|----------|--------|---------|----------|
| **A: Agent SDK** | `@anthropic-ai/claude-agent-sdk` `query()` in-process | ~12s per call | Agents inside Forge process |
| **B: CLI Subprocess** | `claude -p "{task}" --output-format json --dangerously-skip-permissions` | ~12s per call | One-shot tasks, CI/CD |
| **C: Agent Teams** | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, lead + teammates | Warm | Multi-agent coordination |
| **D: Persistent Containers** | Each agent = Docker container running Claude Code CLI daemon | Instant (warm) | Always-on fleet with identity |

### Approach A — Agent SDK Details
```typescript
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const result = await query({
  systemPrompt: { type: 'preset', preset: 'claude_code', append: agentSystemPrompt },
  prompt: taskDescription,
  mcpServers: [workflowMcp, dataMcp, infraMcp],
  maxBudgetUsd: agent.max_cost_per_execution,
  maxTurns: agent.max_iterations,
  permissionMode: 'bypassPermissions',
});
```

### Approach B — CLI Subprocess Details
```bash
claude -p "{task}" \
  --output-format json \
  --mcp-config mcp.json \
  --system-prompt-file CLAUDE.md \
  --max-budget-usd {budget} \
  --dangerously-skip-permissions
```
- Output: `{ result, session_id, total_cost_usd, usage, structured_output }`
- Session resume: `--continue` / `--resume <id>`

### Approach C — Agent Teams Details
- Lead session coordinates multiple teammate sessions
- Shared task lists with DAG dependencies
- Inter-agent messaging and broadcast
- Display modes: `in-process` or `tmux`
- Env: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

### Approach D — Persistent Agent Containers Details
- Each agent = a Docker container running Claude Code CLI
- Container stays warm between tasks (instant next-task startup)
- Agent daemon subscribes to Redis channel for tasks
- Custom CLAUDE.md + MCP config per agent
- `read_only: true`, `cap_drop: [ALL]`, resource limits

---

## 4-Layer Architecture

The production architecture combines Approaches C and D, with A and B for special cases.

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Special Agents (SDK/CLI - Approaches A & B)        │
│ - SDK engine for in-process agents (batch cost savings)     │
│ - CLI subprocess for ephemeral one-shot tasks               │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Shared MCP Tool Servers                            │
│ ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐       │
│ │mcp-workflow  │ │ mcp-data     │ │ mcp-infra       │       │
│ │ticket_ops    │ │ db_query     │ │ docker_api      │       │
│ │intervention  │ │ substrate_db │ │ deploy_ops      │       │
│ │finding_ops   │ │ memory_*     │ │ security_scan   │       │
│ └─────────────┘ └──────────────┘ └─────────────────┘       │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Fleet Coordination (Approach C - Agent Teams)      │
│ - fleet-coordinator.ts orchestrates multi-agent tasks       │
│ - Pipeline: Architect → Backend Dev → QA (sequential)       │
│ - Fan-out: Sentinel dispatches parallel security scans      │
│ - Consensus: Multiple agents analyze, lead synthesizes      │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: Persistent Agent Containers (Approach D)           │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ Sentinel │ │Nightwatch│ │ Architect│ │Backend   │  ...x17 │
│ │ (256MB)  │ │ (256MB)  │ │ (256MB)  │ │Dev(256MB)│       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│ Each: agent-daemon.ts → Redis sub → claude -p → Redis pub  │
└─────────────────────────────────────────────────────────────┘
```

---

## Tool Mapping

### Native to Claude Code (5 tools — no MCP needed)
- `api_call` → Claude Code's built-in HTTP/fetch
- `web_browse` → Claude Code's built-in web browsing
- `file_ops` → Claude Code's built-in Read/Write/Edit
- `shell_exec` → Claude Code's built-in Bash
- `web_search` → Claude Code's built-in WebSearch

### Hybrid (4 tools — thin MCP wrappers)
- `code_exec` → Sandbox wrapper for isolated execution
- `web_search` → SearXNG self-hosted (supplement Claude's web search)
- `git_ops` → Intervention gating on merge_to_main
- `code_analysis` → Parsed output formatting

### Custom MCP Servers (10 tools → 3 containers)
- **mcp-workflow**: ticket_ops, intervention_ops, finding_ops, agent_call
- **mcp-data**: db_query, substrate_db_query, memory_search, memory_store
- **mcp-infra**: docker_api, deploy_ops, security_scan

---

## 6-Phase Migration Plan

### Phase 1: MCP Tool Servers ✅ COMPLETE
- 3 new containers: `mcp-workflow`, `mcp-data`, `mcp-infra`
- Template from existing `apps/mcp/src/http.ts`
- Zero disruption to existing agents

### Phase 2: SDK Engine ✅ COMPLETE
- `apps/forge/src/runtime/sdk-engine.ts`
- `runtime_mode` column: `legacy` | `sdk` | `container`
- All 18 agents converted from legacy to SDK
- Batch engine preserved for cost-sensitive operations

### Phase 3: Persistent Agent Containers ✅ COMPLETE
- 18 agent containers deployed via `docker-compose.agents.yml`
- `apps/agent-container/` with agent-daemon.ts, Redis pubsub pipeline
- `scripts/generate-agent-config.js` generates per-agent CLAUDE.md + mcp.json
- MCP wired via streamable HTTP (`--mcp-config` with `/mcp` endpoints)
- 16 MCP tools + native Claude Code tools available to all agents
- PTY wrapper (`script -q -c`) for Claude Code CLI compatibility

### Phase 4: Fleet Coordination ✅ COMPLETE
- `fleet-coordinator.ts` + `team-manager.ts` wired end-to-end
- 3 patterns: pipeline (sequential), fan-out (parallel), consensus (synthesizer)
- `team_coordinate` tool (#20) — agents can self-organize teams
- Dashboard "Coordination" tab in OrchestrationHub
- Redis-only state (24h TTL), no DB tables needed

### Phase 5: ALF Chat Evolution ✅ COMPLETE
- Replaced raw fetch streaming with Anthropic SDK `messages.stream()` + agentic tool loop
- 3 in-process ALF tools: `shard_search`, `alf_profile_read`, `convergence_stats`
- `apps/api/src/services/chat-tools.ts` — tool definitions + SQL executors
- Max 5 tool turns per conversation, parallel tool calls supported
- SSE events: `tool_use`, `tool_result`, `token`, `done` (dashboard already handles all)
- `tool_calls JSONB` column in `chat_messages` for persistence
- Shard fast-path, billing, auth, memory context all preserved unchanged

### Phase 6: Migration & Cutover ✅ COMPLETE
- All 18 agents on `runtime_mode='container'` (zero on legacy)
- Default runtime_mode changed from `'legacy'` to `'container'`
- Legacy engine (engine.ts), state-machine.ts, mcp-config.ts marked `@deprecated`
- Batch engine preserved for cost-sensitive operations (50% API discount)
- 731 historical executions backfilled with `runtime_mode='legacy'`
- SDK engine available as in-process alternative for future agents

---

## Resource Estimates

| Component | Containers | Memory Each | Total |
|-----------|-----------|-------------|-------|
| MCP servers (4) | 4 | ~128MB | ~512MB |
| Agent containers (18) | 18 | ~256MB | ~4.6GB |
| SDK engine (in forge) | 0 | ~50MB | ~50MB |
| **Total new** | **22** | — | **~5.2GB** |

---

## Agent Container Spec

```dockerfile
FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code
COPY agent-daemon.ts /app/
COPY entrypoint.sh /app/
# Per-agent config injected at runtime
WORKDIR /workspace
ENTRYPOINT ["/app/entrypoint.sh"]
```

```typescript
// agent-daemon.ts (simplified)
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const agentId = process.env.AGENT_ID;

// Subscribe to task channel
await redis.subscribe(`agent:${agentId}:tasks`);

redis.on('message', async (channel, message) => {
  const task = JSON.parse(message);

  // Run Claude Code CLI
  const result = await exec(`claude -p "${task.input}" \
    --mcp-config /app/mcp.json \
    --system-prompt-file /app/CLAUDE.md \
    --output-format json \
    --max-budget-usd ${task.budget} \
    --dangerously-skip-permissions`);

  // Publish result
  await redis.publish(`agent:${agentId}:results`, JSON.stringify({
    executionId: task.executionId,
    output: result.stdout,
    cost: result.total_cost_usd,
  }));
});
```

---

*Created: Feb 11, 2026*
*Last Updated: Feb 11, 2026*
