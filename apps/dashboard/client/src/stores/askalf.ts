/**
 * Ask Alf Store — Zustand state for universal chat UI
 */

import { create } from 'zustand';
import { useAskAlfApi } from '../hooks/useAskAlfApi';
import type { AskAlfConversation, AskAlfMessage, ProviderInfo } from '../hooks/useAskAlfApi';

interface AskAlfState {
  // Conversations
  conversations: AskAlfConversation[];
  activeConversationId: string | null;
  conversationsLoaded: boolean;
  messages: AskAlfMessage[];

  // Streaming
  isStreaming: boolean;
  streamingContent: string;
  streamingProvider: string | null;
  streamingModel: string | null;
  abortController: AbortController | null;

  // Provider selection
  selectedProvider: string; // 'auto' | 'claude' | 'openai'
  selectedModel: string;
  providers: Record<string, ProviderInfo>;

  // Loading
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchConversations: () => Promise<void>;
  createConversation: () => Promise<string>;
  setActiveConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  stopGeneration: () => void;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  fetchProviders: () => Promise<void>;
  clearError: () => void;
}

export const useAskAlfStore = create<AskAlfState>((set, get) => {
  const api = useAskAlfApi();

  // Restore last active conversation from localStorage
  const savedConvId = (() => {
    try { return localStorage.getItem('askalf_activeConversationId'); } catch { return null; }
  })();

  return {
    conversations: [],
    activeConversationId: savedConvId,
    conversationsLoaded: false,
    messages: [],
    isStreaming: false,
    streamingContent: '',
    streamingProvider: null,
    streamingModel: null,
    abortController: null,
    selectedProvider: 'auto',
    selectedModel: '',
    providers: {},
    isLoading: false,
    error: null,

    fetchConversations: async () => {
      try {
        const conversations = await api.fetchConversations();
        set({ conversations, conversationsLoaded: true });
      } catch (err) {
        set({ conversationsLoaded: true, error: err instanceof Error ? err.message : 'Failed to load conversations' });
      }
    },

    createConversation: async () => {
      try {
        const { id, welcome } = await api.createConversation();
        const welcomeMsg: AskAlfMessage = {
          id: 'welcome',
          role: 'assistant',
          content: welcome,
          provider: null,
          model: null,
          tokens_used: 0,
          classified: false,
          created_at: new Date().toISOString(),
        };
        try { localStorage.setItem('askalf_activeConversationId', id); } catch {}
        set((state) => ({
          activeConversationId: id,
          messages: [welcomeMsg],
          conversations: [
            { id, title: null, default_provider: null, default_model: null, message_count: 1, updated_at: new Date().toISOString() },
            ...state.conversations,
          ],
        }));
        return id;
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Failed to create conversation' });
        throw err;
      }
    },

    setActiveConversation: async (id: string) => {
      try { localStorage.setItem('askalf_activeConversationId', id); } catch {}
      set({ activeConversationId: id, isLoading: true, messages: [] });
      try {
        const messages = await api.fetchMessages(id);
        set({ messages, isLoading: false });
      } catch (err) {
        set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to load messages' });
      }
    },

    renameConversation: async (id: string, title: string) => {
      try {
        await api.renameConversation(id, title);
        set((state) => ({
          conversations: state.conversations.map(c =>
            c.id === id ? { ...c, title } : c
          ),
        }));
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Failed to rename conversation' });
      }
    },

    deleteConversation: async (id: string) => {
      try {
        await api.deleteConversation(id);
        set((state) => {
          const conversations = state.conversations.filter(c => c.id !== id);
          const activeId = state.activeConversationId === id ? null : state.activeConversationId;
          return { conversations, activeConversationId: activeId, messages: activeId ? state.messages : [] };
        });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Failed to delete conversation' });
      }
    },

    sendMessage: async (message: string) => {
      const state = get();
      if (state.isStreaming) return;

      const abortController = new AbortController();

      const userMsg: AskAlfMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        provider: null,
        model: null,
        tokens_used: 0,
        classified: false,
        created_at: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, userMsg],
        isStreaming: true,
        streamingContent: '',
        streamingProvider: null,
        streamingModel: null,
        abortController,
        error: null,
      }));

      try {
        const chatUrl = api.getChatUrl();
        const provider = state.selectedProvider === 'auto' ? undefined : state.selectedProvider;
        const model = state.selectedModel || undefined;

        const response = await fetch(chatUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            conversationId: state.activeConversationId,
            message,
            provider,
            model,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Chat failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let conversationId = state.activeConversationId;
        let msgProvider: string | null = null;
        let msgModel: string | null = null;
        let classified = false;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (line.startsWith('data: ')) {
              const rawData = line.slice(6);
              try {
                const data = JSON.parse(rawData);

                switch (currentEvent) {
                  case 'token':
                    fullContent += data.text;
                    set({ streamingContent: fullContent });
                    break;
                  case 'conversation':
                    if (data.id) conversationId = data.id;
                    break;
                  case 'provider':
                    msgProvider = data.provider;
                    msgModel = data.model;
                    classified = data.classified || false;
                    set({ streamingProvider: data.provider, streamingModel: data.model });
                    break;
                  case 'title':
                    set((s) => ({
                      conversations: s.conversations.map(c =>
                        c.id === conversationId ? { ...c, title: data.title } : c
                      ),
                    }));
                    break;
                  case 'error':
                    set({ error: data.message });
                    break;
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = '';
            }
          }
        }

        const assistantMsg: AskAlfMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fullContent,
          provider: msgProvider,
          model: msgModel,
          tokens_used: 0,
          classified,
          created_at: new Date().toISOString(),
        };

        if (conversationId) {
          try { localStorage.setItem('askalf_activeConversationId', conversationId); } catch {}
        }
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          isStreaming: false,
          streamingContent: '',
          streamingProvider: null,
          streamingModel: null,
          abortController: null,
          activeConversationId: conversationId,
        }));

        get().fetchConversations();
      } catch (err) {
        // If aborted, preserve partial content as a message
        if (err instanceof DOMException && err.name === 'AbortError') {
          const partial = get().streamingContent;
          if (partial) {
            const partialMsg: AskAlfMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: partial,
              provider: get().streamingProvider,
              model: get().streamingModel,
              tokens_used: 0,
              classified: false,
              created_at: new Date().toISOString(),
            };
            set((s) => ({
              messages: [...s.messages, partialMsg],
              isStreaming: false,
              streamingContent: '',
              streamingProvider: null,
              streamingModel: null,
              abortController: null,
            }));
          } else {
            set({
              isStreaming: false,
              streamingContent: '',
              streamingProvider: null,
              streamingModel: null,
              abortController: null,
            });
          }
          return;
        }

        set({
          isStreaming: false,
          streamingContent: '',
          streamingProvider: null,
          streamingModel: null,
          abortController: null,
          error: err instanceof Error ? err.message : 'Failed to send message',
        });
      }
    },

    stopGeneration: () => {
      const { abortController } = get();
      if (abortController) {
        abortController.abort();
      }
    },

    setProvider: (provider: string) => {
      const state = get();
      const providerInfo = state.providers[provider];
      set({
        selectedProvider: provider,
        selectedModel: providerInfo?.defaultModel || '',
      });
    },

    setModel: (model: string) => {
      set({ selectedModel: model });
    },

    fetchProviders: async () => {
      try {
        const providers = await api.fetchProviders();
        set({ providers });
      } catch {
        // Non-critical — UI still works with hardcoded providers
      }
    },

    clearError: () => set({ error: null }),
  };
});
