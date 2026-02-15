/**
 * Self Store — Zustand state for Self conversation UI
 */

import { create } from 'zustand';
import { useSelfApi } from '../hooks/useSelfApi';
import type { Conversation, SelfMessage, SelfAction } from '../hooks/useSelfApi';

interface SelfState {
  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: SelfMessage[];

  // Streaming
  isStreaming: boolean;
  streamingContent: string;

  // Loading
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchConversations: () => Promise<void>;
  createConversation: () => Promise<string>;
  setActiveConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  clearError: () => void;
}

export const useSelfStore = create<SelfState>((set, get) => {
  const api = useSelfApi();

  return {
    conversations: [],
    activeConversationId: null,
    messages: [],
    isStreaming: false,
    streamingContent: '',
    isLoading: false,
    error: null,

    fetchConversations: async () => {
      try {
        const conversations = await api.fetchConversations();
        set({ conversations });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Failed to load conversations' });
      }
    },

    createConversation: async () => {
      try {
        const { id, welcome } = await api.createConversation();
        const welcomeMsg: SelfMessage = {
          id: 'welcome',
          role: 'assistant',
          content: welcome,
          tool_calls: [],
          actions: [],
          created_at: new Date().toISOString(),
        };
        set((state) => ({
          activeConversationId: id,
          messages: [welcomeMsg],
          conversations: [
            { id, title: null, summary: null, message_count: 1, updated_at: new Date().toISOString() },
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
      set({ activeConversationId: id, isLoading: true, messages: [] });
      try {
        const messages = await api.fetchMessages(id);
        set({ messages, isLoading: false });
      } catch (err) {
        set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to load messages' });
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

      // Add user message optimistically
      const userMsg: SelfMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        tool_calls: [],
        actions: [],
        created_at: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, userMsg],
        isStreaming: true,
        streamingContent: '',
        error: null,
      }));

      try {
        const chatUrl = api.getChatUrl();
        const response = await fetch(chatUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: state.activeConversationId,
            message,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Chat failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let conversationId = state.activeConversationId;
        const actions: SelfAction[] = [];

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              continue;
            }
            if (line.startsWith('data: ')) {
              const rawData = line.slice(6);
              try {
                const data = JSON.parse(rawData);

                // Determine event type from the previous event: line
                // SSE parsing: we need to track event type
                if ('text' in data) {
                  // token event
                  fullContent += data.text;
                  set({ streamingContent: fullContent });
                } else if ('id' in data && 'conversationId' in data === false && !('name' in data)) {
                  // conversation event (new conversation created)
                  if (data.id) conversationId = data.id;
                } else if (data.type === 'connect' || data.type === 'credential') {
                  // action event
                  actions.push(data);
                } else if ('tokens' in data) {
                  // done event — handled below
                } else if ('title' in data) {
                  // title event
                  set((s) => ({
                    conversations: s.conversations.map(c =>
                      c.id === conversationId ? { ...c, title: data.title } : c
                    ),
                  }));
                }
              } catch {
                // skip malformed JSON
              }
            }
          }
        }

        // Add complete assistant message
        const assistantMsg: SelfMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fullContent,
          tool_calls: [],
          actions,
          created_at: new Date().toISOString(),
        };

        set((s) => ({
          messages: [...s.messages, assistantMsg],
          isStreaming: false,
          streamingContent: '',
          activeConversationId: conversationId,
        }));

        // Refresh conversation list
        get().fetchConversations();
      } catch (err) {
        set({
          isStreaming: false,
          streamingContent: '',
          error: err instanceof Error ? err.message : 'Failed to send message',
        });
      }
    },

    clearError: () => set({ error: null }),
  };
});
