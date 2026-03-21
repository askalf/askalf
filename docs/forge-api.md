# AskAlf Forge API Documentation

**Base URL:** `https://your-instance/api/v1`
**Authentication:** Bearer token (JWT) or API key via `Authorization: Bearer <token>` header.
All endpoints marked **Auth Required** return `401 Unauthorized` if credentials are missing or invalid.

---

## Table of Contents

1. [Authentication & Sessions](#authentication--sessions)
2. [Agents](#agents)
3. [Executions](#executions)
4. [Sessions (Conversations)](#sessions-conversations)
5. [Dispatch & Intent](#dispatch--intent)
6. [Channels](#channels)
7. [Triggers](#triggers)
8. [Workflows](#workflows)
9. [Templates](#templates)
10. [Tools & MCP](#tools--mcp)
11. [Memory](#memory)
12. [Marketplace](#marketplace)
13. [Economy](#economy)
14. [Fleet Analytics](#fleet-analytics)
15. [API Keys](#api-keys)
16. [Providers](#providers)
17. [User Providers](#user-providers)
18. [Preferences](#preferences)
19. [Devices](#devices)
20. [User Budget](#user-budget)
21. [Credentials & OAuth](#credentials--oauth)
22. [Onboarding](#onboarding)
23. [Clients & Projects](#clients--projects)
24. [Integrations](#integrations)
25. [Git Review](#git-review)
26. [Daemons](#daemons)
27. [Assistant & Terminal](#assistant--terminal)
28. [Webhooks](#webhooks)
29. [Admin](#admin)
30. [Platform Admin](#platform-admin)
31. [Public Endpoints](#public-endpoints)
32. [Error Codes](#error-codes)

---

## Authentication & Sessions

### Start OAuth Flow
```
GET /forge/oauth/start
```
**Auth Required:** Yes
Initiates a PKCE OAuth flow and returns the authorization URL.

**Response:**
```json
{
  "authUrl": "https://...",
  "state": "random-state-string"
}
```

---

### Exchange OAuth Code
```
POST /forge/oauth/exchange
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "code": "auth-code-from-callback",
  "state": "state-from-start"
}
```

**Response:**
```json
{
  "success": true,
  "expiresAt": "2026-03-22T00:00:00.000Z"
}
```

---

### Check OAuth Status
```
GET /forge/oauth/status
```
**Auth Required:** Yes

**Response:**
```json
{
  "connected": true,
  "status": "active",
  "expiresAt": "2026-03-22T00:00:00.000Z"
}
```

---

### Check Credentials Health
```
GET /forge/credentials/health
```
**Auth Required:** Yes

**Response:**
```json
{
  "status": "healthy",
  "expiresAt": "2026-03-22T00:00:00.000Z",
  "expiresIn": 86400
}
```

---

### Force Token Refresh
```
POST /forge/credentials/refresh
```
**Auth Required:** Yes

**Response:**
```json
{
  "refreshed": true,
  "expiresAt": "2026-03-22T00:00:00.000Z"
}
```

**Error Response:**
```json
{
  "refreshed": false,
  "error": "No refresh token available"
}
```

---

## Agents

### List Agents
```
GET /forge/agents
```
**Auth Required:** Yes

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (`active`, `paused`, `deleted`) |
| `search` | string | Full-text search on name/description |
| `limit` | number | Results per page (default: 20) |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "agents": [
    {
      "id": "01AGENT123",
      "name": "Backend Dev",
      "description": "Works on API and database tasks",
      "status": "active",
      "model": "claude-sonnet-4-6",
      "createdAt": "2026-03-01T00:00:00.000Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

### Create Agent
```
POST /forge/agents
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "name": "My Agent",
  "description": "What this agent does",
  "systemPrompt": "You are a helpful assistant...",
  "model": "claude-sonnet-4-6",
  "tools": ["bash", "read", "write"],
  "maxTurns": 50,
  "budgetLimit": 2.50
}
```

**Response:**
```json
{
  "agent": {
    "id": "01AGENT456",
    "name": "My Agent",
    "status": "active",
    "createdAt": "2026-03-21T00:00:00.000Z"
  }
}
```

---

### Get Agent
```
GET /forge/agents/:id
```
**Auth Required:** Yes

**Response:**
```json
{
  "agent": {
    "id": "01AGENT123",
    "name": "Backend Dev",
    "description": "...",
    "systemPrompt": "...",
    "model": "claude-sonnet-4-6",
    "status": "active",
    "tools": ["bash", "read"],
    "maxTurns": 50,
    "budgetLimit": 2.50,
    "createdAt": "2026-03-01T00:00:00.000Z",
    "updatedAt": "2026-03-21T00:00:00.000Z"
  }
}
```

---

### Update Agent
```
PUT /forge/agents/:id
```
**Auth Required:** Yes

**Request Body:** (all fields optional)
```json
{
  "name": "Updated Name",
  "description": "New description",
  "systemPrompt": "Updated prompt...",
  "model": "claude-opus-4-6",
  "tools": ["bash", "read", "write", "grep"],
  "maxTurns": 100,
  "budgetLimit": 5.00,
  "status": "paused"
}
```

**Response:**
```json
{ "agent": { ... } }
```

---

### Delete Agent
```
DELETE /forge/agents/:id
```
**Auth Required:** Yes
Soft-deletes the agent (sets status to `deleted`).

**Response:** `204 No Content`

---

### Restore Agent
```
POST /forge/agents/:id/restore
```
**Auth Required:** Yes

**Response:**
```json
{ "agent": { "id": "01AGENT123", "status": "active" } }
```

---

### Fork Agent
```
POST /forge/agents/:id/fork
```
**Auth Required:** Yes
Creates a copy of the agent with a new ID.

**Request Body:**
```json
{ "name": "My Agent (Fork)" }
```

**Response:**
```json
{ "agent": { "id": "01AGENTFORK", "name": "My Agent (Fork)", "status": "active" } }
```

---

### Optimize System Prompt
```
POST /forge/agents/optimize-prompt
```
**Auth Required:** Yes
Uses LLM to improve an agent's system prompt for clarity and effectiveness.

**Request Body:**
```json
{
  "prompt": "You do stuff with code",
  "agentName": "Backend Dev",
  "context": "TypeScript, Fastify, PostgreSQL"
}
```

**Response:**
```json
{
  "optimized": "You are a senior backend engineer specializing in...",
  "tokens": 342
}
```

---

## Executions

### Start Execution
```
POST /forge/executions
```
**Auth Required:** Yes
Launches an agent execution (async by default).

**Request Body:**
```json
{
  "agentId": "01AGENT123",
  "input": "Fix the bug in auth middleware",
  "sessionId": "01SESSION456",
  "metadata": { "ticketId": "tkt_001" }
}
```

**Response:**
```json
{
  "execution": {
    "id": "01EXEC789",
    "agentId": "01AGENT123",
    "status": "running",
    "startedAt": "2026-03-21T06:52:00.000Z"
  }
}
```

---

### List Executions
```
GET /forge/executions
```
**Auth Required:** Yes
Supports cursor-based pagination for large datasets.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | string | Filter by agent |
| `status` | string | `running`, `completed`, `failed`, `cancelled` |
| `limit` | number | Results per page (default: 20) |
| `offset` | number | Offset-based pagination |
| `cursor` | string | Cursor for cursor-based pagination |

**Response:**
```json
{
  "executions": [
    {
      "id": "01EXEC789",
      "agentId": "01AGENT123",
      "status": "completed",
      "input": "Fix the bug...",
      "cost": 0.045,
      "turns": 12,
      "startedAt": "2026-03-21T06:52:00.000Z",
      "completedAt": "2026-03-21T06:53:30.000Z"
    }
  ],
  "total": 150
}
```

---

### Get Execution
```
GET /forge/executions/:id
```
**Auth Required:** Yes

**Response:**
```json
{
  "execution": {
    "id": "01EXEC789",
    "agentId": "01AGENT123",
    "status": "completed",
    "input": "Fix the bug...",
    "output": "Fixed the authentication middleware...",
    "cost": 0.045,
    "turns": 12,
    "toolUses": ["read", "edit", "bash"],
    "startedAt": "2026-03-21T06:52:00.000Z",
    "completedAt": "2026-03-21T06:53:30.000Z"
  }
}
```

---

### Stream Execution Output
```
GET /forge/executions/:id/stream
```
**Auth Required:** Yes
Returns a Server-Sent Events (SSE) stream of execution output in real-time.

**Headers:**
```
Accept: text/event-stream
```

**Event Format:**
```
data: {"type":"text","content":"Reading file..."}
data: {"type":"tool_use","tool":"read","input":{"path":"/src/auth.ts"}}
data: {"type":"complete","output":"Done.","cost":0.045}
```

---

### Cancel Execution
```
POST /forge/executions/:id/cancel
```
**Auth Required:** Yes

**Response:**
```json
{ "cancelled": true }
```

---

## Sessions (Conversations)

Sessions represent persistent conversation threads with an agent.

### Create Session
```
POST /forge/sessions
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "agentId": "01AGENT123",
  "title": "Debugging auth issue"
}
```

**Response:**
```json
{
  "session": {
    "id": "01SESSION456",
    "agentId": "01AGENT123",
    "title": "Debugging auth issue",
    "status": "active",
    "createdAt": "2026-03-21T00:00:00.000Z"
  }
}
```

---

### List Sessions
```
GET /forge/sessions
```
**Auth Required:** Yes

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | string | Filter by agent |
| `active` | boolean | Only return active sessions |
| `limit` | number | Results per page |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "sessions": [ { ... } ],
  "total": 10,
  "limit": 20,
  "offset": 0
}
```

---

### Get Session
```
GET /forge/sessions/:id
```
**Auth Required:** Yes
Returns the session plus its execution history.

**Response:**
```json
{
  "session": { "id": "01SESSION456", "title": "...", "status": "active" },
  "executions": [ { "id": "01EXEC789", "status": "completed", ... } ]
}
```

---

### Send Message to Session
```
POST /forge/sessions/:id/messages
```
**Auth Required:** Yes
Sends a message to the session's agent and triggers a new execution.

**Request Body:**
```json
{
  "message": "Can you also check the token expiry logic?",
  "metadata": {}
}
```

**Response:**
```json
{
  "execution": {
    "id": "01EXEC790",
    "status": "running",
    "startedAt": "2026-03-21T06:55:00.000Z"
  }
}
```

---

### Deactivate Session
```
DELETE /forge/sessions/:id
```
**Auth Required:** Yes

**Response:**
```json
{
  "message": "Session deactivated",
  "session": { "id": "01SESSION456", "status": "inactive" }
}
```

---

## Dispatch & Intent

### Dispatch Task (NL Classification)
```
POST /forge/dispatch
```
**Auth Required:** Yes
Accepts a natural language input, classifies intent, creates a ticket, and assigns it to the right agent.

**Request Body:**
```json
{
  "input": "Fix the bug where users can't log in after password reset"
}
```

**Response:**
```json
{
  "ticketId": "tkt_abc123",
  "assignedTo": "Backend Dev",
  "title": "Fix login failure after password reset"
}
```

---

### Parse Intent
```
POST /forge/intent/parse
```
**Auth Required:** Yes
Uses LLM to parse natural language into structured agent configuration.

**Request Body:**
```json
{
  "message": "Set up a daily report agent that summarizes costs",
  "context": { "existingAgents": ["Backend Dev", "QA"] }
}
```

**Response:**
```json
{
  "intent": "create_agent",
  "executionMode": "scheduled",
  "subtasks": ["read cost data", "summarize", "send report"],
  "suggestedName": "Daily Cost Reporter",
  "suggestedTools": ["db_query", "email"]
}
```

---

## Channels

Channels enable inbound messages from external platforms (Slack, WhatsApp, etc.) to trigger agent executions.

### List Channel Configs
```
GET /forge/channels/configs
```
**Auth Required:** Yes

**Response:**
```json
{
  "configs": [
    {
      "id": "01CHAN001",
      "channel_type": "slack",
      "name": "Support Slack",
      "active": true,
      "createdAt": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

---

### Get Channel Config
```
GET /forge/channels/configs/:id
```
**Auth Required:** Yes
Returns config with secrets masked.

**Response:**
```json
{
  "id": "01CHAN001",
  "channel_type": "slack",
  "name": "Support Slack",
  "config": {
    "bot_token": "xoxb-****-****",
    "webhook_url": "https://..."
  },
  "active": true
}
```

---

### Create Channel Config
```
POST /forge/channels/configs
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "channel_type": "slack",
  "name": "Support Slack",
  "config": {
    "bot_token": "xoxb-real-token",
    "signing_secret": "abc123"
  }
}
```

**Response:**
```json
{
  "id": "01CHAN002",
  "webhookUrl": "https://your-instance/api/v1/forge/channels/slack/webhook/01CHAN002",
  "created": true
}
```

---

### Delete Channel Config
```
DELETE /forge/channels/configs/:id
```
**Auth Required:** Yes
Deactivates (soft-deletes) the channel config.

**Response:**
```json
{ "deleted": true }
```

---

### Test Channel Config
```
POST /forge/channels/configs/:id/test
```
**Auth Required:** Yes

**Response:**
```json
{
  "success": true,
  "message": "Connected to Slack workspace 'AskAlf'"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Invalid bot token"
}
```

---

### Receive Inbound Webhook
```
POST /forge/channels/:type/webhook/:configId
```
**Auth Required:** No (verified via channel signature)
Receives inbound messages from channel providers. Signature verification is performed per-channel (e.g., Slack HMAC, WhatsApp signature).

**Response:**
```json
{
  "ok": true,
  "executionId": "01EXEC800"
}
```

---

### WhatsApp Verification
```
GET /forge/channels/whatsapp/webhook/:configId
```
**Auth Required:** No
WhatsApp webhook verification handshake.

**Query Parameters:** `hub.mode`, `hub.verify_token`, `hub.challenge`
**Response:** Returns `hub.challenge` string.

---

### Dispatch via API Channel
```
POST /forge/channels/api/dispatch
```
**Auth Required:** Yes
Programmatically dispatch a message through the channel system.

**Request Body:**
```json
{
  "message": "Run a security audit",
  "agentId": "01AGENT123",
  "sync": false
}
```

**Response:**
```json
{
  "executionId": "01EXEC801",
  "status": "running"
}
```

---

## Triggers

Triggers fire agent executions automatically based on events (webhooks, schedules, etc.).

### List Triggers for Agent
```
GET /forge/agents/:agentId/triggers
```
**Auth Required:** Yes

**Response:**
```json
{
  "triggers": [
    {
      "id": "01TRIG001",
      "agentId": "01AGENT123",
      "trigger_type": "webhook",
      "config": { "secret": "****" },
      "enabled": true,
      "cooldown_minutes": 5,
      "max_fires_per_hour": 12
    }
  ]
}
```

---

### Create Trigger
```
POST /forge/agents/:agentId/triggers
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "trigger_type": "webhook",
  "config": { "secret": "mysecret" },
  "prompt_template": "Handle this event: {{payload}}",
  "cooldown_minutes": 5,
  "max_fires_per_hour": 12,
  "priority": "normal"
}
```

**Response:**
```json
{
  "trigger": {
    "id": "01TRIG002",
    "agentId": "01AGENT123",
    "trigger_type": "webhook",
    "webhookUrl": "https://your-instance/api/v1/webhooks/agent/01TRIG002",
    "enabled": true
  }
}
```

---

### Update Trigger
```
PUT /forge/triggers/:triggerId
```
**Auth Required:** Yes

**Request Body:** (all fields optional)
```json
{
  "config": { "secret": "newsecret" },
  "prompt_template": "Updated template: {{payload}}",
  "cooldown_minutes": 10,
  "max_fires_per_hour": 6,
  "priority": "high",
  "enabled": false
}
```

**Response:**
```json
{ "trigger": { ... } }
```

---

### Delete Trigger
```
DELETE /forge/triggers/:triggerId
```
**Auth Required:** Yes

**Response:**
```json
{ "deleted": true, "triggerId": "01TRIG002" }
```

---

### Fire Trigger (Public Webhook)
```
POST /webhooks/agent/:triggerId
```
**Auth Required:** No (rate-limited per IP: 60/min)
The public endpoint that receives inbound webhook events for a trigger.

**Request Body:** Any JSON payload

**Response:**
```json
{ "fired": true, "triggerId": "01TRIG002" }
```

---

## Workflows

Workflows define multi-agent pipelines with structured execution graphs.

### List Workflows
```
GET /forge/workflows
```
**Auth Required:** Yes

**Query Parameters:** `status`, `limit`, `offset`

**Response:**
```json
{
  "workflows": [
    {
      "id": "01WORK001",
      "name": "Security Audit Pipeline",
      "status": "active",
      "isPublic": false,
      "createdAt": "2026-03-01T00:00:00.000Z"
    }
  ],
  "total": 5,
  "limit": 20,
  "offset": 0
}
```

---

### Create Workflow
```
POST /forge/workflows
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "name": "Security Audit Pipeline",
  "description": "Runs security checks on code changes",
  "definition": {
    "steps": [
      { "agentId": "01AGENT_SECURITY", "input": "Audit {{files}}" },
      { "agentId": "01AGENT_REPORT", "input": "Generate report from {{step1.output}}" }
    ]
  },
  "isPublic": false,
  "metadata": { "tags": ["security"] }
}
```

**Response:**
```json
{ "workflow": { "id": "01WORK002", ... } }
```

---

### Get Workflow
```
GET /forge/workflows/:id
```
**Auth Required:** Yes

**Response:**
```json
{ "workflow": { "id": "01WORK001", "name": "...", "definition": { ... }, ... } }
```

---

### Update Workflow
```
PUT /forge/workflows/:id
```
**Auth Required:** Yes

**Request Body:** (all fields optional)
```json
{
  "name": "Updated Name",
  "description": "...",
  "definition": { ... },
  "status": "paused",
  "isPublic": true,
  "metadata": {}
}
```

---

### Run Workflow
```
POST /forge/workflows/:id/run
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "input": { "files": ["src/auth.ts", "src/middleware.ts"] },
  "metadata": { "triggeredBy": "push-to-main" }
}
```

**Response:**
```json
{
  "run": {
    "id": "01RUN001",
    "workflowId": "01WORK001",
    "status": "running",
    "startedAt": "2026-03-21T07:00:00.000Z"
  },
  "warning": null
}
```

---

### Get Workflow Run
```
GET /forge/workflow-runs/:id
```
**Auth Required:** Yes

**Response:**
```json
{
  "run": {
    "id": "01RUN001",
    "workflowId": "01WORK001",
    "status": "completed",
    "steps": [ { "agentId": "...", "status": "completed", "output": "..." } ],
    "startedAt": "...",
    "completedAt": "..."
  }
}
```

---

### List Workflow Runs
```
GET /forge/workflows/:id/runs
```
**Auth Required:** Yes

**Query Parameters:** `limit`, `offset`

**Response:**
```json
{ "runs": [ { ... } ], "total": 20 }
```

---

## Templates

Templates are pre-built agent configurations that can be instantiated.

### List Templates
```
GET /forge/templates
```
**Auth Required:** Yes

**Query Parameters:** `limit`, `offset`

**Response:**
```json
{
  "templates": [
    {
      "id": "01TMPL001",
      "name": "Code Reviewer",
      "description": "Reviews PRs and suggests improvements",
      "category": "engineering",
      "active": true
    }
  ],
  "categories": ["engineering", "security", "data", "productivity"],
  "total": 24,
  "limit": 20,
  "offset": 0
}
```

---

### Get Template
```
GET /forge/templates/:id
```
**Auth Required:** Yes

**Response:**
```json
{
  "template": {
    "id": "01TMPL001",
    "name": "Code Reviewer",
    "systemPrompt": "You are an expert code reviewer...",
    "tools": ["read", "grep", "glob"],
    "model": "claude-sonnet-4-6",
    "category": "engineering"
  }
}
```

---

### Instantiate Template
```
POST /forge/templates/:id/instantiate
```
**Auth Required:** Yes
Creates a new agent from this template.

**Request Body:**
```json
{
  "name": "My Code Reviewer",
  "description": "Custom code review agent",
  "overrides": {
    "model": "claude-opus-4-6",
    "maxTurns": 100
  }
}
```

**Response:**
```json
{
  "agent": { "id": "01AGENT999", "name": "My Code Reviewer", ... },
  "templateId": "01TMPL001",
  "message": "Agent created from template"
}
```

---

## Tools & MCP

### List Tools
```
GET /forge/tools
```
**Auth Required:** Yes

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | `builtin`, `custom`, `mcp` |
| `enabled` | boolean | Filter by enabled status |
| `limit` | number | Results per page |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "tools": [
    {
      "id": "01TOOL001",
      "name": "bash",
      "displayName": "Bash",
      "description": "Execute shell commands",
      "type": "builtin",
      "riskLevel": "high",
      "enabled": true
    }
  ],
  "total": 18,
  "limit": 20,
  "offset": 0
}
```

---

### Register Custom Tool
```
POST /forge/tools
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "name": "send_slack_message",
  "displayName": "Send Slack Message",
  "description": "Sends a message to a Slack channel",
  "type": "custom",
  "riskLevel": "low",
  "inputSchema": {
    "type": "object",
    "properties": {
      "channel": { "type": "string" },
      "message": { "type": "string" }
    },
    "required": ["channel", "message"]
  },
  "requiresApproval": false
}
```

**Response:**
```json
{ "tool": { "id": "01TOOL099", "name": "send_slack_message", ... } }
```

---

### Register MCP Server
```
POST /forge/mcp/servers
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "name": "GitHub MCP",
  "description": "GitHub tools via MCP",
  "transportType": "stdio",
  "connectionConfig": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "ghp_xxx" }
  }
}
```

**Response:**
```json
{ "server": { "id": "01MCP001", "name": "GitHub MCP", ... } }
```

---

### List MCP Servers
```
GET /forge/mcp/servers
```
**Auth Required:** Yes

**Query Parameters:** `limit`, `offset`

**Response:**
```json
{ "servers": [ { ... } ], "total": 3, "limit": 20, "offset": 0 }
```

---

### Discover MCP Server Tools
```
POST /forge/mcp/servers/:id/discover
```
**Auth Required:** Yes
Connects to the MCP server and enumerates available tools.

**Response:**
```json
{
  "message": "Discovered 12 tools",
  "serverId": "01MCP001",
  "serverName": "GitHub MCP",
  "discoveredTools": [
    { "name": "create_issue", "description": "Create a GitHub issue" },
    { "name": "list_prs", "description": "List pull requests" }
  ]
}
```

---

## Memory

### Search Agent Memory
```
GET /forge/memory/:agentId/search
```
**Auth Required:** Yes

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query |
| `type` | string | `semantic`, `episodic`, `procedural` |
| `limit` | number | Max results (default: 10) |

**Response:**
```json
{
  "type": "semantic",
  "memories": [
    {
      "id": "00MMABCD",
      "content": "The forge API uses JWT authentication...",
      "importance": 0.9,
      "similarity": 0.87,
      "createdAt": "2026-03-20T00:00:00.000Z"
    }
  ],
  "total": 5
}
```

---

### Inject Memory
```
POST /forge/memory/:agentId/inject
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "type": "semantic",
  "content": "The database uses pg.Pool with query<T>() helper",
  "source": "manual",
  "importance": 0.8
}
```

For `episodic` memories:
```json
{
  "type": "episodic",
  "situation": "Debugging auth failure",
  "action": "Checked JWT expiry logic",
  "outcome": "Found token not being refreshed",
  "importance": 0.9
}
```

For `procedural` memories:
```json
{
  "type": "procedural",
  "triggerPattern": "When handling database migration errors",
  "content": "Always check pg_locks table first",
  "importance": 0.7
}
```

**Response:**
```json
{
  "type": "semantic",
  "memory": { "id": "00MMXYZ", "content": "...", "createdAt": "..." }
}
```

---

### Fleet Memory Statistics
```
GET /forge/fleet/stats
```
**Auth Required:** Yes
Returns aggregate memory stats across all agents (cached 15 seconds).

**Response:**
```json
{
  "tiers": {
    "semantic": 180,
    "episodic": 1057,
    "procedural": 59
  },
  "total": 1296,
  "recent24h": 48,
  "recalls24h": 124,
  "agentBudgets": [
    { "agentId": "01AGENT123", "name": "Backend Dev", "memories": 245 }
  ]
}
```

---

### List Recent Fleet Memories
```
GET /forge/fleet/recent
```
**Auth Required:** Yes

**Query Parameters:** `limit`, `page`, `agent_id`, `tier`, `dateFrom`, `dateTo`

**Response:**
```json
{
  "memories": [ { ... } ],
  "total": 1296,
  "page": 1,
  "limit": 20,
  "totalPages": 65
}
```

---

### Search Fleet Memories
```
GET /forge/fleet/search
```
**Auth Required:** Yes

**Query Parameters:** `q`, `tier`, `agent_id`, `limit`, `page`

**Response:**
```json
{
  "memories": [ { ... } ],
  "total": 12,
  "page": 1,
  "limit": 10,
  "totalPages": 2
}
```

---

### Get Fleet Recall Events
```
GET /forge/fleet/recalls
```
**Auth Required:** Yes

**Query Parameters:** `limit`, `page`

**Response:**
```json
{
  "recalls": [
    {
      "id": "01RECALL001",
      "agentId": "01AGENT123",
      "query": "authentication patterns",
      "results": 5,
      "executionId": "01EXEC789",
      "createdAt": "..."
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

---

### Store Fleet Memory
```
POST /forge/fleet/store
```
**Auth Required:** Yes
Stores a memory without per-agent ownership checks (fleet-wide).

**Request Body:**
```json
{
  "type": "semantic",
  "content": "New deployment procedure for forge",
  "agent_id": "01AGENT123",
  "source": "observation",
  "importance": 0.75
}
```

**Response:**
```json
{ "type": "semantic", "memory": { ... } }
```

---

## Marketplace

### List Packages
```
GET /forge/marketplace/packages
```
**Auth Required:** Yes

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Package type filter |
| `tag` | string | Filter by tag |
| `featured` | boolean | Only featured packages |
| `search` | string | Search query |
| `sort` | string | `popular`, `recent`, `rating` |
| `limit` | number | Results per page |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "packages": [
    {
      "slug": "github-reviewer",
      "name": "GitHub Code Reviewer",
      "description": "Automated PR review agent",
      "authorName": "AskAlf",
      "packageType": "agent",
      "version": "1.2.0",
      "rating": 4.8,
      "installs": 342,
      "featured": true
    }
  ],
  "total": 87,
  "limit": 20,
  "offset": 0
}
```

---

### Get Package Details
```
GET /forge/marketplace/packages/:slug
```
**Auth Required:** Yes

**Response:**
```json
{
  "package": {
    "slug": "github-reviewer",
    "name": "GitHub Code Reviewer",
    "description": "...",
    "installConfig": { ... },
    "changelog": "..."
  },
  "ratings": [
    { "userId": "...", "rating": 5, "review": "Works great!", "createdAt": "..." }
  ]
}
```

---

### Install Package
```
POST /forge/marketplace/packages/:slug/install
```
**Auth Required:** Yes

**Response:**
```json
{
  "install": { "id": "01INSTALL001", "status": "completed" },
  "installedResourceId": "01AGENT500",
  "installedResourceType": "agent"
}
```

---

### Uninstall Package
```
DELETE /forge/marketplace/packages/:slug/uninstall
```
**Auth Required:** Yes

**Response:**
```json
{ "message": "Package uninstalled successfully" }
```

---

### Publish Package
```
POST /forge/marketplace/packages
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "slug": "my-custom-agent",
  "name": "My Custom Agent",
  "description": "Does amazing things",
  "authorName": "Jane Developer",
  "packageType": "agent",
  "version": "1.0.0",
  "installConfig": { "systemPrompt": "...", "tools": ["bash"] },
  "tags": ["productivity", "automation"]
}
```

**Response:**
```json
{ "package": { "slug": "my-custom-agent", "status": "pending_review", ... } }
```

---

### Rate Package
```
POST /forge/marketplace/packages/:slug/rate
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "rating": 5,
  "review": "Excellent agent, saves me hours every week"
}
```

**Response:**
```json
{ "rating": { "id": "01RATE001", "rating": 5, "createdAt": "..." } }
```

---

## Economy

Agent wallets track credits and spending limits.

### List Wallets
```
GET /forge/economy/wallets
```
**Auth Required:** Yes

**Response:**
```json
{
  "wallets": [
    {
      "agentId": "01AGENT123",
      "agentName": "Backend Dev",
      "balance": 10.00,
      "daily_spend_limit": 2.50,
      "spent_today": 0.45
    }
  ]
}
```

---

### Get Agent Wallet
```
GET /forge/economy/wallets/:agentId
```
**Auth Required:** Yes

**Response:**
```json
{
  "wallet": {
    "agentId": "01AGENT123",
    "balance": 10.00,
    "daily_spend_limit": 2.50,
    "spent_today": 0.45,
    "transactions": [ { ... } ]
  }
}
```

---

### Grant Credits
```
POST /forge/economy/wallets/:agentId/grant
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "amount": 5.00,
  "description": "Monthly allocation"
}
```

**Response:**
```json
{
  "transaction": {
    "id": "01TX001",
    "amount": 5.00,
    "type": "grant",
    "createdAt": "..."
  }
}
```

---

### Set Daily Spend Limit
```
PUT /forge/economy/wallets/:agentId/limit
```
**Auth Required:** Yes

**Request Body:**
```json
{ "daily_spend_limit": 3.00 }
```

**Response:**
```json
{ "agentId": "01AGENT123", "daily_spend_limit": 3.00 }
```

---

### List Bounties
```
GET /forge/economy/bounties
```
**Auth Required:** Yes

**Query Parameters:** `status` (`open`, `claimed`, `completed`)

**Response:**
```json
{
  "bounties": [
    {
      "id": "01BOUNTY001",
      "title": "Fix P0 authentication bug",
      "amount": 25.00,
      "status": "open",
      "assignedTo": null
    }
  ]
}
```

---

## Fleet Analytics

### Get Execution Heatmap
```
GET /forge/fleet/analytics
```
**Auth Required:** Yes

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `days` | number | Number of days to include (default: 7) |

**Response:**
```json
{
  "heatmap": [
    { "date": "2026-03-21", "hour": 6, "count": 12, "cost": 0.45 }
  ],
  "agents": [
    { "id": "01AGENT123", "name": "Backend Dev", "executions": 45, "cost": 4.32 }
  ]
}
```

---

## API Keys

### List API Keys
```
GET /forge/api-keys
```
**Auth Required:** Yes
Returns keys with secret hashes masked.

**Response:**
```json
{
  "api_keys": [
    {
      "id": "01KEY001",
      "name": "CI Pipeline",
      "key_prefix": "sk-alf-abc1",
      "permissions": ["executions:write", "agents:read"],
      "rate_limit": 100,
      "expires_at": null,
      "created_at": "2026-03-01T00:00:00.000Z",
      "last_used_at": "2026-03-21T06:00:00.000Z"
    }
  ]
}
```

---

### Create API Key
```
POST /forge/api-keys
```
**Auth Required:** Yes
Returns the full key only once — store it securely.

**Request Body:**
```json
{
  "name": "CI Pipeline",
  "permissions": ["executions:write", "agents:read"],
  "rate_limit": 100,
  "expires_at": "2027-01-01T00:00:00.000Z"
}
```

**Response:**
```json
{
  "id": "01KEY002",
  "key": "sk-alf-abc123fullkeyvalue",
  "key_prefix": "sk-alf-abc1",
  "warning": "Store this key securely — it will not be shown again",
  "permissions": ["executions:write", "agents:read"],
  "expires_at": "2027-01-01T00:00:00.000Z"
}
```

---

### Revoke API Key
```
DELETE /forge/api-keys/:id
```
**Auth Required:** Yes

**Response:**
```json
{ "success": true, "id": "01KEY002" }
```

---

### Rotate API Key
```
POST /forge/api-keys/:id/rotate
```
**Auth Required:** Yes
Creates a new key and gives the old one a 24-hour grace period.

**Response:**
```json
{
  "new_key": "sk-alf-newkeyvalue",
  "new_key_id": "01KEY003",
  "old_key_expires_at": "2026-03-22T06:52:00.000Z",
  "message": "Old key expires in 24 hours. Update your integrations."
}
```

---

## Providers

System-level LLM provider configuration.

### List Providers
```
GET /forge/providers
```
**Auth Required:** Yes

**Response:**
```json
{
  "providers": [
    {
      "id": "01PROV001",
      "name": "Anthropic",
      "type": "anthropic",
      "is_enabled": true,
      "base_url": "https://api.anthropic.com"
    }
  ],
  "total": 3,
  "limit": 20,
  "offset": 0
}
```

---

### List Provider Models
```
GET /forge/providers/:id/models
```
**Auth Required:** Yes

**Query Parameters:** `enabled`, `tools`, `vision`, `reasoning`, `limit`, `offset`

**Response:**
```json
{
  "provider": { "id": "01PROV001", "name": "Anthropic" },
  "models": [
    {
      "id": "claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6",
      "contextWindow": 200000,
      "supportsTools": true,
      "supportsVision": true
    }
  ],
  "total": 6,
  "limit": 20,
  "offset": 0
}
```

---

### Update Provider
```
PATCH /forge/providers/:id
```
**Auth Required:** Yes

**Request Body:** (all optional)
```json
{
  "name": "Anthropic (Primary)",
  "base_url": "https://api.anthropic.com",
  "api_key": "sk-ant-new-key",
  "is_enabled": true,
  "config": { "timeout": 30000 }
}
```

**Response:**
```json
{ "provider": { ... } }
```

---

### Provider Health (Cached)
```
GET /forge/providers/health
```
**Auth Required:** Yes
Returns cached health status.

**Response:**
```json
{
  "status": "healthy",
  "providers": [
    { "id": "01PROV001", "name": "Anthropic", "status": "healthy", "latencyMs": 234 }
  ]
}
```

---

### Provider Health Check (Live)
```
POST /forge/providers/health-check
```
**Auth Required:** Yes
Runs live connectivity checks against all providers.

**Response:** Same as `GET /forge/providers/health`

---

## User Providers

Per-user API keys for LLM providers (BYOK).

### List User Provider Keys
```
GET /forge/user-providers
```
**Auth Required:** Yes
Returns keys with values masked.

**Response:**
```json
{
  "keys": [
    {
      "id": "01UKEY001",
      "provider_type": "anthropic",
      "label": "Personal key",
      "api_key": "sk-ant-****",
      "verified": true
    }
  ]
}
```

---

### Set Provider Key
```
PUT /forge/user-providers/:providerType
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "api_key": "sk-ant-realkey123",
  "label": "My personal Anthropic key"
}
```

**Response:**
```json
{ "key": { "id": "01UKEY002", "provider_type": "anthropic", "verified": false } }
```

---

### Remove Provider Key
```
DELETE /forge/user-providers/:providerType
```
**Auth Required:** Yes

**Response:**
```json
{ "ok": true }
```

---

### Verify Provider Key
```
POST /forge/user-providers/:providerType/verify
```
**Auth Required:** Yes
Sends a test request to validate the key.

**Response:**
```json
{ "status": "valid" }
```

**Error Response:**
```json
{ "status": "invalid", "error": "Unauthorized: Invalid API key" }
```

---

## Preferences

User preference storage with LLM-readable context.

### List Preferences
```
GET /forge/preferences
```
**Auth Required:** Yes

**Response:**
```json
{
  "preferences": [
    {
      "id": "01PREF001",
      "category": "communication",
      "key": "response_style",
      "value": "concise",
      "confidence": 0.9
    }
  ]
}
```

---

### Set Preference
```
PUT /forge/preferences
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "category": "communication",
  "key": "response_style",
  "value": "concise"
}
```

**Response:**
```json
{ "ok": true, "category": "communication", "key": "response_style" }
```

---

### Remove Preference
```
DELETE /forge/preferences/:id
```
**Auth Required:** Yes

**Response:**
```json
{ "ok": true }
```

---

### Get Prompt Context
```
GET /forge/preferences/prompt-context
```
**Auth Required:** Yes
Returns preferences formatted as a string for injection into agent prompts.

**Response:**
```json
{
  "context": "User preferences:\n- Response style: concise\n- Timezone: UTC\n- Code language: TypeScript"
}
```

---

### Record Observed Preference
```
POST /forge/preferences/learn
```
**Auth Required:** Yes
Records an inferred preference from observed behavior.

**Request Body:**
```json
{
  "user_id": "01USER001",
  "category": "formatting",
  "key": "prefers_tables",
  "value": true,
  "confidence": 0.75
}
```

**Response:**
```json
{ "ok": true }
```

---

## Devices

Manage server-managed devices for remote agent execution.

### List Devices
```
GET /forge/devices
```
**Auth Required:** Yes

**Response:**
```json
{
  "devices": [
    {
      "id": "01DEV001",
      "deviceName": "Production Server",
      "deviceType": "linux",
      "status": "online",
      "hostname": "prod-01.example.com"
    }
  ]
}
```

---

### Get Device
```
GET /forge/devices/:id
```
**Auth Required:** Yes

---

### Register Device
```
POST /forge/devices
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "deviceName": "Dev Laptop",
  "deviceType": "macos",
  "connectionConfig": { "host": "dev.example.com", "port": 22 },
  "hostname": "dev.example.com"
}
```

**Response:**
```json
{ "device": { "id": "01DEV002", ... } }
```

---

### Update Device Config
```
PUT /forge/devices/:id/config
```
**Auth Required:** Yes

**Request Body:**
```json
{ "connectionConfig": { "host": "new-host.example.com", "port": 22 } }
```

**Response:**
```json
{ "device": { ... } }
```

---

### Test Device
```
POST /forge/devices/:id/test
```
**Auth Required:** Yes

**Response:** Connection test result with latency and status.

---

### Remove Device
```
DELETE /forge/devices/:id
```
**Auth Required:** Yes

**Response:**
```json
{ "deleted": true }
```

---

### Disconnect Device
```
POST /forge/devices/:id/disconnect
```
**Auth Required:** Yes

**Response:**
```json
{ "disconnected": true }
```

---

### Device Summary
```
GET /forge/devices/summary
```
**Auth Required:** Yes

**Response:**
```json
{
  "total": 5,
  "online": 3,
  "busy": 1,
  "offline": 1,
  "byType": { "linux": 3, "macos": 2 }
}
```

---

## User Budget

### Get Budget
```
GET /forge/user-budget
```
**Auth Required:** Yes

**Response:**
```json
{
  "budgetLimitDaily": 10.00,
  "budgetLimitMonthly": 200.00,
  "spentToday": 1.45,
  "spentThisMonth": 32.10
}
```

---

### Update Budget Limits
```
PUT /forge/user-budget
```
**Auth Required:** Yes

**Request Body:** (at least one required)
```json
{
  "budgetLimitDaily": 15.00,
  "budgetLimitMonthly": 300.00
}
```

**Response:**
```json
{
  "success": true,
  "budgetLimitDaily": 15.00,
  "budgetLimitMonthly": 300.00
}
```

---

## Onboarding

### Check Onboarding Status
```
GET /forge/onboarding/status
```
**Auth Required:** Yes

**Response:**
```json
{
  "completed": false,
  "hasAnthropicKey": true
}
```

---

### Complete Onboarding
```
POST /forge/onboarding/complete
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "workspace_name": "My Team",
  "theme": "dark"
}
```

**Response:**
```json
{ "success": true }
```

---

### Save API Key During Onboarding
```
POST /forge/onboarding/api-key
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "key": "sk-ant-api03-...",
  "provider": "anthropic"
}
```

**Response:**
```json
{
  "success": true,
  "provider": "anthropic",
  "envName": "ANTHROPIC_API_KEY"
}
```

---

## Clients & Projects

Revenue Mode client management for billing and invoicing.

### List Clients
```
GET /forge/clients
```
**Auth Required:** Yes

**Response:**
```json
{
  "clients": [
    {
      "id": "01CLIENT001",
      "name": "Acme Corp",
      "email": "billing@acme.com",
      "company": "Acme Corporation",
      "billing_rate_hourly": 150.00,
      "billing_markup": 1.20,
      "active": true
    }
  ]
}
```

---

### Create Client
```
POST /forge/clients
```
**Auth Required:** Yes

**Request Body:**
```json
{
  "name": "Acme Corp",
  "email": "billing@acme.com",
  "company": "Acme Corporation",
  "billing_rate_hourly": 150.00,
  "billing_markup": 1.20,
  "notes": "Prefers weekly invoices"
}
```

**Response:**
```json
{ "id": "01CLIENT002", "name": "Acme Corp" }
```

---

### Update Client
```
PUT /forge/clients/:id
```
**Auth Required:** Yes

**Request Body:** (all optional)
**Response:** `{ "ok": true }`

---

### Archive Client
```
DELETE /forge/clients/:id
```
**Auth Required:** Yes
**Response:** `{ "ok": true }`

---

### List Projects
```
GET /forge/clients/:clientId/projects
```
**Auth Required:** Yes

**Response:**
```json
{ "projects": [ { "id": "01PROJ001", "name": "Website Redesign", "active": true } ] }
```

---

### Create Project
```
POST /forge/clients/:clientId/projects
```
**Auth Required:** Yes

**Request Body:**
```json
{ "name": "Website Redesign", "description": "Full redesign of acme.com" }
```

**Response:**
```json
{ "id": "01PROJ002", "name": "Website Redesign" }
```

---

## Integrations

OAuth-based external service integrations.

### List Integrations
```
GET /integrations
```
**Auth Required:** Yes

**Response:**
```json
{
  "integrations": [
    {
      "id": "01INT001",
      "provider": "github",
      "status": "connected",
      "connectedAt": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

---

### Start OAuth Integration
```
GET /integrations/connect/:provider
```
**Auth Required:** Yes
Redirects the browser to the provider's OAuth authorization page.

**Supported providers:** `github`, `gitlab`, `slack`, `linear`, `notion`

---

### OAuth Callback
```
GET /integrations/connect/:provider/callback
```
**Auth Required:** No (OAuth callback)
Handles OAuth return, saves tokens, and redirects to dashboard.

**Query Parameters:** `code`, `state`

---

### Disconnect Integration
```
POST /integrations/:id/disconnect
```
**Auth Required:** Yes

**Response:**
```json
{ "disconnected": true }
```

---

## Git Review

### List Branches
```
GET /git/branches
```
**Auth Required:** Yes

**Response:**
```json
{
  "branches": [
    { "name": "main", "lastCommit": "abc1234", "author": "Jane", "updatedAt": "..." },
    { "name": "feature/auth-fix", "lastCommit": "def5678", "author": "John", "updatedAt": "..." }
  ]
}
```

---

### Get Diff
```
GET /git/diff
```
**Auth Required:** Yes
Returns diff content up to 100KB.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base` | string | Yes | Base branch/commit |
| `head` | string | Yes | Head branch/commit |

**Response:**
```json
{ "diff": "diff --git a/src/auth.ts b/src/auth.ts\n+++ ..." }
```

---

### Merge Branches
```
POST /git/merge
```
**Auth Required:** Yes
Merges `head` into `base` after validation.

**Request Body:**
```json
{
  "base": "main",
  "head": "feature/auth-fix"
}
```

**Response:**
```json
{ "success": true, "merged": "feature/auth-fix → main" }
```

---

## Daemons

Daemon agents run continuously, dispatching executions on a schedule or event loop.

### List Daemons
```
GET /forge/daemons
```
**Auth Required:** Yes

**Response:**
```json
{
  "daemons": [
    {
      "agentId": "01AGENT123",
      "name": "Watchdog",
      "status": "active",
      "dispatchEnabled": true
    }
  ],
  "dispatcher_status": "running",
  "active_count": 5,
  "total": 6
}
```

---

### Get Daemon
```
GET /forge/daemons/:agentId
```
**Auth Required:** Yes

---

### Start Daemon
```
POST /forge/daemons/:agentId/start
```
**Auth Required:** Yes
Enables agent dispatch (marks daemon as active).

**Response:**
```json
{ "status": "started", "agentId": "01AGENT123" }
```

---

### Stop Daemon
```
POST /forge/daemons/:agentId/stop
```
**Auth Required:** Yes

**Response:**
```json
{ "status": "stopped", "agentId": "01AGENT123" }
```

---

## Assistant & Terminal

### Send Message to Assistant
```
POST /forge/assistant/message
```
**Auth Required:** Yes
Sends a message to the user's personal AI assistant agent.

**Request Body:**
```json
{
  "message": "What did my agents do today?",
  "context": { "timezone": "UTC" }
}
```

**Response:**
```json
{
  "execution": {
    "id": "01EXEC900",
    "status": "running",
    "startedAt": "2026-03-21T07:00:00.000Z"
  }
}
```

---

### Terminal Message
```
POST /forge/terminal/message
```
**Auth Required:** Yes
Sends a message to an interactive terminal backed by Claude. Supports SSE streaming.

**Request Body:**
```json
{ "message": "Show me the last 10 executions" }
```

**Response (sync):**
```json
{ "response": "Here are the last 10 executions: ..." }
```

**Response (streaming):** SSE stream of text chunks.

---

## Webhooks

### Trigger Agent via Webhook
```
POST /forge/webhooks/:agentId/trigger
```
**Auth Required:** Optional (secret-based)
Triggers an agent execution from an external webhook. If the agent has a `webhook_secret` configured, the `secret` parameter must match.

**Request Body:**
```json
{
  "input": "Process this order",
  "payload": { "orderId": "ORD-123", "amount": 99.99 },
  "secret": "webhook-secret-if-configured"
}
```

**Response:**
```json
{
  "executionId": "01EXEC901",
  "status": "running"
}
```

---

## Admin

Admin endpoints require both authentication and admin role (`requireAdmin` middleware).

### Get Cost Report
```
GET /forge/admin/costs
```
**Auth Required:** Yes + Admin

**Query Parameters:** `startDate`, `endDate`, `agentId`, `days`

**Response:**
```json
{
  "summary": {
    "totalCost": 145.32,
    "totalExecutions": 1247,
    "avgCostPerExecution": 0.117
  },
  "dailyCosts": [
    { "date": "2026-03-21", "cost": 4.32, "executions": 38 }
  ]
}
```

---

### Get Audit Log
```
GET /forge/admin/audit
```
**Auth Required:** Yes + Admin

**Query Parameters:** `action`, `resourceType`, `limit`, `offset`

**Response:**
```json
{
  "entries": [
    {
      "id": "01AUDIT001",
      "action": "agent.delete",
      "resourceType": "agent",
      "resourceId": "01AGENT123",
      "userId": "01USER001",
      "createdAt": "2026-03-21T06:52:00.000Z"
    }
  ],
  "total": 500
}
```

---

### List Guardrails
```
GET /forge/admin/guardrails
```
**Auth Required:** Yes + Admin

**Query Parameters:** `type`, `enabled`, `limit`, `offset`

**Response:**
```json
{
  "guardrails": [
    {
      "id": "01GUARD001",
      "name": "No PII in outputs",
      "type": "output_filter",
      "isEnabled": true,
      "isGlobal": true,
      "priority": 100
    }
  ],
  "total": 8
}
```

---

### Create Guardrail
```
POST /forge/admin/guardrails
```
**Auth Required:** Yes + Admin

**Request Body:**
```json
{
  "name": "Block external API calls",
  "description": "Prevents agents from calling external APIs",
  "type": "tool_restriction",
  "config": { "blockedTools": ["web_fetch", "web_search"] },
  "isGlobal": false,
  "agentIds": ["01AGENT123"],
  "priority": 50
}
```

**Response:**
```json
{ "guardrail": { "id": "01GUARD002", ... } }
```

---

### Update Guardrail
```
PUT /forge/admin/guardrails/:id
```
**Auth Required:** Yes + Admin

**Request Body:** (all optional)
```json
{
  "name": "Updated Name",
  "config": { ... },
  "isEnabled": false,
  "priority": 75
}
```

---

### Delete Guardrail
```
DELETE /forge/admin/guardrails/:id
```
**Auth Required:** Yes + Admin

**Response:** `204 No Content`

### List Proposals
```
GET /forge/admin/proposals
```
**Auth Required:** Yes

**Query Parameters:** `status`, `proposalType`, `authorAgentId`, `limit`, `offset`

**Response:**
```json
{
  "proposals": [
    {
      "id": "01PROP001",
      "title": "Merge feature/auth-fix",
      "proposalType": "code_merge",
      "status": "pending",
      "authorAgentId": "01AGENT123",
      "createdAt": "..."
    }
  ]
}
```

---

## Platform Admin

All platform admin endpoints are prefixed with `/api/v1/platform-admin/` and require **authentication + admin role**.

### Agents
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/agents` | List all platform agents |
| `POST` | `/platform-admin/agents` | Create platform agent |
| `PUT` | `/platform-admin/agents/:id` | Update platform agent |
| `DELETE` | `/platform-admin/agents/:id` | Remove platform agent |

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/analytics/overview` | Fleet analytics overview |
| `GET` | `/platform-admin/analytics/agents` | Per-agent analytics |
| `GET` | `/platform-admin/analytics/costs` | Cost breakdown analytics |

### Briefing
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/briefing` | Daily fleet briefing |

### Checkpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/checkpoints` | List pending checkpoints (human-in-the-loop) |
| `POST` | `/platform-admin/checkpoints/:id/approve` | Approve checkpoint |
| `POST` | `/platform-admin/checkpoints/:id/reject` | Reject checkpoint |

### Coordination
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/coordination/active` | Active multi-agent coordination tasks |
| `GET` | `/platform-admin/coordination/history` | Coordination history |

### Costs
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/costs/summary` | Cost summary with recommendations |
| `GET` | `/platform-admin/costs/agents` | Per-agent cost breakdown |
| `GET` | `/platform-admin/costs/trends` | Cost trends over time |

### Executions
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/executions` | All platform executions |
| `GET` | `/platform-admin/executions/running` | Currently running executions |
| `GET` | `/platform-admin/executions/failed` | Recent failed executions |

### Memory
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/memory/stats` | Memory analytics across fleet |
| `GET` | `/platform-admin/memory/search` | Search all fleet memory |
| `DELETE` | `/platform-admin/memory/:id` | Delete memory entry |

### Orchestration
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/orchestration/status` | Orchestration engine status |
| `POST` | `/platform-admin/orchestration/pause` | Pause orchestration |
| `POST` | `/platform-admin/orchestration/resume` | Resume orchestration |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/reports` | List generated reports |
| `POST` | `/platform-admin/reports/generate` | Generate a new report |
| `GET` | `/platform-admin/reports/:id/export` | Export report (CSV/PDF) |

### Scheduling
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/scheduling/status` | Scheduler status |
| `GET` | `/platform-admin/scheduling/schedules` | List agent schedules |
| `POST` | `/platform-admin/scheduling/schedules` | Create schedule |
| `DELETE` | `/platform-admin/scheduling/schedules/:id` | Delete schedule |

### System
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/system/health` | Full system health |
| `GET` | `/platform-admin/system/config` | Platform configuration |
| `PUT` | `/platform-admin/system/config` | Update platform config |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/tasks` | List all tasks |
| `POST` | `/platform-admin/tasks` | Create task |
| `PUT` | `/platform-admin/tasks/:id` | Update task |

### Templates (Admin)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/templates` | List all templates |
| `POST` | `/platform-admin/templates` | Create template |
| `PUT` | `/platform-admin/templates/:id` | Update template |
| `DELETE` | `/platform-admin/templates/:id` | Delete template |

### Tickets
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/platform-admin/tickets` | List all tickets |
| `POST` | `/platform-admin/tickets` | Create ticket |
| `PUT` | `/platform-admin/tickets/:id` | Update ticket |
| `GET` | `/platform-admin/tickets/:id` | Get ticket details |

---

## Public Endpoints

These endpoints do not require authentication.

### Public Intent Parser
```
POST /public/intent
```
**Auth Required:** No
**Rate Limited:** 10 requests per minute per IP
Demo endpoint for the public landing page.

**Request Body:**
```json
{ "message": "I need an agent to monitor my GitHub PRs" }
```

**Response:**
```json
{
  "enhanced": "Monitor GitHub pull requests for reviews and CI status",
  "category": "development",
  "summary": "Automated PR monitoring agent",
  "agents": [
    { "name": "PR Monitor", "description": "Watches for new PRs and notifies on status changes" }
  ]
}
```

---

### Report Client-Side Error
```
POST /errors/report
```
**Auth Required:** No

**Request Body:**
```json
{
  "message": "Cannot read properties of undefined",
  "stack": "TypeError: ...",
  "componentStack": "at Dashboard ...",
  "url": "https://app.askalf.ai/dashboard",
  "userAgent": "Mozilla/5.0 ..."
}
```

**Response:** `201 Created` with `{ "ok": true }`

---

### CSP Violation Report
```
POST /csp-report
```
**Auth Required:** No
Receives Content-Security-Policy violation reports from browsers.

**Response:** `204 No Content`

---

## Error Codes

All error responses follow this format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad Request — invalid input, missing required fields, validation failure |
| `401` | Unauthorized — missing or invalid authentication token/API key |
| `403` | Forbidden — authenticated but lacks permission (e.g., non-admin accessing admin route) |
| `404` | Not Found — resource does not exist or has been deleted |
| `409` | Conflict — resource already exists (e.g., duplicate slug on marketplace publish) |
| `422` | Unprocessable Entity — request is well-formed but semantically invalid |
| `429` | Too Many Requests — rate limit exceeded |
| `500` | Internal Server Error — unexpected server-side error |
| `503` | Service Unavailable — upstream dependency unavailable (e.g., LLM provider down) |

### Common Error Codes

| Code | Description |
|------|-------------|
| `AGENT_NOT_FOUND` | Agent ID does not exist or was deleted |
| `EXECUTION_NOT_FOUND` | Execution ID does not exist |
| `EXECUTION_NOT_RUNNING` | Cannot cancel an execution that is not in `running` state |
| `BUDGET_EXCEEDED` | Daily or monthly budget limit reached |
| `PROVIDER_UNAVAILABLE` | LLM provider returned an error or is unreachable |
| `INVALID_API_KEY` | API key is invalid, expired, or revoked |
| `CHANNEL_CONFIG_NOT_FOUND` | Channel config ID does not exist |
| `INVALID_WEBHOOK_SIGNATURE` | Webhook signature verification failed |
| `TRIGGER_NOT_FOUND` | Trigger ID does not exist |
| `TEMPLATE_NOT_FOUND` | Template ID does not exist |
| `PACKAGE_NOT_FOUND` | Marketplace package slug does not exist |
| `RATE_LIMIT_EXCEEDED` | Too many requests from this IP or API key |
| `OAUTH_NOT_CONNECTED` | OAuth flow has not been completed |
| `TOKEN_EXPIRED` | OAuth token has expired and could not be refreshed |
| `ADMIN_REQUIRED` | Endpoint requires admin role |

---

*Generated 2026-03-21. For issues, create a ticket in the AskAlf platform.*
