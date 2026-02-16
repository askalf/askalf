import { useEffect, useRef, useState, useCallback } from 'react';
import { useAskAlfStore } from '../stores/askalf';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { formatDistanceToNow } from 'date-fns';
import './AskAlf.css';

const PROVIDER_LABELS: Record<string, string> = {
  auto: 'Auto',
  claude: 'Claude',
  openai: 'OpenAI',
};

const HARDCODED_MODELS: Record<string, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  openai: ['gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-4.1', 'gpt-4.5-preview', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini'],
};

const SUGGESTED_PROMPTS = [
  'Explain quantum computing in simple terms',
  'Write a Python function to calculate fibonacci numbers',
  'What are the key differences between REST and GraphQL?',
  'Help me write a regex to validate email addresses',
];

export default function AskAlf() {
  const {
    conversations,
    activeConversationId,
    conversationsLoaded,
    messages,
    isStreaming,
    streamingContent,
    streamingProvider,
    streamingModel,
    selectedProvider,
    selectedModel,
    providers,
    isLoading,
    error,
    fetchConversations,
    createConversation,
    setActiveConversation,
    renameConversation,
    deleteConversation,
    sendMessage,
    stopGeneration,
    setProvider,
    setModel,
    fetchProviders,
    clearError,
  } = useAskAlfStore();

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load on mount
  useEffect(() => {
    fetchConversations();
    fetchProviders();
  }, [fetchConversations, fetchProviders]);

  // Auto-select or create conversation after fetch completes
  useEffect(() => {
    if (!conversationsLoaded) return;
    if (activeConversationId && conversations.find(c => c.id === activeConversationId)) {
      // Restored from localStorage and conversation still exists — load its messages
      if (messages.length === 0 && !isLoading) {
        setActiveConversation(activeConversationId);
      }
    } else if (conversations.length > 0) {
      setActiveConversation(conversations[0].id);
    } else if (!activeConversationId) {
      createConversation();
    }
  }, [conversationsLoaded]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus input
  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming, activeConversationId]);

  // Auto-resize textarea
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  }, [input]);

  // Scroll detection for FAB
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
    setShowScrollBtn(!isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        createConversation();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createConversation]);

  const handleSend = useCallback((text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isStreaming) return;
    setInput('');
    sendMessage(msg);
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    createConversation();
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteConversation(id);
  };

  const startRename = (e: React.MouseEvent, id: string, title: string | null) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(title || '');
  };

  const commitRename = (id: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      renameConversation(id, trimmed);
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const handleRegenerate = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && !isStreaming) {
      sendMessage(lastUserMsg.content);
    }
  }, [messages, isStreaming, sendMessage]);

  // Get available models for current provider
  const availableModels = selectedProvider === 'auto'
    ? []
    : (providers[selectedProvider]?.models || HARDCODED_MODELS[selectedProvider] || []);

  // Check if the conversation is empty (only welcome message or nothing)
  const isEmptyConversation = messages.length <= 1 && messages[0]?.id === 'welcome';

  return (
    <div className="aa-page">
      {/* Sidebar Overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="aa-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Conversation Sidebar */}
      <div className={`aa-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="aa-sidebar-header">
          <span className="aa-sidebar-title">Conversations</span>
          <button className="aa-new-btn" onClick={handleNewConversation} title="New conversation (Ctrl+K)">+</button>
        </div>
        <div className="aa-sidebar-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`aa-sidebar-item ${c.id === activeConversationId ? 'active' : ''}`}
              onClick={() => editingId !== c.id && setActiveConversation(c.id)}
            >
              {editingId === c.id ? (
                <input
                  className="aa-sidebar-rename-input"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(c.id);
                    if (e.key === 'Escape') cancelRename();
                  }}
                  onBlur={() => commitRename(c.id)}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="aa-sidebar-item-title"
                  onDoubleClick={(e) => startRename(e, c.id, c.title)}
                >
                  {c.title || 'New Chat'}
                </span>
              )}
              <button
                className="aa-sidebar-item-delete"
                onClick={(e) => handleDelete(e, c.id)}
                title="Delete"
              >x</button>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="aa-chat">
        {/* Header with provider selector */}
        <div className="aa-chat-header">
          <button
            className="aa-toggle-sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle sidebar (Ctrl+/)"
          >=</button>
          <div className="aa-provider-select">
            <label>Provider:</label>
            <select
              value={selectedProvider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={isStreaming}
            >
              <option value="auto">Auto (Classifier)</option>
              {Object.keys(PROVIDER_LABELS).filter(k => k !== 'auto').map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </div>
          {selectedProvider !== 'auto' && availableModels.length > 0 && (
            <div className="aa-model-select">
              <label>Model:</label>
              <select
                value={selectedModel}
                onChange={(e) => setModel(e.target.value)}
                disabled={isStreaming}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Messages */}
        <div
          className="aa-messages"
          ref={messagesContainerRef}
          onScroll={handleScroll}
        >
          <div className="aa-messages-inner">
            {isEmptyConversation ? (
              <EmptyState onPromptClick={(prompt) => handleSend(prompt)} />
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`aa-msg aa-msg-${msg.role} ${
                      msg.role === 'user' ? 'animate-message-user' : 'animate-message-alf'
                    }`}
                  >
                    <div className="aa-msg-content">
                      <MarkdownRenderer content={msg.content} />
                    </div>
                    <div className="aa-msg-footer">
                      {msg.role === 'assistant' && msg.provider && (
                        <div className="aa-msg-meta">
                          <span className={`aa-provider-badge aa-badge-${msg.provider}`}>
                            {PROVIDER_LABELS[msg.provider] || msg.provider}
                          </span>
                          {msg.model && <span className="aa-model-tag">{msg.model}</span>}
                          {msg.classified && <span className="aa-classified-tag">auto-routed</span>}
                        </div>
                      )}
                      <span className="aa-timestamp">
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </span>
                      <MessageActions
                        content={msg.content}
                        role={msg.role as 'user' | 'assistant'}
                        onRegenerate={msg.role === 'assistant' ? handleRegenerate : undefined}
                      />
                    </div>
                  </div>
                ))}

                {isStreaming && streamingContent && (
                  <div className="aa-msg aa-msg-assistant aa-msg-streaming animate-stream-in">
                    <div className="aa-msg-content">
                      <MarkdownRenderer content={streamingContent} />
                      <span className="aa-cursor" />
                    </div>
                    {streamingProvider && (
                      <div className="aa-msg-meta">
                        <span className={`aa-provider-badge aa-badge-${streamingProvider}`}>
                          {PROVIDER_LABELS[streamingProvider] || streamingProvider}
                        </span>
                        {streamingModel && <span className="aa-model-tag">{streamingModel}</span>}
                      </div>
                    )}
                  </div>
                )}

                {isStreaming && !streamingContent && (
                  <div className="aa-loading">
                    <div className="aa-loading-dot" />
                    <div className="aa-loading-dot" />
                    <div className="aa-loading-dot" />
                  </div>
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Scroll to bottom FAB */}
        {showScrollBtn && (
          <button
            className="aa-scroll-fab"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v10M4 9l4 4 4-4" />
            </svg>
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="aa-error" onClick={clearError}>
            {error} (click to dismiss)
          </div>
        )}

        {/* Input */}
        <div className="aa-input-area">
          <div className="aa-input-wrapper">
            <textarea
              ref={inputRef}
              className="aa-input"
              placeholder="Message Ask Alf..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              rows={1}
            />
            {isStreaming ? (
              <button
                className="aa-stop-btn"
                onClick={stopGeneration}
                aria-label="Stop generation"
                title="Stop generation"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="2" y="2" width="10" height="10" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                className="aa-send-btn"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2L2 8.5l5 1.5M14 2L9 14l-2-4M14 2L7 10" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Empty state with suggested prompts */
function EmptyState({ onPromptClick }: { onPromptClick: (prompt: string) => void }) {
  return (
    <div className="aa-empty-state">
      <div className="aa-empty-logo">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="var(--crystal-dim)" />
          <text x="24" y="30" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--crystal)">A</text>
        </svg>
      </div>
      <h2 className="aa-empty-title">What can I help you with?</h2>
      <p className="aa-empty-subtitle">Ask anything — I'll route to the best AI for the job, or pick your own provider.</p>
      <div className="aa-prompt-grid">
        {SUGGESTED_PROMPTS.map((prompt, i) => (
          <button
            key={i}
            className="aa-prompt-card"
            onClick={() => onPromptClick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Message action buttons (copy, regenerate) */
function MessageActions({
  content,
  role,
  onRegenerate,
}: {
  content: string;
  role: 'user' | 'assistant';
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <div className="aa-msg-actions">
      <button className="aa-msg-action" onClick={handleCopy} title="Copy message">
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--crystal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7l3 3 5-6" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="7" height="7" rx="1" />
            <path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" />
          </svg>
        )}
      </button>
      {role === 'assistant' && onRegenerate && (
        <button className="aa-msg-action" onClick={onRegenerate} title="Regenerate response">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 7a6 6 0 0110.5-4M13 7a6 6 0 01-10.5 4" />
            <path d="M11.5 1v2.5H9M2.5 13v-2.5H5" />
          </svg>
        </button>
      )}
    </div>
  );
}
