import { create } from 'zustand';

// ── Types ──

export interface Conversation {
  id: string;
  owner_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  execution_id: string | null;
  intent: ParsedIntent | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IntentSubtask {
  title: string;
  description: string;
  suggestedAgentType: string;
  dependencies: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export interface ParsedIntent {
  category: string;
  confidence: number;
  templateId: string | null;
  templateName: string | null;
  agentConfig: {
    name: string;
    systemPrompt: string;
    model: string;
    tools: string[];
    maxIterations: number;
    maxCostPerExecution: number;
  };
  schedule: string | null;
  estimatedCost: number;
  requiresApproval: boolean;
  summary: string;
  executionMode: 'single' | 'pipeline' | 'fan-out' | 'consensus';
  subtasks: IntentSubtask[] | null;
  // Repo context (from simplified intent flow)
  repoId?: string;
  repoFullName?: string;
  repoProvider?: string;
}

export interface Template {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  icon: string | null;
  agent_config: Record<string, unknown>;
  schedule_config: Record<string, unknown> | null;
  estimated_cost_per_run: string | null;
  required_tools: string[];
  usage_count: number;
}

// ── API helpers ──

const getApiBase = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  return 'http://localhost:3001';
};

const API_BASE = getApiBase();

async function chatFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  return res.json();
}

// ── Store ──

interface ChatState {
  // Data
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: ConversationMessage[];
  templates: Template[];

  // UI state
  isProcessing: boolean;
  pendingIntent: ParsedIntent | null;
  activeOrchestrationSessionId: string | null;
  error: string | null;

