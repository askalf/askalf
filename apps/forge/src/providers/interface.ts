/**
 * Provider Adapter Interface & Shared Types
 * Defines the contract that all LLM provider adapters must implement.
 */

export interface CompletionRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    name?: string;
    /** Tool calls attached to assistant messages for proper reconstruction */
    tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }>;
  model: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  finishReason: 'stop' | 'tool_use' | 'max_tokens' | 'error';
  model: string;
  provider: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done' | 'error';
  content?: string;
  toolCall?: Partial<ToolCall>;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutput?: number;
}

/** A single request within a batch, identified by a custom ID. */
export interface BatchRequest {
  customId: string;
  request: CompletionRequest;
}

/** A single result from a completed batch. */
export interface BatchResult {
  customId: string;
  response?: CompletionResponse;
  error?: string;
}

/** Status of a batch job. */
export interface BatchStatus {
  batchId: string;
  status: 'in_progress' | 'ended' | 'canceling' | 'canceled' | 'expired';
  totalRequests: number;
  completedRequests: number;
  results?: BatchResult[];
}

export interface IProviderAdapter {
  /** Human-readable provider name (e.g. "anthropic", "openai") */
  name: string;

  /** Provider type identifier (e.g. "anthropic", "openai", "google", "ollama", "custom") */
  type: string;

  /** Initialize the adapter with provider-specific configuration. */
  initialize(config: Record<string, unknown>): Promise<void>;

  /** Send a completion request and return the full response. */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** Stream a completion request, yielding chunks as they arrive. */
  stream(request: CompletionRequest): AsyncIterable<StreamChunk>;

  /** Submit a batch of requests (50% cost reduction, async processing). */
  submitBatch?(requests: BatchRequest[]): Promise<string>;

  /** Check the status of a batch and retrieve results when complete. */
  getBatchStatus?(batchId: string): Promise<BatchStatus>;

  /** Generate an embedding vector for the given text. */
  embed(text: string, model?: string): Promise<number[]>;

  /** Check whether the provider is reachable and healthy. */
  isHealthy(): Promise<boolean>;

  /** List available models from this provider. */
  listModels(): Promise<ModelInfo[]>;
}
