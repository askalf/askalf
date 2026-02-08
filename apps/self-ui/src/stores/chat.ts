import { create } from 'zustand';
import * as chatApi from '../api/chat';

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'self';
  content: string;
  createdAt: string;
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    model?: string;
  };
}

const PAGE_SIZE = 20;

interface ChatState {
  conversations: Conversation[];
  totalConversations: number;
  currentConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isSending: boolean;
  error: string | null;

  fetchConversations: () => Promise<void>;
  loadMoreConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string>;
  sendMessage: (content: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  totalConversations: 0,
  currentConversationId: null,
  messages: [],
  isLoading: false,
  isLoadingMore: false,
  isSending: false,
  error: null,

  fetchConversations: async () => {
    try {
      const data = await chatApi.getConversations({ limit: PAGE_SIZE });
      set({ conversations: data.conversations, totalConversations: data.total ?? data.conversations.length });
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  },

  loadMoreConversations: async () => {
    const { conversations, totalConversations, isLoadingMore } = get();
    if (isLoadingMore || conversations.length >= totalConversations) return;
    set({ isLoadingMore: true });
    try {
      const data = await chatApi.getConversations({ limit: PAGE_SIZE, offset: conversations.length });
      set((s) => ({
        conversations: [...s.conversations, ...data.conversations],
        totalConversations: data.total ?? s.totalConversations,
        isLoadingMore: false,
      }));
    } catch (err) {
      set({ isLoadingMore: false });
      console.error('Failed to load more conversations:', err);
    }
  },

  selectConversation: async (id: string) => {
    set({ currentConversationId: id, isLoading: true, error: null });
    try {
      const data = await chatApi.getConversation(id);
      set({ messages: data.messages, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load conversation', isLoading: false });
    }
  },

  createConversation: async () => {
    const data = await chatApi.createConversation();
    set((s) => ({
      conversations: [data.conversation, ...s.conversations],
      totalConversations: s.totalConversations + 1,
      currentConversationId: data.conversation.id,
      messages: [],
    }));
    return data.conversation.id;
  },

  sendMessage: async (content: string) => {
    const { currentConversationId } = get();
    if (!currentConversationId) return;

    // Optimistic user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      conversationId: currentConversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, tempUserMsg],
      isSending: true,
      error: null,
    }));

    try {
      const data = await chatApi.sendMessage(currentConversationId, content);
      set((s) => ({
        // Replace temp message with real one and add reply
        messages: [
          ...s.messages.filter((m) => m.id !== tempUserMsg.id),
          data.message,
          data.reply,
        ],
        isSending: false,
      }));
      // Update conversation list
      get().fetchConversations();
    } catch (err) {
      set((s) => ({
        // Remove temp message on error
        messages: s.messages.filter((m) => m.id !== tempUserMsg.id),
        isSending: false,
        error: err instanceof Error ? err.message : 'Failed to send message',
      }));
    }
  },

  deleteConversation: async (id: string) => {
    await chatApi.deleteConversation(id);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      totalConversations: Math.max(0, s.totalConversations - 1),
      currentConversationId: s.currentConversationId === id ? null : s.currentConversationId,
      messages: s.currentConversationId === id ? [] : s.messages,
    }));
  },
}));
