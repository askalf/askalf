/**
 * Shared TypeBox schemas for Fastify route validation + OpenAPI docs.
 * Used by @fastify/swagger to auto-generate request/response documentation.
 */
import { Type, type Static } from '@sinclair/typebox';

// ── Common ──────────────────────────────────────────────────────────

export const ErrorResponse = Type.Object({
  error: Type.String(),
  message: Type.String(),
});
export type ErrorResponseType = Static<typeof ErrorResponse>;

export const IdParam = Type.Object({
  id: Type.String({ description: 'Resource ULID' }),
});

export const PaginationQuery = Type.Object({
  limit: Type.Optional(Type.String({ description: 'Max results (default 50, max 100)' })),
  offset: Type.Optional(Type.String({ description: 'Result offset (default 0)' })),
});

// ── Agents ──────────────────────────────────────────────────────────

export const CreateAgentBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100, description: 'Agent name' }),
  description: Type.Optional(Type.String({ maxLength: 2048 })),
  systemPrompt: Type.Optional(Type.String({ maxLength: 10240 })),
  modelId: Type.Optional(Type.String()),
  providerConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  autonomyLevel: Type.Optional(Type.Number({ minimum: 0, maximum: 5 })),
  enabledTools: Type.Optional(Type.Array(Type.String())),
  mcpServers: Type.Optional(Type.Array(Type.Unknown())),
  memoryConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  maxIterations: Type.Optional(Type.Number({ minimum: 1 })),
  maxTokensPerTurn: Type.Optional(Type.Number({ minimum: 1 })),
  maxCostPerExecution: Type.Optional(Type.Number({ minimum: 0 })),
  isPublic: Type.Optional(Type.Boolean()),
  isTemplate: Type.Optional(Type.Boolean()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ListAgentsQuery = Type.Intersect([
  PaginationQuery,
  Type.Object({
    status: Type.Optional(Type.String({ description: 'Filter by status' })),
    search: Type.Optional(Type.String({ description: 'Search name/description' })),
  }),
]);

export const AgentResponse = Type.Object({
  id: Type.String(),
  owner_id: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  system_prompt: Type.String(),
  model_id: Type.Union([Type.String(), Type.Null()]),
  provider_config: Type.Record(Type.String(), Type.Unknown()),
  autonomy_level: Type.Number(),
  enabled_tools: Type.Array(Type.String()),
  mcp_servers: Type.Array(Type.Unknown()),
  memory_config: Type.Record(Type.String(), Type.Unknown()),
  max_iterations: Type.Number(),
  max_tokens_per_turn: Type.Number(),
  max_cost_per_execution: Type.String(),
  is_public: Type.Boolean(),
  is_template: Type.Boolean(),
  forked_from: Type.Union([Type.String(), Type.Null()]),
  version: Type.Number(),
  status: Type.String(),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const UpdateAgentBody = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  description: Type.Optional(Type.String({ maxLength: 2048 })),
  systemPrompt: Type.Optional(Type.String({ maxLength: 10240 })),
  modelId: Type.Optional(Type.String()),
  providerConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  autonomyLevel: Type.Optional(Type.Number({ minimum: 0, maximum: 5 })),
  enabledTools: Type.Optional(Type.Array(Type.String())),
  mcpServers: Type.Optional(Type.Array(Type.Unknown())),
  memoryConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  maxIterations: Type.Optional(Type.Number({ minimum: 1 })),
  maxTokensPerTurn: Type.Optional(Type.Number({ minimum: 1 })),
  maxCostPerExecution: Type.Optional(Type.Number({ minimum: 0 })),
  isPublic: Type.Optional(Type.Boolean()),
  isTemplate: Type.Optional(Type.Boolean()),
  status: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('active'), Type.Literal('paused'), Type.Literal('archived')])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const OptimizePromptBody = Type.Object({
  prompt: Type.String({ minLength: 1, description: 'System prompt to optimize' }),
  name: Type.Optional(Type.String({ description: 'Agent name for context' })),
  type: Type.Optional(Type.String({ description: 'Agent type for context' })),
  description: Type.Optional(Type.String({ description: 'Agent description for context' })),
});

export const ForkAgentBody = Type.Object({
  name: Type.Optional(Type.String({ description: 'Name for the forked agent' })),
});

// ── Executions ──────────────────────────────────────────────────────

export const CreateExecutionBody = Type.Object({
  agentId: Type.String({ description: 'Agent to execute' }),
  input: Type.String({ minLength: 1, maxLength: 102400, description: 'Input prompt' }),
  sessionId: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ListExecutionsQuery = Type.Intersect([
  PaginationQuery,
  Type.Object({
    agentId: Type.Optional(Type.String({ description: 'Filter by agent' })),
    sessionId: Type.Optional(Type.String({ description: 'Filter by session' })),
    status: Type.Optional(Type.String({ description: 'Filter by status' })),
  }),
]);

export const ExecutionResponse = Type.Object({
  id: Type.String(),
  agent_id: Type.String(),
  session_id: Type.Union([Type.String(), Type.Null()]),
  owner_id: Type.String(),
  status: Type.String(),
  input: Type.String(),
  output: Type.Union([Type.String(), Type.Null()]),
  iterations: Type.Number(),
  input_tokens: Type.Number(),
  output_tokens: Type.Number(),
  total_tokens: Type.Number(),
  cost: Type.String(),
  duration_ms: Type.Union([Type.Number(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  started_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  completed_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  created_at: Type.String({ format: 'date-time' }),
});

export const BatchExecutionBody = Type.Object({
  agents: Type.Array(
    Type.Object({
      agentId: Type.String({ description: 'Agent to execute' }),
      input: Type.String({ maxLength: 102400, description: 'Input prompt' }),
    }),
    { minItems: 1, maxItems: 20, description: 'Array of agent execution requests' },
  ),
});

// ── Sessions ────────────────────────────────────────────────────────

export const CreateSessionBody = Type.Object({
  agentId: Type.String({ description: 'Agent to bind to session' }),
  title: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ListSessionsQuery = Type.Intersect([
  PaginationQuery,
  Type.Object({
    agentId: Type.Optional(Type.String({ description: 'Filter by agent' })),
    active: Type.Optional(Type.String({ description: 'Filter by active status (true/false)' })),
  }),
]);

export const SessionResponse = Type.Object({
  id: Type.String(),
  agent_id: Type.String(),
  owner_id: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  is_active: Type.Boolean(),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const SendMessageBody = Type.Object({
  message: Type.String({ minLength: 1, description: 'Message content' }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

// ── Checkpoints ────────────────────────────────────────────────────

export const ListCheckpointsQuery = Type.Object({
  owner_id: Type.Optional(Type.String({ description: 'Filter by owner' })),
  status: Type.Optional(Type.String({ description: 'Filter by status (default: pending)' })),
  limit: Type.Optional(Type.String({ description: 'Max results (default 50, max 200)' })),
});

export const CheckpointResponse = Type.Object({
  id: Type.String(),
  workflowRunId: Type.Union([Type.String(), Type.Null()]),
  executionId: Type.Union([Type.String(), Type.Null()]),
  ownerId: Type.String(),
  type: Type.String(),
  title: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  context: Type.Record(Type.String(), Type.Unknown()),
  response: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  status: Type.String(),
  timeoutAt: Type.Union([Type.String(), Type.Null()]),
  respondedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const RespondCheckpointBody = Type.Object({
  response: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  status: Type.Optional(Type.Union([Type.Literal('approved'), Type.Literal('rejected')])),
});
