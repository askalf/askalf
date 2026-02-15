/**
 * Ask Alf API Client
 * Handles communication with the Ask Alf service.
 */

const API_BASE = '';

export interface AskAlfConversation {
  id: string;
  title: string | null;
  default_provider: string | null;
  default_model: string | null;
  message_count: number;
  updated_at: string;
}

export interface AskAlfMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  model: string | null;
  tokens_used: number;
  classified: boolean;
  created_at: string;
}

export interface AskAlfCredential {
  provider: string;
  last4: string | null;
  created_at: string;
}

export interface AskAlfPreferences {
  default_provider: string;
  default_model: string | null;
}

export interface ProviderInfo {
  name: string;
  models: string[];
  defaultModel: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || `API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function useAskAlfApi() {
  return {
    // Conversations
    async fetchConversations(): Promise<AskAlfConversation[]> {
      const data = await apiFetch<{ conversations: AskAlfConversation[] }>('/api/v1/askalf/conversations');
      return data.conversations;
    },

    async createConversation(): Promise<{ id: string; welcome: string }> {
      return apiFetch<{ id: string; welcome: string }>('/api/v1/askalf/conversations', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    async fetchMessages(conversationId: string): Promise<AskAlfMessage[]> {
      const data = await apiFetch<{ messages: AskAlfMessage[] }>(`/api/v1/askalf/conversations/${conversationId}/messages`);
      return data.messages;
    },

    async renameConversation(conversationId: string, title: string): Promise<{ id: string; title: string }> {
      return apiFetch<{ id: string; title: string }>(`/api/v1/askalf/conversations/${conversationId}`, {
        method: 'PUT',
        body: JSON.stringify({ title }),
      });
    },

    async deleteConversation(conversationId: string): Promise<void> {
      await apiFetch(`/api/v1/askalf/conversations/${conversationId}`, { method: 'DELETE' });
    },

    // Credentials
    async fetchCredentials(): Promise<AskAlfCredential[]> {
      const data = await apiFetch<{ credentials: AskAlfCredential[] }>('/api/v1/askalf/credentials');
      return data.credentials;
    },

    async saveCredential(provider: string, value: string): Promise<{ last4: string }> {
      return apiFetch<{ provider: string; last4: string }>('/api/v1/askalf/credentials', {
        method: 'POST',
        body: JSON.stringify({ provider, value }),
      });
    },

    async deleteCredential(provider: string): Promise<void> {
      await apiFetch(`/api/v1/askalf/credentials/${provider}`, { method: 'DELETE' });
    },

    // Preferences
    async fetchPreferences(): Promise<AskAlfPreferences> {
      const data = await apiFetch<{ preferences: AskAlfPreferences }>('/api/v1/askalf/preferences');
      return data.preferences;
    },

    async updatePreferences(prefs: { defaultProvider?: string; defaultModel?: string }): Promise<AskAlfPreferences> {
      const data = await apiFetch<{ preferences: AskAlfPreferences }>('/api/v1/askalf/preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
      return data.preferences;
    },

    // Providers
    async fetchProviders(): Promise<Record<string, ProviderInfo>> {
      const data = await apiFetch<{ providers: Record<string, ProviderInfo> }>('/api/v1/askalf/providers');
      return data.providers;
    },

    // SSE Chat URL
    getChatUrl(): string {
      return `${API_BASE}/api/v1/askalf/chat`;
    },
  };
}
