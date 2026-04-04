/**
 * Chat store for Ask Alf tab.
 * Manages conversations, messages, and intent parsing.
 */

import { create } from 'zustand';
import { API_BASE } from '../utils/api';

export interface IntentSubtask {
  description: string;
  title?: string;
  tool?: string;
  status?: string;
  suggestedAgentType?: string;
}

export interface AgentConfig {
  name: string;
  model: string;
  tools: string[];
  systemPrompt: string;
  maxCostPerExecution: number;
  [key: string]: unknown;
}

export interface ParsedIntent {
  action: string;
  description: string;
  summary?: string;
  category?: string;
  confidence?: number;
  executionMode?: string;
  templateName?: string;
  schedule?: string;
  requiresApproval?: boolean;
  subtasks: IntentSubtask[];
  agentConfig: AgentConfig;
  projectPath?: string;
  projectName?: string;
  repoId?: string;
  repoFullName?: string;
  repoProvider?: string;
  [key: string]: unknown;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: ParsedIntent | null;
  execution_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

interface ChatState {
  activeConversationId: string | null;
  messages: ConversationMessage[];
  isProcessing: boolean;
  pendingIntent: ParsedIntent | null;
  error: string | null;

  fetchConversations: () => Promise<void>;
  createConversation: () => Promise<string>;
  sendMessage: (text: string) => Promise<void>;
  parseIntent: (text: string) => Promise<ParsedIntent>;
  addAssistantMessage: (content: string, executionId?: string, intent?: ParsedIntent) => Promise<void>;
  confirmIntent: (intent: ParsedIntent) => Promise<void>;
  cancelIntent: () => void;
  clearConversation: () => Promise<void>;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeConversationId: null,
  messages: [],
  isProcessing: false,
  pendingIntent: null,
  error: null,

  fetchConversations: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/conversations`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { conversations: Array<{ id: string }> };
        if (data.conversations?.length > 0 && !get().activeConversationId) {
          set({ activeConversationId: data.conversations[0]!.id });
        }
      }
    } catch { /* ignore */ }
  },

  createConversation: async () => {
    const res = await fetch(`${API_BASE}/api/v1/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title: 'New conversation' }),
    });
    const data = await res.json() as { id: string };
    set({ activeConversationId: data.id, messages: [] });
    return data.id;
  },

  sendMessage: async (text: string) => {
    const { activeConversationId } = get();
    const convId = activeConversationId || await get().createConversation();

    const userMsg: ConversationMessage = {
      id: `user-${Date.now()}`,
      conversation_id: convId,
      role: 'user',
      content: text,
    };

    set(s => ({ messages: [...s.messages, userMsg], isProcessing: true, error: null }));

    try {
      const res = await fetch(`${API_BASE}/api/v1/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text, conversation_id: convId }),
      });

      if (!res.ok) throw new Error(`Intent failed: ${res.status}`);
      const data = await res.json() as { response?: string; intent?: ParsedIntent; message?: string };

      const assistantMsg: ConversationMessage = {
        id: `alf-${Date.now()}`,
        conversation_id: convId,
        role: 'assistant',
        content: data.response || data.message || '',
        intent: data.intent,
      };

      set(s => ({
        messages: [...s.messages, assistantMsg],
        isProcessing: false,
        pendingIntent: data.intent || null,
      }));
    } catch (err) {
      set({ isProcessing: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  },

  parseIntent: async (text: string): Promise<ParsedIntent> => {
    const convId = get().activeConversationId || await get().createConversation();
    const res = await fetch(`${API_BASE}/api/v1/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: text, conversation_id: convId }),
    });
    if (!res.ok) throw new Error(`Intent parse failed: ${res.status}`);
    const data = await res.json() as { intent: ParsedIntent };
    return data.intent;
  },

  addAssistantMessage: async (content: string, executionId?: string, intent?: ParsedIntent) => {
    const msg: ConversationMessage = {
      id: `alf-${Date.now()}`,
      conversation_id: get().activeConversationId || '',
      role: 'assistant',
      content,
      execution_id: executionId || null,
      intent: intent || null,
    };
    set(s => ({ messages: [...s.messages, msg] }));
  },

  confirmIntent: async (intent: ParsedIntent) => {
    set({ isProcessing: true, pendingIntent: null });
    try {
      const res = await fetch(`${API_BASE}/api/v1/intent/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intent }),
      });

      if (!res.ok) throw new Error(`Confirm failed: ${res.status}`);
      const data = await res.json() as { message?: string };

      const msg: ConversationMessage = {
        id: `alf-${Date.now()}`,
        conversation_id: get().activeConversationId || '',
        role: 'assistant',
        content: data.message || 'Intent confirmed. Executing...',
      };

      set(s => ({ messages: [...s.messages, msg], isProcessing: false }));
    } catch (err) {
      set({ isProcessing: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  },

  cancelIntent: () => set({ pendingIntent: null }),

  clearConversation: async () => {
    const { activeConversationId } = get();
    if (activeConversationId) {
      await fetch(`${API_BASE}/api/v1/conversations/${activeConversationId}`, {
        method: 'DELETE',
        credentials: 'include',
      }).catch(() => {});
    }
    set({ activeConversationId: null, messages: [], pendingIntent: null, error: null });
  },

  clearError: () => set({ error: null }),
}));
