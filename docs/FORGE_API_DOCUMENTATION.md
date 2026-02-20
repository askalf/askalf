# Forge API Documentation

**Version**: 1.0.0
**Framework**: Fastify.js
**Database**: PostgreSQL
**Authentication**: User ID via middleware
**Date Generated**: 2026-02-13

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Request/Response Format](#requestresponse-format)
4. [Agent Routes](#agent-routes)
5. [Execution Routes](#execution-routes)
6. [Session Routes](#session-routes)
7. [Workflow Routes](#workflow-routes)
8. [Tool Routes](#tool-routes)
9. [Memory Routes](#memory-routes)
10. [Provider Routes](#provider-routes)
11. [Admin Routes](#admin-routes)
12. [Assistant Routes](#assistant-routes)
13. [Webhook Routes](#webhook-routes)
14. [Coordination Routes](#coordination-routes)
15. [Health Check](#health-check)
16. [Error Handling](#error-handling)
17. [Rate Limiting](#rate-limiting)

---

## Overview

The Forge API provides comprehensive endpoints for managing AI agents, executing tasks, tracking sessions, managing workflows, and accessing cognitive memory. All endpoints return JSON responses and support standard HTTP methods (GET, POST, PUT, DELETE).

**Base URLs**:
- Production: `https://api.askalf.org/api/v1/forge`
- Internal: `http://api:3000/api/v1/forge`

---

## Authentication

All endpoints except `/health` and webhook triggers require authentication via the `authMiddleware`.

**Authentication Method**: Request context extraction
- User ID is extracted from `request.userId` in the FastifyRequest context
- Invalid or missing auth returns `401 Unauthorized`

**Example Protected Endpoint Request**:
```bash
curl -X GET https://api.askalf.org/api/v1/forge/agents \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Request/Response Format

### Standard Response Format

**Success Response (2xx)**:
```json
{
  "id": "string",
  "status": "success|pending|running|completed|failed",
  "data": {},
  "timestamp": "2026-02-13T12:00:00Z"
}
```

**Error Response (4xx/5xx)**:
```json
{
  "error": "Error Type",
  "message": "Human-readable error description",
  "code": "ERROR_CODE",
  "timestamp": "2026-02-13T12:00:00Z"
}
```

### Pagination

Query parameters for paginated endpoints:
- `limit` (integer, max 500): Number of results per page
- `offset` (integer, default 0): Number of records to skip

---

## Agent Routes

### POST /api/v1/forge/agents
**Create a new agent**

**Authentication**: Required
**Rate Limit**: Standard (100 req/min per IP)

**Request Body**:
```typescript
{
  name: string;                              // Required, non-empty
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  providerConfig?: Record<string, unknown>;
  autonomyLevel?: number;                    // 0-5, default 1
  enabledTools?: string[];                   // Array of tool names
  mcpServers?: unknown[];                    // MCP server configs
  memoryConfig?: Record<string, unknown>;    // Semantic/episodic/procedural
  maxIterations?: number;                    // Default 10
  maxTokensPerTurn?: number;                 // Default 4096
  maxCostPerExecution?: number;              // Cost limit in USD
  isPublic?: boolean;                        // Default false
  isTemplate?: boolean;                      // Default false
  metadata?: Record<string, unknown>;
}
```

**Response** (201):
```typescript
{
  id: string;                  // ULID
  owner_id: string;
  name: string;
  slug: string;                // URL-safe slug, auto-generated
  description: string | null;
  system_prompt: string;
  model_id: string | null;
  provider_config: Record<string, unknown>;
  autonomy_level: number;
  enabled_tools: string[];
  mcp_servers: unknown[];
  memory_config: Record<string, unknown>;
  max_iterations: number;
  max_tokens_per_turn: number;
  max_cost_per_execution: string;
  is_public: boolean;
  is_template: boolean;
  forked_from: string | null;
  version: number;
  status: string;              // 'active' | 'archived' | 'disabled'
  metadata: Record<string, unknown>;
  created_at: string;          // ISO 8601
  updated_at: string;
}
```

**Validation Errors** (400):
- `name` is required and must not be empty
- Returns: `{ error: 'Validation Error', message: 'Agent name is required' }`

---

### GET /api/v1/forge/agents
**List agents for authenticated user**

**Authentication**: Required
**Query Parameters**:
- `limit` (integer, default 50, max 500)
- `offset` (integer, default 0)
- `status` (string): Filter by status ('active', 'archived', 'disabled')
- `isTemplate` (boolean): Filter templates only
- `isPublic` (boolean): Filter public agents

**Response** (200):
```typescript
{
  agents: AgentRow[];
  total: number;
  limit: number;
  offset: number;
}
```

---

### GET /api/v1/forge/agents/:id
**Get single agent details**

**Authentication**: Required
**Parameters**:
- `id` (string, ULID): Agent ID

**Response** (200): AgentRow (see POST response)

**Error** (404): Agent not found or access denied

---

### PUT /api/v1/forge/agents/:id
**Update agent configuration**

**Authentication**: Required
**Parameters**: `id` (string, ULID)

**Request Body**: Partial AgentRow (all fields optional)

**Response** (200): Updated AgentRow with incremented version

**Access Control**: Only owner or admins can update

---

### DELETE /api/v1/forge/agents/:id
**Soft delete (archive) agent**

**Authentication**: Required
**Effect**: Sets status to 'archived', does not remove data

**Response** (200): `{ message: 'Agent archived' }`

---

### POST /api/v1/forge/agents/:id/fork
**Fork/clone an existing agent**

**Authentication**: Required
**Parameters**: `id` (string, ULID) - Source agent ID

**Request Body**:
```typescript
{
  name: string;         // Name for forked agent
  description?: string;
}
```

**Response** (201): New AgentRow with `forked_from` set to source ID

---

## Execution Routes

### POST /api/v1/forge/executions
**Start a new agent execution**

**Authentication**: Required
**Rate Limit**: Standard (100 req/min per IP)

**Request Body**:
```typescript
{
  agentId: string;           // Required, must exist and be accessible
  input: string;             // Required, agent input/prompt
  sessionId?: string;        // Optional, links to conversation session
  metadata?: Record<string, unknown>;
}
```

**Response** (202):
```typescript
{
  id: string;                // Execution ID (ULID)
  agent_id: string;
  session_id: string | null;
  owner_id: string;
  status: string;            // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  input: string;
  output: string | null;
  messages: unknown[];       // LLM messages from execution
  tool_calls: unknown[];     // Tools called during execution
  iterations: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: string;              // Cost in USD, decimal string
  duration_ms: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null; // ISO 8601
  completed_at: string | null;
  created_at: string;
}
```

**Validation Errors** (400):
- `agentId` and `input` are required
- Agent not found
- User lacks access to agent

**Cost Limit Errors** (402):
- Execution exceeds agent's `maxCostPerExecution`

---

### GET /api/v1/forge/executions/:id
**Get execution details**

**Authentication**: Required
**Parameters**: `id` (string, ULID)

**Response** (200): ExecutionRow (see POST response)

**Error** (404): Execution not found or access denied

---

### GET /api/v1/forge/executions/:id/stream
**SSE stream for real-time execution updates**

**Authentication**: Required
**Rate Limit**: Max 5 per IP, 50 total concurrent

**Connection Format**: Server-Sent Events (SSE)

**Event Types**:
```
event: status_change
data: {"status": "running", "timestamp": "2026-02-13T12:00:00Z"}

event: token
data: {"role": "assistant", "content": "response text"}

event: tool_call
data: {"tool": "name", "args": {}, "result": "..."}

event: complete
data: {"status": "completed", "output": "...", "duration_ms": 1234}

event: error
data: {"error": "error message"}
```

**Rate Limit Error** (429): `Too many SSE connections`

---

### GET /api/v1/forge/executions
**List executions (paginated)**

**Authentication**: Required
**Query Parameters**:
- `agentId` (string): Filter by agent
- `sessionId` (string): Filter by session
- `status` (string): Filter by status
- `limit` (integer, default 50, max 500)
- `offset` (integer, default 0)

**Response** (200):
```typescript
{
  executions: ExecutionRow[];
  total: number;
  limit: number;
  offset: number;
}
```

---

### GET /api/v1/forge/executions/stats
**Get execution counts by status**

**Authentication**: Required

**Response** (200):
```typescript
{
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}
```

---

### POST /api/v1/forge/executions/batch
**Run multiple agents in batch (50% cost reduction)**

**Authentication**: Required
**Rate Limit**: Standard (100 req/min per IP)

**Request Body**:
```typescript
{
  agents: Array<{
    agentId: string;    // Required
    input: string;      // Required
    metadata?: Record<string, unknown>;
  }>;
  // Max 20 agents per batch
}
```

**Response** (202):
```typescript
{
  batch_id: string;
  execution_ids: string[];
  total_agents: number;
  status: 'queued' | 'processing' | 'completed';
  timestamp: string;
}
```

---

## Session Routes

### POST /api/v1/forge/sessions
**Create a new conversation session**

**Authentication**: Required

**Request Body**:
```typescript
{
  agentId: string;        // Required, agent for this session
  title?: string;
  metadata?: Record<string, unknown>;
}
```

**Response** (201):
```typescript
{
  id: string;             // Session ID (ULID)
  agent_id: string;
  owner_id: string;
  title: string;
  is_active: boolean;     // true
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

---

### GET /api/v1/forge/sessions
**List sessions (paginated)**

**Authentication**: Required
**Query Parameters**:
- `agentId` (string): Filter by agent
- `active` (boolean): true/false
- `limit` (integer, default 50, max 100)
- `offset` (integer, default 0)

**Response** (200):
```typescript
{
  sessions: SessionRow[];
  total: number;
  limit: number;
  offset: number;
}
```

---

### GET /api/v1/forge/sessions/:id
**Get session with execution history**

**Authentication**: Required
**Parameters**: `id` (string, ULID)

**Response** (200):
```typescript
{
  session: SessionRow;
  executions: ExecutionRow[];  // All messages/executions in session
  execution_count: number;
}
```

---

### POST /api/v1/forge/sessions/:id/messages
**Send message (triggers execution)**

**Authentication**: Required
**Parameters**: `id` (string, ULID)

**Request Body**:
```typescript
{
  message: string;        // Required, user message
  metadata?: Record<string, unknown>;
}
```

**Response** (202): ExecutionRow (new execution started)

---

### DELETE /api/v1/forge/sessions/:id
**Deactivate session**

**Authentication**: Required
**Effect**: Sets `is_active` to false

**Response** (200): `{ message: 'Session deactivated' }`

---

## Workflow Routes

### POST /api/v1/forge/workflows
**Create multi-agent DAG workflow**

**Authentication**: Required

**Request Body**:
```typescript
{
  name: string;                          // Required
  description?: string;
  definition: {
    nodes: Array<{
      id: string;
      agentId: string;
      input?: string;
      parallelizable?: boolean;
    }>;
    edges: Array<{
      from: string;    // node id
      to: string;      // node id
      condition?: string;
    }>;
  };
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
}
```

**Response** (201): WorkflowRow

---

### GET /api/v1/forge/workflows
**List workflows (paginated)**

**Query Parameters**:
- `status` (string): 'draft', 'active', 'archived'
- `limit`, `offset`

**Response** (200): Paginated workflow list

---

### GET /api/v1/forge/workflows/:id
**Get workflow definition**

**Response** (200): WorkflowRow with full definition

---

### PUT /api/v1/forge/workflows/:id
**Update workflow**

**Request Body**: Partial workflow (name, description, definition, isPublic)

**Response** (200): Updated WorkflowRow

---

### POST /api/v1/forge/workflows/:id/run
**Start a workflow execution run**

**Request Body**:
```typescript
{
  input: Record<string, unknown>;  // Initial input for first nodes
  metadata?: Record<string, unknown>;
}
```

**Response** (202):
```typescript
{
  workflow_run_id: string;
  workflow_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  started_at: string;
}
```

---

### GET /api/v1/forge/workflow-runs/:id
**Get workflow run status**

**Response** (200):
```typescript
{
  id: string;
  workflow_id: string;
  status: string;
  results: Array<{
    node_id: string;
    execution_id: string;
    output: unknown;
  }>;
  duration_ms: number;
  completed_at: string | null;
}
```

---

## Tool Routes

### GET /api/v1/forge/tools
**List available tools (built-in and custom)**

**Query Parameters**:
- `type` (string): 'builtin', 'custom', 'mcp'
- `enabled` (boolean)
- `limit` (integer, max 200)
- `offset` (integer)

**Response** (200):
```typescript
{
  tools: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    type: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    inputSchema: unknown;      // JSON Schema
    outputSchema: unknown;
    isEnabled: boolean;
    requiresApproval: boolean;
  }>;
  total: number;
}
```

---

### POST /api/v1/forge/tools
**Register a custom tool**

**Request Body**:
```typescript
{
  name: string;              // Required, unique per user
  displayName: string;
  description: string;
  type: string;              // 'api', 'code', 'webhook'
  riskLevel: string;
  inputSchema: object;       // JSON Schema
  outputSchema: object;
  config: Record<string, unknown>;
  requiresApproval?: boolean;
}
```

**Response** (201): Created tool object

---

### POST /api/v1/forge/mcp/servers
**Register an MCP server**

**Request Body**:
```typescript
{
  name: string;
  description?: string;
  transportType: 'stdio' | 'sse' | 'streamable_http';
  connectionConfig: Record<string, unknown>;
}
```

**Response** (201): MCP server object with ID

---

### GET /api/v1/forge/mcp/servers
**List MCP servers for user**

**Response** (200):
```typescript
{
  servers: Array<{
    id: string;
    name: string;
    description: string;
    transportType: string;
    isConnected: boolean;
    discovered_tools_count: number;
  }>;
}
```

---

### POST /api/v1/forge/mcp/servers/:id/discover
**Discover tools from MCP server**

**Parameters**: `id` (string) - MCP server ID

**Response** (202):
```typescript
{
  discovery_id: string;
  server_id: string;
  status: 'discovering' | 'completed' | 'failed';
  tools_found: number;
}
```

---

## Memory Routes

### Fleet-Level Memory (Admin/System)

#### GET /api/v1/forge/memory/fleet/stats
**Fleet-wide memory statistics**

**Response** (200):
```typescript
{
  total_memories: number;
  by_tier: {
    semantic: number;
    episodic: number;
    procedural: number;
  };
  by_agent: Record<string, number>;
  memory_size_bytes: number;
}
```

---

#### GET /api/v1/forge/memory/fleet/recalls
**Recent memory recall events**

**Query Parameters**:
- `limit` (integer, default 50)
- `agent_id` (string)
- `dateFrom` (ISO 8601)
- `dateTo` (ISO 8601)

**Response** (200):
```typescript
{
  recalls: Array<{
    id: string;
    agent_id: string;
    query: string;
    matched_memories: number;
    timestamp: string;
  }>;
}
```

---

#### POST /api/v1/forge/memory/fleet/store
**Inject memory (semantic/episodic/procedural)**

**Request Body**:
```typescript
{
  type: 'semantic' | 'episodic' | 'procedural';  // Required
  agent_id?: string;
  // For semantic:
  content?: string;
  importance?: number;        // 0-1
  source?: string;
  // For episodic:
  situation?: string;
  action?: string;
  outcome?: string;
  quality?: number;           // 0-1 (1=success)
  execution_id?: string;
  // For procedural:
  trigger_pattern?: string;
  tool_sequence?: string[];
  confidence?: number;        // 0-1
}
```

**Response** (201): Created memory object with ID

---

#### GET /api/v1/forge/memory/fleet/search
**Search fleet memories across all agents**

**Query Parameters**:
- `q` (string): Search query
- `tier` (string): 'semantic'|'episodic'|'procedural'|'all'
- `agent_id` (string)
- `limit` (integer, default 10)
- `page` (integer, default 0)
- `source_type` (string)
- `dateFrom`, `dateTo` (ISO 8601)

**Response** (200):
```typescript
{
  results: Array<{
    id: string;
    type: string;
    agent_id: string;
    content: string;
    score: number;           // Relevance 0-1
    created_at: string;
  }>;
  total: number;
}
```

---

### Per-Agent Memory (User-Scoped)

#### GET /api/v1/forge/memory/:agentId/search
**Search specific agent's memories**

**Parameters**: `agentId` (string, ULID)

**Query Parameters**: Same as fleet search

**Response** (200): Same format as fleet search

---

#### POST /api/v1/forge/memory/:agentId/inject
**Inject memory into specific agent**

**Parameters**: `agentId` (string, ULID)

**Request Body**: Same as fleet store

**Response** (201): Created memory object

---

## Provider Routes

### GET /api/v1/forge/providers
**List configured AI providers**

**Response** (200):
```typescript
{
  providers: Array<{
    id: string;
    name: string;              // 'openai', 'anthropic', 'google', etc.
    type: string;
    is_configured: boolean;
    health_status: 'healthy' | 'degraded' | 'down';
    config: Record<string, unknown>;  // API keys never exposed
  }>;
}
```

---

### GET /api/v1/forge/providers/:id/models
**List models for a provider**

**Query Parameters**:
- `enabled` (boolean)
- `tools` (boolean): Supports tool calling
- `vision` (boolean): Supports vision input
- `reasoning` (boolean): Supports extended reasoning

**Response** (200):
```typescript
{
  models: Array<{
    id: string;
    name: string;
    provider: string;
    cost_input_per_mtok: number;
    cost_output_per_mtok: number;
    context_window: number;
    supports_tools: boolean;
    supports_vision: boolean;
    supports_reasoning: boolean;
    is_enabled: boolean;
  }>;
}
```

---

### GET /api/v1/forge/providers/health
**Check provider health status**

**Response** (200):
```typescript
{
  timestamp: string;
  providers: Record<string, {
    status: 'healthy' | 'degraded' | 'down';
    last_check: string;
    response_time_ms: number;
  }>;
}
```

---

## Admin Routes

### GET /api/v1/forge/admin/costs
**Cost tracking summary**

**Query Parameters**:
- `startDate` (ISO 8601)
- `endDate` (ISO 8601)
- `agentId` (string)
- `days` (integer, default 30)

**Response** (200):
```typescript
{
  total_cost: string;
  daily_breakdown: Array<{
    date: string;
    cost: string;
    executions: number;
  }>;
  by_agent: Record<string, string>;
}
```

---

### GET /api/v1/forge/admin/audit
**Audit log with filtering**

**Query Parameters**:
- `action` (string): 'create', 'update', 'delete', 'execute'
- `resourceType` (string): 'agent', 'execution', 'workflow'
- `limit` (integer)
- `offset` (integer)

**Response** (200):
```typescript
{
  entries: Array<{
    id: string;
    timestamp: string;
    action: string;
    resource_type: string;
    resource_id: string;
    user_id: string;
    changes: Record<string, [old: unknown, new: unknown]>;
    details: string;
  }>;
  total: number;
}
```

---

### POST /api/v1/forge/admin/guardrails
**Create/update guardrail policies**

**Request Body**:
```typescript
{
  name: string;
  description?: string;
  type: string;  // 'content_filter'|'cost_limit'|'rate_limit'|'tool_restriction'|'output_filter'|'custom'
  config: Record<string, unknown>;
  isEnabled: boolean;
  isGlobal: boolean;        // Apply to all agents
  agentIds?: string[];      // If !isGlobal
  priority: number;         // 0-100, higher = checked first
}
```

**Response** (201): Created guardrail

---

### GET /api/v1/forge/admin/guardrails
**List guardrails**

**Query Parameters**:
- `type` (string)
- `agentId` (string)
- `isGlobal` (boolean)

**Response** (200): Guardrail list

---

## Assistant Routes

### POST /api/v1/forge/assistant/message
**Send message to personal assistant**

**Request Body**:
```typescript
{
  message: string;           // Required
  context?: Record<string, unknown>;
}
```

**Response** (202): ExecutionRow

**Special Behavior**:
- Auto-creates personal assistant on first interaction
- Uses dedicated agent with limited context window

---

## Webhook Routes

### POST /api/v1/forge/webhooks/:agentId/trigger
**Trigger agent execution via webhook**

**Authentication**: Optional (webhook secret-based)

**Parameters**: `agentId` (string, ULID)

**Headers**:
- `X-Webhook-Secret` (string): Optional, for verification

**Request Body**:
```typescript
{
  input: string;              // Required
  payload?: Record<string, unknown>;
  secret?: string;            // Alternative to header
}
```

**Response** (202):
```typescript
{
  execution_id: string;
  agent_id: string;
  status: 'queued' | 'running';
  message: string;
}
```

**Requirements**:
- Agent must have `webhookSecret` configured OR `allowWebhooks: true`
- If secret provided, must match agent configuration

---

## Coordination Routes

### POST /api/v1/forge/coordination/sessions
**Start a team coordination session**

**Request Body**:
```typescript
{
  leadAgentId: string;
  leadAgentName: string;
  title: string;
  pattern: 'pipeline' | 'fan-out' | 'consensus';
  tasks: Array<{
    title: string;
    description: string;
    agentName: string;
    dependencies?: string[];  // Task titles that must complete first
  }>;
}
```

**Response** (202):
```typescript
{
  session_id: string;
  lead_agent_id: string;
  title: string;
  pattern: string;
  status: 'planning' | 'executing' | 'completed' | 'failed';
  plan: {
    tasks: Array<{
      title: string;
      description: string;
      agent_name: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      execution_id?: string;
      result?: unknown;
    }>;
  };
}
```

---

### GET /api/v1/forge/coordination/sessions
**List all team sessions**

**Query Parameters**:
- `pattern` (string)
- `status` (string)
- `limit`, `offset`

**Response** (200): Paginated session list

---

### GET /api/v1/forge/coordination/sessions/:id
**Get session with plan details**

**Parameters**: `id` (string)

**Response** (200): Full session with execution details

---

### POST /api/v1/forge/coordination/sessions/:id/cancel
**Cancel active session**

**Response** (200): `{ message: 'Session cancelled' }`

---

### GET /api/v1/forge/coordination/plans
**List coordination plans**

**Response** (200): List of all generated coordination plans

---

### GET /api/v1/forge/coordination/plans/:id
**Get specific plan**

**Response** (200): Plan with full details

---

### GET /api/v1/forge/coordination/stats
**Coordination statistics**

**Response** (200):
```typescript
{
  total_sessions: number;
  by_pattern: Record<string, number>;
  by_status: Record<string, number>;
  average_duration_ms: number;
  success_rate: number;
}
```

---

## Health Check

### GET /health
**Health status check (no auth required)**

**Response** (200):
```typescript
{
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: 'forge';
  version: '1.0.0';
  timestamp: string;  // ISO 8601
  details: {
    database: 'healthy' | 'down';
    redis: 'healthy' | 'down';
    providers: Record<string, 'healthy' | 'degraded' | 'down'>;
  };
}
```

---

## Error Handling

### Standard HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Agent retrieved successfully |
| 201 | Created | New agent created |
| 202 | Accepted | Execution queued (async operation) |
| 400 | Bad Request | Missing required field |
| 401 | Unauthorized | Invalid/missing auth token |
| 402 | Payment Required | Cost limit exceeded |
| 403 | Forbidden | Access denied to resource |
| 404 | Not Found | Agent/execution doesn't exist |
| 409 | Conflict | Slug collision, duplicate name |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Unexpected error |
| 503 | Service Unavailable | Database/provider down |

### Error Response Format

```json
{
  "error": "Error Type Name",
  "message": "Human-readable explanation",
  "code": "ERROR_CODE",
  "details": {
    "field": "field_name",
    "reason": "specific issue"
  }
}
```

### Common Errors

**400 - Validation Error**:
```json
{
  "error": "Validation Error",
  "message": "Agent name is required",
  "code": "VALIDATION_FAILED"
}
```

**401 - Unauthorized**:
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing authentication",
  "code": "AUTH_FAILED"
}
```

**404 - Not Found**:
```json
{
  "error": "Not Found",
  "message": "Agent with id 'xxx' not found",
  "code": "RESOURCE_NOT_FOUND"
}
```

**402 - Cost Limit Exceeded**:
```json
{
  "error": "Cost Limit Exceeded",
  "message": "Execution would cost $X, agent limit is $Y",
  "code": "COST_LIMIT_EXCEEDED",
  "details": {
    "estimated_cost": "0.50",
    "agent_limit": "0.25"
  }
}
```

**429 - Rate Limited**:
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded",
  "code": "RATE_LIMITED",
  "details": {
    "retry_after_seconds": 60
  }
}
```

---

## Rate Limiting

### Global Limits

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Standard API | 100 req/min | Per IP |
| SSE Streams | 5 per IP, 50 total | Per connection |
| Batch Executions | 100 req/min | Per IP |
| Webhook Triggers | 1000 req/min | Per webhook secret |

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1676294400
```

### Retry Strategy

When rate limited (429):
1. Check `Retry-After` header for seconds to wait
2. Implement exponential backoff (2, 4, 8, 16 seconds)
3. Max retries: 3

---

## Database Schema Notes

### Core Tables

- **forge_agents**: Agent configurations and metadata
- **forge_executions**: Execution history and results
- **forge_sessions**: Conversation sessions and message history
- **forge_workflows**: Workflow definitions and metadata
- **forge_workflow_runs**: Workflow execution instances
- **forge_tools**: Available tools and custom tool registrations
- **forge_mcp_servers**: MCP server connections
- **forge_memory**: Semantic, episodic, and procedural memories
- **forge_cost_events**: Detailed cost tracking
- **forge_audit_log**: All API actions and state changes
- **forge_guardrails**: Policy configurations

All records use ULID for IDs and ISO 8601 timestamps (UTC).

---

## Implementation Notes

### Architecture

- **Framework**: Fastify.js for high performance HTTP handling
- **Database**: PostgreSQL with typed query helpers
- **Authentication**: Middleware-based user context extraction
- **Observability**: Audit logging for all mutations, cost tracking
- **Rate Limiting**: In-memory state per IP for SSE connections
- **Error Handling**: Consistent error response format across endpoints

### Security

- API keys never exposed in responses
- Owner-based access control on all user resources
- Webhook secret verification optional but recommended
- Guardrail policies checked on execution (cost, rate limiting, content)
- CORS headers properly configured

### Performance

- Pagination enforced on all list endpoints
- Database indexes on owner_id, agent_id, status
- Redis caching for provider health and model lists
- SSE for real-time execution updates (avoids polling)
- Batch execution endpoint for cost savings (50% reduction)

---

## Example Workflows

### Create Agent and Execute

```bash
# 1. Create agent
curl -X POST https://api.askalf.org/api/v1/forge/agents \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Research Assistant",
    "description": "Performs web research and analysis",
    "systemPrompt": "You are a research assistant...",
    "modelId": "claude-opus-4-6",
    "enabledTools": ["web_search", "web_fetch"]
  }'
# Returns: {id: "...", ...}

# 2. Execute agent
curl -X POST https://api.askalf.org/api/v1/forge/executions \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "AGENT_ID",
    "input": "Research the latest AI developments in 2026"
  }'
# Returns: {id: "...", status: "pending"}

# 3. Stream results
curl -X GET "https://api.askalf.org/api/v1/forge/executions/EXEC_ID/stream" \
  -H "Authorization: Bearer TOKEN"
# Streams SSE events as execution progresses
```

### Create Multi-Agent Workflow

```bash
curl -X POST https://api.askalf.org/api/v1/forge/workflows \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Research and Analysis Pipeline",
    "definition": {
      "nodes": [
        {"id": "search", "agentId": "AGENT1"},
        {"id": "analyze", "agentId": "AGENT2"},
        {"id": "report", "agentId": "AGENT3"}
      ],
      "edges": [
        {"from": "search", "to": "analyze"},
        {"from": "analyze", "to": "report"}
      ]
    }
  }'
```

---

**Document Version**: 1.0.0
**Last Updated**: 2026-02-13
**Maintained By**: API Tester Agent
