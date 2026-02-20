# Forge API Endpoints Documentation

Complete API reference for all Forge endpoints. All endpoints require authentication via `authMiddleware`.

## Table of Contents
1. [Agent Management](#agent-management)
2. [Executions](#executions)
3. [Sessions](#sessions)
4. [Personal Assistant](#personal-assistant)
5. [Git Review & Deployment](#git-review--deployment)
6. [Coordination](#coordination)

---

## Agent Management

### POST /api/v1/forge/agents
Create a new agent.

**Authentication:** Required
**Method:** POST

**Request Body:**
```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "systemPrompt": "string (optional, default: 'You are a helpful assistant.')",
  "modelId": "string (optional)",
  "providerConfig": {
    "temperature": "number (optional, default: 0.7)",
    "maxTokens": "number (optional, default: 4096)",
    "[key]": "any"
  },
  "autonomyLevel": "number (optional, default: 2)",
  "enabledTools": "string[] (optional)",
  "mcpServers": "unknown[] (optional)",
  "memoryConfig": {
    "enableWorking": "boolean (optional, default: true)",
    "enableSemantic": "boolean (optional, default: false)",
    "enableEpisodic": "boolean (optional, default: false)",
    "enableProcedural": "boolean (optional, default: false)",
    "semanticSearchK": "number (optional, default: 5)"
  },
  "maxIterations": "number (optional, default: 10)",
  "maxTokensPerTurn": "number (optional, default: 8192)",
  "maxCostPerExecution": "number (optional, default: 1.0)",
  "isPublic": "boolean (optional, default: false)",
  "isTemplate": "boolean (optional, default: false)",
  "metadata": "Record<string, unknown> (optional)"
}
```

**Response (201 Created):**
```json
{
  "agent": {
    "id": "string (ULID)",
    "owner_id": "string",
    "name": "string",
    "slug": "string",
    "description": "string | null",
    "system_prompt": "string",
    "model_id": "string | null",
    "provider_config": "Record<string, unknown>",
    "autonomy_level": "number",
    "enabled_tools": "string[]",
    "mcp_servers": "unknown[]",
    "memory_config": "Record<string, unknown>",
    "max_iterations": "number",
    "max_tokens_per_turn": "number",
    "max_cost_per_execution": "string",
    "is_public": "boolean",
    "is_template": "boolean",
    "forked_from": "string | null",
    "version": "number",
    "status": "string",
    "metadata": "Record<string, unknown>",
    "created_at": "ISO8601",
    "updated_at": "ISO8601"
  }
}
```

**Error Responses:**
- 400: Invalid agent name
- 500: Internal server error

---

### GET /api/v1/forge/agents
List agents for the authenticated owner.

**Authentication:** Required
**Method:** GET

**Query Parameters:**
- `status` (optional): Filter by agent status (e.g., "draft", "active", "archived")
- `search` (optional): Search in agent name and description (ILIKE)
- `limit` (optional, default: 50, max: 100): Results per page
- `offset` (optional, default: 0): Pagination offset

**Response (200 OK):**
```json
{
  "agents": [ /* Agent objects */ ],
  "total": "number",
  "limit": "number",
  "offset": "number"
}
```

---

### GET /api/v1/forge/agents/:id
Get a single agent by ID. Returns if owned by user or is public.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `id` (URL): Agent ID

**Response (200 OK):**
```json
{
  "agent": { /* Agent object */ }
}
```

**Error Responses:**
- 404: Agent not found

---

### PUT /api/v1/forge/agents/:id
Update an agent. Only accessible by owner.

**Authentication:** Required
**Method:** PUT

**Parameters:**
- `id` (URL): Agent ID

**Request Body:** (all fields optional)
```json
{
  "name": "string",
  "description": "string",
  "systemPrompt": "string",
  "modelId": "string",
  "providerConfig": "Record<string, unknown>",
  "autonomyLevel": "number",
  "enabledTools": "string[]",
  "mcpServers": "unknown[]",
  "memoryConfig": "Record<string, unknown>",
  "maxIterations": "number",
  "maxTokensPerTurn": "number",
  "maxCostPerExecution": "number",
  "isPublic": "boolean",
  "isTemplate": "boolean",
  "status": "string",
  "metadata": "Record<string, unknown>"
}
```

**Response (200 OK):**
```json
{
  "agent": { /* Updated Agent object */ }
}
```

**Error Responses:**
- 400: No fields to update
- 404: Agent not found or not owned by user
- 500: Internal server error

---

### DELETE /api/v1/forge/agents/:id
Soft delete (archive) an agent. Only accessible by owner.

**Authentication:** Required
**Method:** DELETE

**Parameters:**
- `id` (URL): Agent ID

**Response (200 OK):**
```json
{
  "message": "Agent archived successfully",
  "agent": {
    "id": "string",
    "name": "string",
    "status": "archived"
  }
}
```

**Error Responses:**
- 404: Agent not found or not owned by user

---

### POST /api/v1/forge/agents/:id/fork
Fork an existing agent. Creates a copy owned by the authenticated user.

**Authentication:** Required
**Method:** POST

**Parameters:**
- `id` (URL): Source agent ID

**Request Body:**
```json
{
  "name": "string (optional, default: '{sourceAgentName} (fork)')"
}
```

**Response (201 Created):**
```json
{
  "agent": { /* Forked Agent object with forked_from and metadata set */ }
}
```

**Error Responses:**
- 404: Agent not found or not accessible
- 500: Internal server error

---

## Executions

### POST /api/v1/forge/executions
Start an agent execution.

**Authentication:** Required
**Method:** POST

**Request Body:**
```json
{
  "agentId": "string (required)",
  "input": "string (required)",
  "sessionId": "string (optional)",
  "metadata": "Record<string, unknown> (optional)"
}
```

**Response (201 Created):**
```json
{
  "execution": {
    "id": "string (ULID)",
    "agent_id": "string",
    "session_id": "string | null",
    "owner_id": "string",
    "status": "pending",
    "input": "string",
    "output": "string | null",
    "messages": "unknown[]",
    "tool_calls": "unknown[]",
    "iterations": "number",
    "input_tokens": "number",
    "output_tokens": "number",
    "total_tokens": "number",
    "cost": "string",
    "duration_ms": "number | null",
    "error": "string | null",
    "metadata": "Record<string, unknown>",
    "started_at": "ISO8601 | null",
    "completed_at": "ISO8601 | null",
    "created_at": "ISO8601"
  }
}
```

**Error Responses:**
- 400: Missing agentId or input, or archived agent
- 403: Blocked by guardrails
- 404: Agent not found
- 500: Internal server error

**Execution Flow:** Starts async execution in the background and returns immediately.

---

### GET /api/v1/forge/executions/:id
Get execution details.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `id` (URL): Execution ID

**Response (200 OK):**
```json
{
  "execution": { /* Execution object */ }
}
```

**Error Responses:**
- 404: Execution not found

---

### GET /api/v1/forge/executions/:id/stream
Server-Sent Events (SSE) stream for real-time execution updates.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `id` (URL): Execution ID

**Response Headers:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

**Event Types:**
- `status`: Initial execution status
- `done`: Execution completed (if already done)
- Heartbeat events every 15 seconds (if still running)

**Response Format (SSE):**
```
data: {"type":"status","executionId":"...","status":"pending"}
data: {"type":"done","executionId":"...","status":"completed"}
```

**Error Responses:**
- 404: Execution not found

---

### GET /api/v1/forge/executions
List executions for the owner.

**Authentication:** Required
**Method:** GET

**Query Parameters:**
- `agentId` (optional): Filter by agent ID
- `sessionId` (optional): Filter by session ID
- `status` (optional): Filter by execution status
- `limit` (optional, default: 50, max: 100): Results per page
- `offset` (optional, default: 0): Pagination offset

**Response (200 OK):**
```json
{
  "executions": [ /* Execution objects */ ],
  "total": "number",
  "limit": "number",
  "offset": "number"
}
```

---

### POST /api/v1/forge/executions/batch
Run multiple agents in batch mode (50% cost reduction via Anthropic Batches API).

**Authentication:** Required
**Method:** POST

**Request Body:**
```json
{
  "agents": [
    {
      "agentId": "string (required)",
      "input": "string (required)"
    }
  ]
}
```

**Constraints:**
- `agents` array: 1-20 entries per request
- Executes via Anthropic Batches API for cost reduction

**Response (202 Accepted):**
```json
{
  "message": "Batch execution started",
  "agentCount": "number",
  "mode": "batch",
  "costReduction": "50%"
}
```

**Error Responses:**
- 400: Invalid agents array or too many agents (max 20)

**Execution Flow:** Starts async batch processing and returns immediately.

---

## Sessions

### POST /api/v1/forge/sessions
Create a new conversation session.

**Authentication:** Required
**Method:** POST

**Request Body:**
```json
{
  "agentId": "string (required)",
  "title": "string (optional)",
  "metadata": "Record<string, unknown> (optional)"
}
```

**Response (201 Created):**
```json
{
  "session": {
    "id": "string (ULID)",
    "agent_id": "string",
    "owner_id": "string",
    "title": "string | null",
    "metadata": "Record<string, unknown>",
    "is_active": "boolean (true)",
    "created_at": "ISO8601",
    "updated_at": "ISO8601"
  }
}
```

**Error Responses:**
- 400: Missing agentId
- 404: Agent not found or not accessible
- 500: Internal server error

---

### GET /api/v1/forge/sessions
List sessions for the owner.

**Authentication:** Required
**Method:** GET

**Query Parameters:**
- `agentId` (optional): Filter by agent ID
- `active` (optional): Filter by active status ("true" or "false")
- `limit` (optional, default: 50, max: 100): Results per page
- `offset` (optional, default: 0): Pagination offset

**Response (200 OK):**
```json
{
  "sessions": [ /* Session objects */ ],
  "total": "number",
  "limit": "number",
  "offset": "number"
}
```

---

### GET /api/v1/forge/sessions/:id
Get session details with message history (executions).

**Authentication:** Required
**Method:** GET

**Parameters:**
- `id` (URL): Session ID

**Response (200 OK):**
```json
{
  "session": { /* Session object */ },
  "executions": [ /* Execution objects in this session, ordered by created_at ASC */ ]
}
```

**Error Responses:**
- 404: Session not found

---

### POST /api/v1/forge/sessions/:id/messages
Send a message to an active session (creates an execution).

**Authentication:** Required
**Method:** POST

**Parameters:**
- `id` (URL): Session ID

**Request Body:**
```json
{
  "message": "string (required, non-empty)",
  "metadata": "Record<string, unknown> (optional)"
}
```

**Response (201 Created):**
```json
{
  "execution": { /* Execution object (status: 'pending') */ }
}
```

**Error Responses:**
- 400: Missing/empty message, session not active, or agent archived
- 403: Blocked by guardrails
- 404: Session not found
- 500: Internal server error

**Execution Flow:** Starts async execution in the background and returns immediately.

---

### DELETE /api/v1/forge/sessions/:id
Deactivate a session.

**Authentication:** Required
**Method:** DELETE

**Parameters:**
- `id` (URL): Session ID

**Response (200 OK):**
```json
{
  "message": "Session deactivated",
  "session": {
    "id": "string",
    "isActive": "boolean (false)"
  }
}
```

**Error Responses:**
- 404: Session not found

---

## Personal Assistant

### POST /api/v1/forge/assistant/message
Send a message to the user's personal assistant (auto-creates if needed).

**Authentication:** Required
**Method:** POST

**Request Body:**
```json
{
  "message": "string (required, non-empty)",
  "context": "Record<string, unknown> (optional)"
}
```

**Response (201 Created):**
```json
{
  "execution": { /* Execution object */ },
  "assistant": {
    "id": "string",
    "agentId": "string",
    "agentName": "string"
  }
}
```

**Auto-Creation:** If no personal assistant exists for the user, one is created automatically with:
- Agent name: "Personal Assistant"
- Default system prompt: "You are a helpful personal assistant..."
- Metadata: `{"autoCreated": true}`

**Error Responses:**
- 400: Missing/empty message
- 403: Blocked by guardrails
- 500: Internal server error

---

## Git Review & Deployment

### GET /api/v1/forge/git/branches
List agent/* branches with metadata (cached 30s).

**Authentication:** Required
**Method:** GET

**Query Parameters:**
- `refresh` (optional): Set to any value to bypass cache

**Response (200 OK):**
```json
{
  "branches": [
    {
      "name": "string (branch name)",
      "agent_slug": "string",
      "commits": "number (commits ahead of main)",
      "files_changed": "number",
      "last_date": "ISO8601 | null",
      "author": "string | null"
    }
  ]
}
```

**Error Responses:**
- 500: Failed to list branches

**Performance:** Results are cached for 30 seconds to reduce git subprocess overhead.

---

### GET /api/v1/forge/git/diff/:branch
Get unified diff of main..<branch> (max 100KB).

**Authentication:** Required
**Method:** GET

**Parameters:**
- `branch` (URL, encoded): Branch name (must start with "agent/")

**Response (200 OK):**
```json
{
  "branch": "string",
  "diff": "string (unified diff, max 100KB)",
  "truncated": "boolean",
  "stats": {
    "files": "number",
    "additions": "number",
    "deletions": "number"
  }
}
```

**Error Responses:**
- 400: Branch doesn't start with "agent/"
- 500: Failed to get diff

---

### GET /api/v1/forge/git/log/:branch
Get commit log for a branch (last 50 commits diverged from main).

**Authentication:** Required
**Method:** GET

**Parameters:**
- `branch` (URL, encoded): Branch name (must start with "agent/")

**Response (200 OK):**
```json
{
  "branch": "string",
  "commits": [
    {
      "hash": "string (commit SHA)",
      "subject": "string (commit message)",
      "author": "string",
      "date": "ISO8601"
    }
  ]
}
```

**Error Responses:**
- 400: Branch doesn't start with "agent/"
- 500: Failed to get log

---

### GET /api/v1/forge/git/files/:branch
List changed files with addition/deletion counts.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `branch` (URL, encoded): Branch name (must start with "agent/")

**Response (200 OK):**
```json
{
  "branch": "string",
  "files": [
    {
      "path": "string",
      "additions": "number",
      "deletions": "number"
    }
  ]
}
```

**Error Responses:**
- 400: Branch doesn't start with "agent/"
- 500: Failed to get file stats

---

### POST /api/v1/forge/git/merge
Merge an agent/* branch into main.

**Authentication:** Required
**Method:** POST

**Request Body:**
```json
{
  "branch": "string (required, must start with 'agent/')"
}
```

**Response (200 OK):**
```json
{
  "success": "boolean",
  "merge_commit": "string (commit SHA)",
  "message": "string"
}
```

**Error Responses:**
- 400: Invalid branch name
- 409: Merge conflict detected
- 500: Failed to merge or checkout main

**Note:** Uses `--no-ff` flag to preserve merge commits.

---

### GET /api/v1/forge/git/health/:service
Get Docker container health status.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `service` (URL): Service name (alphanumeric, hyphen, underscore only)

**Response (200 OK):**
```json
{
  "service": "string",
  "container": "string (container name)",
  "running": "boolean",
  "status": "string",
  "started_at": "ISO8601 | null",
  "health": "string | null"
}
```

**Unreachable Response:**
```json
{
  "service": "string",
  "container": "string",
  "running": false,
  "status": "unreachable",
  "started_at": null,
  "health": null,
  "error": "string"
}
```

---

### POST /api/v1/forge/git/deploy
Restart Docker containers (protected services excluded).

**Authentication:** Required
**Method:** POST

**Protected Services:** postgres, redis, pgbouncer, cloudflared (cannot be restarted)

**Request Body:**
```json
{
  "services": ["string"] (required, non-empty array)
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "results": [
    {
      "service": "string",
      "status": "restarted" | "failed",
      "error": "string (if failed)"
    }
  ]
}
```

**Error Responses:**
- 400: Invalid services array or protected services included

---

### POST /api/v1/forge/git/rebuild
Start a rebuild or restart of Docker services.

**Authentication:** Required
**Method:** POST

**Protected Services:** postgres, redis, pgbouncer, cloudflared (cannot be restarted)

**Request Body:**
```json
{
  "services": ["string"] (required, non-empty array),
  "action": "rebuild" | "restart" (required),
  "task_id": "string (optional)"
}
```

**For action="restart":**

**Response (200 OK):**
```json
{
  "action": "restart",
  "results": [
    {
      "service": "string",
      "status": "restarted" | "failed",
      "error": "string (if failed)"
    }
  ],
  "task_id": "string | null"
}
```

**For action="rebuild":**

**Response (200 OK):**
```json
{
  "action": "rebuild",
  "builder_id": "string (ephemeral container ID)",
  "services": ["string"],
  "task_id": "string | null",
  "message": "string"
}
```

**Error Responses:**
- 400: Invalid services array or protected services included
- 500: Failed to create/start builder container

**Note:** Rebuild uses ephemeral docker:27-cli container to execute docker compose build + up.

---

### GET /api/v1/forge/git/rebuild/:builderId
Poll rebuild progress and get logs.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `builderId` (URL): Builder container ID

**While Running:**
```json
{
  "status": "running",
  "exit_code": null,
  "logs": "string (last 100 lines)"
}
```

**After Completion:**
```json
{
  "status": "completed" | "failed",
  "exit_code": "number",
  "logs": "string"
}
```

**Error Responses:**
- 500: Failed to inspect builder container

**Note:** Builder container is automatically cleaned up after completion.

---

## Coordination

### POST /api/v1/forge/coordination/sessions
Start a multi-agent team session.

**Authentication:** Required
**Method:** POST

**Request Body:**
```json
{
  "leadAgentId": "string (required)",
  "leadAgentName": "string (optional, default: 'Unknown')",
  "title": "string (required)",
  "pattern": "pipeline" | "fan-out" | "consensus" (required),
  "tasks": [
    {
      "title": "string (required)",
      "description": "string (required)",
      "agentName": "string (required)",
      "dependencies": ["string"] (optional, task titles)
    }
  ]
}
```

**Pattern Definitions:**
- `pipeline`: Tasks execute sequentially (A → B → C)
- `fan-out`: Tasks execute in parallel
- `consensus`: Tasks execute in parallel, then synthesizer merges results

**Response (201 Created):**
```json
{
  "session": {
    "id": "string",
    "planId": "string",
    "status": "active",
    "plan": {
      "id": "string",
      "title": "string",
      "pattern": "string",
      "tasks": [ /* task objects with status */ ]
    }
  }
}
```

**Error Responses:**
- 400: Missing required fields or invalid pattern
- 503: Team coordination not available
- 500: Coordination error

---

### GET /api/v1/forge/coordination/sessions
List all team sessions.

**Authentication:** Required
**Method:** GET

**Response (200 OK):**
```json
{
  "sessions": [
    {
      "id": "string",
      "planId": "string",
      "status": "active" | "completed" | "failed",
      "leadAgentId": "string",
      "title": "string"
    }
  ]
}
```

**Error Responses:**
- 503: Team coordination not available

---

### GET /api/v1/forge/coordination/sessions/:id
Get session details with plan.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `id` (URL): Session ID

**Response (200 OK):**
```json
{
  "session": {
    "id": "string",
    "planId": "string",
    "status": "string",
    "plan": { /* detailed plan with task status */ }
  }
}
```

**Error Responses:**
- 404: Session not found
- 503: Team coordination not available

---

### POST /api/v1/forge/coordination/sessions/:id/cancel
Cancel an active session.

**Authentication:** Required
**Method:** POST

**Parameters:**
- `id` (URL): Session ID

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- 503: Team coordination not available

---

### GET /api/v1/forge/coordination/plans
List all coordination plans (derived from sessions).

**Authentication:** Required
**Method:** GET

**Response (200 OK):**
```json
{
  "plans": [ /* plan objects */ ]
}
```

**Error Responses:**
- 503: Team coordination not available

---

### GET /api/v1/forge/coordination/plans/:id
Get a specific plan.

**Authentication:** Required
**Method:** GET

**Parameters:**
- `id` (URL): Plan ID

**Response (200 OK):**
```json
{
  "plan": {
    "id": "string",
    "title": "string",
    "pattern": "string",
    "tasks": [ /* task objects */ ]
  }
}
```

**Error Responses:**
- 404: Plan not found
- 503: Team coordination not available

---

### GET /api/v1/forge/coordination/stats
Get coordination statistics.

**Authentication:** Required
**Method:** GET

**Response (200 OK):**
```json
{
  "totalSessions": "number",
  "activeSessions": "number",
  "completedSessions": "number",
  "failedSessions": "number",
  "totalTasks": "number",
  "tasksByStatus": {
    "[status]": "number"
  }
}
```

**Error Responses:**
- 503: Team coordination not available

---

## Common Patterns

### Authentication
All endpoints require authentication via the `authMiddleware`. The authenticated user ID is available as `request.userId`.

### Pagination
List endpoints support:
- `limit`: Maximum 100, default 50
- `offset`: Pagination offset, default 0

### Timestamps
All ISO8601 timestamps use UTC timezone.

### Error Response Format
```json
{
  "error": "string (error type)",
  "message": "string (detailed message)",
  "detail": "string (optional, additional details)"
}
```

### Async Operations
Some endpoints (executions, batch executions, rebuilds) execute asynchronously:
- Return 201 or 202 status immediately
- Client should poll or stream status separately
- Results are eventually consistent

### Guardrails
Execution endpoints respect guardrail checks:
- Cost limits per execution
- Rate limiting
- Content policy checks
- Returns 403 Forbidden if blocked

---

## Data Types

### Agent Status
- `draft`: Initial state
- `active`: Ready for execution
- `archived`: Soft-deleted

### Execution Status
- `pending`: Created, awaiting execution
- `running`: Currently executing
- `completed`: Finished successfully
- `failed`: Execution error

### Session Status
- `active`: Accepting messages
- `inactive`: Deactivated (is_active=false)

---

Generated: 2026-02-13
Last Updated: All Forge API endpoints documented
