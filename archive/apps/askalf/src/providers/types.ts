/**
 * LLM Provider Interface
 * Shared abstraction for all AI providers (Claude, OpenAI, etc.)
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamParams {
  model: string;
  messages: ChatMessage[];
  onToken: (text: string) => void;
  signal?: AbortSignal;
}

export interface StreamResult {
  totalTokens: number;
}

export interface LLMProvider {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
  streamChat(apiKey: string, params: StreamParams): Promise<StreamResult>;
}

export interface ProviderChoice {
  provider: string;
  model: string;
  classified: boolean;
}
