import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Determine API base URL based on current hostname
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return ''; // Fallback to relative URLs
};

const API_BASE = getApiUrl();

export interface Model {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'ollama' | 'lmstudio' | 'auto';
  tier: 'fast' | 'standard' | 'reasoning' | 'vision' | 'local';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  isStreaming?: boolean;
  shardHit?: {
    shardId: string;
    shardName: string;
    knowledgeType?: 'immutable' | 'temporal' | 'contextual' | 'procedural';
    tokensSaved: number;
    waterSaved: number;
    powerSaved: number;
  };
  model?: string;
  provider?: string;
  // Performance & usage metadata
  responseMs?: number;
  tokensUsed?: number;
  intent?: {
    category: string;
    name: string;
  };
  // Smart Router metadata
  smartRouter?: {
    tier: 'nano' | 'pro' | 'reasoning' | 'local';
    selectedModel: string;
    provider: string;
    reason: string;
    confidence: number;
    complexity: number;
    analysisMs: number;
  };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

interface BillingStatus {
  suggestUpgrade: boolean;
  suggestBundle: boolean;
  usage: {
    dailyUsed: number;
    dailyLimit: number;
    bundleTokens: number;
    hasByok: boolean;
  };
  source: 'subscription' | 'bundle' | 'byok' | 'none';
}

interface ChatState {
  // Current conversation
  currentConversationId: string | null;
  messages: Message[];
  isLoading: boolean;

  // Track which conversation is being loaded (to prevent race conditions)
  loadingConversationId: string | null;

  // Conversations list
  conversations: Conversation[];
  conversationsLoaded: boolean;

  // Model selection
  selectedModel: string;
  selectedProvider: string;

  // Billing status
  billingStatus: BillingStatus | null;
  showBillingPrompt: boolean;

  // Environmental impact (session)
  sessionStats: {
    tokensSaved: number;
    waterSaved: number;
    powerSaved: number;
    shardHits: number;
  };

  // Actions
  sendMessage: (content: string) => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  createConversation: () => void;
  setCurrentConversation: (id: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  clearAllConversations: () => Promise<{ deleted: number }>;
  clearLocalState: () => void;
  setSelectedModel: (modelId: string) => void;
  setModel: (provider: string, model: string) => void;
  addShardHitStats: (stats: { tokensSaved: number; waterSaved: number; powerSaved: number }) => void;
  dismissBillingPrompt: () => void;
  updateBillingStatus: (status: BillingStatus) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      currentConversationId: null,
      messages: [],
      isLoading: false,
      loadingConversationId: null,
      conversations: [],
      conversationsLoaded: false,
      selectedModel: 'smart-router',
      selectedProvider: 'auto',
      billingStatus: null,
      showBillingPrompt: false,
      sessionStats: {
        tokensSaved: 0,
        waterSaved: 0,
        powerSaved: 0,
        shardHits: 0,
      },

  sendMessage: async (content: string) => {
    const { currentConversationId, selectedModel, selectedProvider, messages } = get();

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date(),
    };

    // Add placeholder assistant message
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: new Date(),
      isStreaming: true,
      model: selectedModel,
      provider: selectedProvider,
    };

    set({
      messages: [...messages, userMessage, assistantMessage],
      isLoading: true,
    });

    try {
      // Build messages array for chat completions API
      const chatMessages = [
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user', content },
      ];

      const res = await fetch(`${API_BASE}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: chatMessages,
          model: selectedModel,
          sessionId: currentConversationId,
          memory: true,
          autoExecuteShards: true,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));

        // Handle rate limit (429) - show billing prompt
        if (res.status === 429 && errorData.usage) {
          set({
            billingStatus: {
              suggestUpgrade: !!errorData.options?.upgrade,
              suggestBundle: !!errorData.options?.buyBundle,
              usage: {
                dailyUsed: errorData.usage.dailyUsed,
                dailyLimit: errorData.usage.dailyLimit,
                bundleTokens: errorData.usage.bundleTokens,
                hasByok: errorData.usage.hasByok,
              },
              source: 'none',
            },
            showBillingPrompt: true,
          });
        }

        throw new Error(errorData.error || 'Failed to send message');
      }

      const data = await res.json();

      // Extract response content from chat completions format
      const responseContent = data.choices?.[0]?.message?.content || data.response || '';

      // Extract metadata
      const usage = data.usage || data.choices?.[0]?.usage || {};
      const meta = data.meta || {};

      // Update assistant message with response and metadata
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === assistantMessage.id
            ? {
                ...m,
                content: responseContent,
                isStreaming: false,
                shardHit: data.shardHit,
                responseMs: meta.responseMs || data.responseMs,
                tokensUsed: usage.total_tokens || usage.completion_tokens || data.tokensUsed,
                intent: data.intent || meta.intent,
                model: data.model || m.model,
                provider: data.smartRouter?.provider || m.provider,
                smartRouter: data.smartRouter,
              }
            : m
        ),
        isLoading: false,
        currentConversationId: data.sessionId || state.currentConversationId,
      }));

      // If API created a new session, reload sidebar and update URL
      if (data.sessionId && !currentConversationId) {
        get().loadConversations();
        // Update URL to reflect the new conversation (enables refresh/bookmark)
        window.history.replaceState(null, '', `/app/chat/${data.sessionId}`);
      }

      // Update stats if shard hit
      if (data.shardHit) {
        get().addShardHitStats({
          tokensSaved: data.shardHit.tokensSaved,
          waterSaved: data.shardHit.waterSaved,
          powerSaved: data.shardHit.powerSaved,
        });
      }

      // Update billing status and show prompt if needed
      if (data.billingStatus) {
        const billing = data.billingStatus as BillingStatus;
        const shouldShowPrompt = billing.suggestUpgrade || billing.suggestBundle || billing.source === 'none';
        set({
          billingStatus: billing,
          showBillingPrompt: shouldShowPrompt,
        });
      }
    } catch (err) {
      // Remove failed assistant message
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== assistantMessage.id),
        isLoading: false,
      }));
      throw err;
    }
  },

  loadConversation: async (id: string) => {
    // Track which conversation we're loading to prevent race conditions
    set({ isLoading: true, loadingConversationId: id });
    try {
      const res = await fetch(`${API_BASE}/api/v1/conversations/${id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // Only update state if this is still the conversation we want
        // (user hasn't clicked on a different conversation while we were loading)
        if (get().loadingConversationId === id) {
          set({
            currentConversationId: id,
            messages: data.messages.map((m: Message & { createdAt: string }) => ({
              ...m,
              createdAt: new Date(m.createdAt),
            })),
            isLoading: false,
            loadingConversationId: null,
          });
        }
      } else {
        // Only clear loading if this is still the conversation we were loading
        if (get().loadingConversationId === id) {
          set({ isLoading: false, loadingConversationId: null });
        }
      }
    } catch {
      // Only clear loading if this is still the conversation we were loading
      if (get().loadingConversationId === id) {
        set({ isLoading: false, loadingConversationId: null });
      }
    }
  },

