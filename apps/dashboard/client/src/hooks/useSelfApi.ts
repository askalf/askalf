/**
 * Self API Client
 * Handles communication with the Self service.
 */

// Use relative URLs — nginx proxies /api/v1/self/ to the self service
const API_BASE = '';

export interface Conversation {
  id: string;
  title: string | null;
  summary: string | null;
  message_count: number;
  updated_at: string;
}

export interface SelfMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls: unknown[];
  actions: SelfAction[];
  created_at: string;
}

export interface SelfAction {
  type: 'connect' | 'credential';
  provider?: string;
  status?: string;
  url?: string;
}

export interface Connection {
  provider: string;
  status: string;
  profile_data: Record<string, unknown>;
  connected_at: string;
  last_sync_at: string | null;
}

export interface Credential {
  provider: string;
  credential_type: string;
  last4: string | null;
  status: string;
  created_at: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || `API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function useSelfApi() {
  return {
    // Conversations
    async fetchConversations(): Promise<Conversation[]> {
      const data = await apiFetch<{ conversations: Conversation[] }>('/api/v1/self/conversations');
      return data.conversations;
    },

    async createConversation(): Promise<{ id: string; welcome: string }> {
      return apiFetch<{ id: string; welcome: string }>('/api/v1/self/conversations', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    async fetchMessages(conversationId: string): Promise<SelfMessage[]> {
      const data = await apiFetch<{ messages: SelfMessage[] }>(`/api/v1/self/conversations/${conversationId}/messages`);
      return data.messages;
    },

    async deleteConversation(conversationId: string): Promise<void> {
      await apiFetch(`/api/v1/self/conversations/${conversationId}`, { method: 'DELETE' });
    },

    // Connections
    async fetchConnections(): Promise<Connection[]> {
      const data = await apiFetch<{ connections: Connection[] }>('/api/v1/self/connections');
      return data.connections;
    },

    async getAuthUrl(provider: string): Promise<string> {
      const data = await apiFetch<{ authUrl: string }>(`/api/v1/self/connections/${provider}/auth`);
      return data.authUrl;
    },

    async disconnectProvider(provider: string): Promise<void> {
      await apiFetch(`/api/v1/self/connections/${provider}`, { method: 'DELETE' });
    },

    // Credentials
    async fetchCredentials(): Promise<Credential[]> {
      const data = await apiFetch<{ credentials: Credential[] }>('/api/v1/self/credentials');
      return data.credentials;
    },

    async saveCredential(provider: string, credentialType: string, value: string): Promise<{ last4: string }> {
      return apiFetch<{ provider: string; last4: string; status: string }>('/api/v1/self/credentials', {
        method: 'POST',
        body: JSON.stringify({ provider, credentialType, value }),
      });
    },

    async deleteCredential(provider: string): Promise<void> {
      await apiFetch(`/api/v1/self/credentials/${provider}`, { method: 'DELETE' });
    },

    // SSE Chat URL (used by store for streaming)
    getChatUrl(): string {
      return `${API_BASE}/api/v1/self/chat`;
    },
  };
}