  // Actions
  fetchConversations: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  createConversation: (title?: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  parseIntent: (message: string) => Promise<ParsedIntent>;
  confirmIntent: (intent: ParsedIntent) => Promise<void>;
  cancelIntent: () => void;
  addAssistantMessage: (content: string, executionId?: string, intent?: ParsedIntent) => Promise<void>;
  pollOrchestrationStatus: (sessionId: string) => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  templates: [],
  isProcessing: false,
  pendingIntent: null,
  activeOrchestrationSessionId: null,
  error: null,

  fetchConversations: async () => {
    try {
      const data = await chatFetch<{ conversations: Conversation[] }>(
        '/api/v1/admin/chat/conversations',
      );
      const { activeConversationId } = get();
      set({ conversations: data.conversations });
      // Auto-select the most recent conversation if none is active
      if (!activeConversationId && data.conversations.length > 0) {
        void get().selectConversation(data.conversations[0]!.id);
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch conversations' });
    }
  },

  fetchTemplates: async () => {
    try {
      const data = await chatFetch<{ templates: Template[] }>(
        '/api/v1/admin/chat/templates',
      );
      set({ templates: data.templates });
    } catch (err) {
      // Non-critical — templates are optional
      console.warn('Failed to fetch templates:', err);
    }
  },

  createConversation: async (title?: string) => {
    const data = await chatFetch<Conversation>(
      '/api/v1/admin/chat/conversations',
      { method: 'POST', body: JSON.stringify({ title: title ?? null }) },
    );
    set(s => ({
      conversations: [data, ...s.conversations],
      activeConversationId: data.id,
      messages: [],
      pendingIntent: null,
    }));
    return data.id;
  },

  selectConversation: async (id: string) => {
    set({ activeConversationId: id, messages: [], pendingIntent: null });
    try {
      const data = await chatFetch<{ messages: ConversationMessage[] }>(
        `/api/v1/admin/chat/conversations/${id}`,
      );
      // Restore pending intent only if the last message in the conversation
      // is an assistant message with an intent (meaning it hasn't been confirmed/cancelled yet)
      const lastMsg = data.messages[data.messages.length - 1];
      const restoredIntent = lastMsg?.role === 'assistant' && lastMsg.intent
        ? lastMsg.intent
        : null;
      set({
        messages: data.messages,
        pendingIntent: restoredIntent,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load messages' });
    }
  },

  renameConversation: async (id: string, title: string) => {
    try {
      const updated = await chatFetch<Conversation>(
        `/api/v1/admin/chat/conversations/${id}`,
        { method: 'PATCH', body: JSON.stringify({ title }) },
      );
      set(s => ({
        conversations: s.conversations.map(c => c.id === id ? { ...c, title: updated.title } : c),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to rename conversation' });
    }
  },

  deleteConversation: async (id: string) => {
    try {
      await chatFetch(`/api/v1/admin/chat/conversations/${id}`, { method: 'DELETE' });
      set(s => ({
        conversations: s.conversations.filter(c => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        messages: s.activeConversationId === id ? [] : s.messages,
        pendingIntent: s.activeConversationId === id ? null : s.pendingIntent,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete conversation' });
    }
  },

  sendMessage: async (content: string) => {
    const { activeConversationId } = get();
    let convId = activeConversationId;

    // Auto-create conversation if none active
    if (!convId) {
      convId = await get().createConversation();
    }

    // Optimistically add user message
    const optimisticMsg: ConversationMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: convId,
      role: 'user',
      content,
      execution_id: null,
      intent: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    set(s => ({ messages: [...s.messages, optimisticMsg], isProcessing: true, pendingIntent: null, error: null }));

    try {
      // Persist user message
      const saved = await chatFetch<ConversationMessage>(
        `/api/v1/admin/chat/conversations/${convId}/messages`,
        { method: 'POST', body: JSON.stringify({ content, role: 'user' }) },
      );

      // Replace optimistic message with saved one
      set(s => ({
        messages: s.messages.map(m => m.id === optimisticMsg.id ? saved : m),
      }));

      // Parse intent
      const intent = await get().parseIntent(content);

      // Persist the intent response as an assistant message immediately
      const modeLabel = intent.executionMode !== 'single' ? ` | Mode: ${intent.executionMode}` : '';
      const agentCount = intent.subtasks?.length ? ` | ${intent.subtasks.length} agents` : '';
      const summary = `**${intent.agentConfig.name}** (${intent.category})\n${intent.summary}\n\nModel: ${intent.agentConfig.model} | Tools: ${intent.agentConfig.tools.join(', ')} | Budget cap: $${intent.agentConfig.maxCostPerExecution.toFixed(2)}${modeLabel}${agentCount}`;
      await get().addAssistantMessage(summary, undefined, intent);

      set({ pendingIntent: intent, isProcessing: false });
    } catch (err) {
      set({
        isProcessing: false,
        error: err instanceof Error ? err.message : 'Failed to send message',
      });
    }
  },

  parseIntent: async (message: string) => {
    const data = await chatFetch<ParsedIntent>(
      '/api/v1/admin/chat/intent',
      { method: 'POST', body: JSON.stringify({ message }) },
    );
    return data;
  },

  confirmIntent: async (intent: ParsedIntent) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    set({ isProcessing: true, pendingIntent: null });

    try {
      if (intent.executionMode !== 'single' && intent.subtasks?.length) {
        // ── Multi-agent orchestration ──
        const result = await chatFetch<{
          sessionId: string;
          tasks: Array<{ title: string; agentId: string; agentName: string; executionId: string; status: string }>;
          totalTasks: number;
          message: string;
        }>(
          '/api/v1/admin/chat/dispatch-orchestration',
          {
            method: 'POST',
            body: JSON.stringify({
              intent,
              conversationId: activeConversationId,
            }),
          },
        );

        const taskSummary = result.tasks.map(t => `- **${t.title}** → ${t.agentName}`).join('\n');
        await get().addAssistantMessage(
          `Orchestration launched! ${result.totalTasks} agents dispatched in **${intent.executionMode}** mode.\n\n${taskSummary}\n\nSession: \`${result.sessionId}\``,
        );

        set({ activeOrchestrationSessionId: result.sessionId, isProcessing: false });

        // Start polling orchestration status
        get().pollOrchestrationStatus(result.sessionId);
      } else if (intent.templateId) {
        // ── Single-agent: instantiate from template + auto-run ──
        const result = await chatFetch<{ agent: { id: string; name: string }; message: string }>(
          `/api/v1/admin/chat/templates/${intent.templateId}/instantiate`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: intent.agentConfig.name,
              overrides: {
                systemPrompt: intent.agentConfig.systemPrompt,
                model: intent.agentConfig.model,
                maxIterations: intent.agentConfig.maxIterations,
                maxCostPerExecution: intent.agentConfig.maxCostPerExecution,
              },
            }),
          },
        );

        await get().addAssistantMessage(
          `Agent **${result.agent.name}** created. Starting execution...`,
        );

        // Auto-run the agent
        try {
          const execResult = await chatFetch<{ execution: { id: string } }>(
            `/api/v1/admin/chat/agents/${result.agent.id}/run`,
            {
              method: 'POST',
              body: JSON.stringify({ prompt: intent.summary }),
            },
          );
          await get().addAssistantMessage(
            `Agent **${result.agent.name}** is now running. Track progress in the Fleet tab.\n\nExecution: \`${execResult.execution?.id ?? 'started'}\``,
          );
        } catch {
          await get().addAssistantMessage(
            `Agent **${result.agent.name}** was created but failed to auto-start. You can run it manually from the Fleet tab.`,
          );
        }
        set({ isProcessing: false });
      } else {
        // ── Single-agent manual config ──
        await get().addAssistantMessage(
          `I've prepared the configuration for **${intent.agentConfig.name}**. You can create it in the Builder tab with these settings:\n\n- Model: ${intent.agentConfig.model}\n- Tools: ${intent.agentConfig.tools.join(', ')}\n- Max cost: $${intent.agentConfig.maxCostPerExecution.toFixed(2)}`,
        );
        set({ isProcessing: false });
      }
    } catch (err) {
      set({
        isProcessing: false,
        error: err instanceof Error ? err.message : 'Failed to dispatch',
      });
    }
  },

  cancelIntent: () => {
    set({ pendingIntent: null });
    const { activeConversationId } = get();
    if (activeConversationId) {
      void get().addAssistantMessage('Cancelled. What else would you like to do?');
    }
  },

  addAssistantMessage: async (content: string, executionId?: string, intent?: ParsedIntent) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    try {
      const saved = await chatFetch<ConversationMessage>(
        `/api/v1/admin/chat/conversations/${activeConversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content,
            role: 'assistant',
            executionId: executionId ?? undefined,
            intent: intent ?? undefined,
          }),
        },
      );
      set(s => ({ messages: [...s.messages, saved] }));
    } catch {
      // Fire-and-forget — display locally even if persistence fails
      const localMsg: ConversationMessage = {
        id: `local-${Date.now()}`,
        conversation_id: activeConversationId,
        role: 'assistant',
        content,
        execution_id: executionId ?? null,
        intent: intent ?? null,
        metadata: {},
        created_at: new Date().toISOString(),
      };
      set(s => ({ messages: [...s.messages, localMsg] }));
    }
  },

  pollOrchestrationStatus: (sessionId: string) => {
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes at 10s intervals
    const interval = setInterval(async () => {
      attempts++;
      try {
        const status = await chatFetch<{
          tasks: Array<{ executionId: string; agentName: string; title: string; status: string; output?: string }>;
          allComplete: boolean;
          summary?: string;
        }>(`/api/v1/admin/chat/orchestration/${sessionId}/status`);

        if (status.allComplete || attempts >= maxAttempts) {
          clearInterval(interval);
          set({ activeOrchestrationSessionId: null });

          const results = status.tasks.map(t => {
            const icon = t.status === 'completed' ? '\u2713' : t.status === 'failed' ? '\u2717' : '\u2026';
            const output = t.output ? `\n  ${t.output.slice(0, 200)}` : '';
            return `${icon} **${t.title}** (${t.agentName}): ${t.status}${output}`;
          }).join('\n');

          const header = status.allComplete
            ? 'All orchestration tasks complete!'
            : `Orchestration status update (${attempts >= maxAttempts ? 'timed out' : 'partial'}):`;

          await get().addAssistantMessage(`${header}\n\n${results}${status.summary ? `\n\n${status.summary}` : ''}`);
        }
      } catch {
        // Silently retry — forge may be temporarily unavailable
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          set({ activeOrchestrationSessionId: null });
        }
      }
    }, 10000);
  },

  clearError: () => set({ error: null }),
}));