  loadConversations: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/conversations`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        set({
          conversations: data.conversations.map((c: Conversation & { createdAt: string; updatedAt: string }) => ({
            ...c,
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(c.updatedAt),
          })),
          conversationsLoaded: true,
        });
      } else {
        set({ conversationsLoaded: true });
      }
    } catch {
      // Ignore errors - may not be logged in
      set({ conversationsLoaded: true });
    }
  },

  createConversation: async () => {
    const { selectedModel, selectedProvider } = get();
    try {
      const res = await fetch(`${API_BASE}/api/v1/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model: selectedModel,
          provider: selectedProvider,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        set({
          currentConversationId: data.id,
          messages: [],
        });
        // Reload conversations list
        get().loadConversations();
        return data.id;
      }
    } catch {
      // Fall back to local-only session
      set({
        currentConversationId: null,
        messages: [],
      });
    }
    return null;
  },

  setCurrentConversation: (id: string) => {
    const { loadConversation } = get();
    loadConversation(id);
  },

  deleteConversation: async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/conversations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          // Clear current if we deleted it
          currentConversationId: state.currentConversationId === id ? null : state.currentConversationId,
          messages: state.currentConversationId === id ? [] : state.messages,
        }));
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  },

  renameConversation: async (id: string, title: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title } : c
          ),
        }));
      }
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  },

  clearAllConversations: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/conversations`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // Clear local state after server delete
        set({
          currentConversationId: null,
          messages: [],
          conversations: [],
          sessionStats: {
            tokensSaved: 0,
            waterSaved: 0,
            powerSaved: 0,
            shardHits: 0,
          },
        });
        return { deleted: data.deleted || 0 };
      }
      return { deleted: 0 };
    } catch (err) {
      console.error('Failed to clear all conversations:', err);
      return { deleted: 0 };
    }
  },

  clearLocalState: () => {
    set({
      currentConversationId: null,
      messages: [],
      conversations: [],
      conversationsLoaded: false,
      loadingConversationId: null,
      sessionStats: {
        tokensSaved: 0,
        waterSaved: 0,
        powerSaved: 0,
        shardHits: 0,
      },
    });
  },

  setSelectedModel: (modelId: string) => {
    // Handle smart-router specially
    if (modelId === 'smart-router') {
      set({ selectedModel: 'smart-router', selectedProvider: 'auto' });
      return;
    }

    // Extract provider from model ID
    const providerMap: Record<string, string> = {
      'gpt-': 'openai',
      'o1': 'openai',
      'o3': 'openai',
      'o4': 'openai',
      'claude-': 'anthropic',
      'gemini-': 'google',
      'grok-': 'xai',
      'deepseek': 'deepseek',
      'ollama/': 'ollama',
      'lmstudio/': 'lmstudio',
    };

    let provider = 'anthropic'; // default
    for (const [prefix, prov] of Object.entries(providerMap)) {
      if (modelId.startsWith(prefix)) {
        provider = prov;
        break;
      }
    }

    set({ selectedModel: modelId, selectedProvider: provider });
  },

  setModel: (provider: string, model: string) => {
    set({ selectedProvider: provider, selectedModel: model });
  },

  addShardHitStats: (stats) => {
    set((state) => ({
      sessionStats: {
        tokensSaved: state.sessionStats.tokensSaved + stats.tokensSaved,
        waterSaved: state.sessionStats.waterSaved + stats.waterSaved,
        powerSaved: state.sessionStats.powerSaved + stats.powerSaved,
        shardHits: state.sessionStats.shardHits + 1,
      },
    }));
  },

  dismissBillingPrompt: () => {
    set({ showBillingPrompt: false });
  },

  updateBillingStatus: (status: BillingStatus) => {
    set({ billingStatus: status });
  },
    }),
    {
      name: 'alf-chat-preferences',
      version: 2, // Bumped to migrate users to Smart Router default
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
      }),
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { selectedModel?: string; selectedProvider?: string };
        // Version 2: Migrate to Smart Router as default
        if (version < 2) {
          return {
            ...state,
            selectedModel: 'smart-router',
            selectedProvider: 'auto',
          };
        }
        return state;
      },
    }
  )
);
