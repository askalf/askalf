import { useEffect, useRef, useState, useCallback } from 'react';
import { useAskAlfStore } from '../stores/askalf';
import './AskAlf.css';

const PROVIDER_LABELS: Record<string, string> = {
  auto: 'Auto',
  claude: 'Claude',
  openai: 'OpenAI',
};

const HARDCODED_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
};

export default function AskAlf() {
  const {
    conversations,
    activeConversationId,
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
    deleteConversation,
    sendMessage,
    setProvider,
    setModel,
    fetchProviders,
    clearError,
  } = useAskAlfStore();

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load on mount
  useEffect(() => {
    fetchConversations();
    fetchProviders();
  }, [fetchConversations, fetchProviders]);

  // Auto-create first conversation
  useEffect(() => {
    if (!isLoading && conversations.length === 0 && !activeConversationId) {
      createConversation();
    } else if (!activeConversationId && conversations.length > 0) {
      setActiveConversation(conversations[0].id);
    }
  }, [conversations, activeConversationId, isLoading, createConversation, setActiveConversation]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus input
  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming, activeConversationId]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    sendMessage(text);
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

  // Get available models for current provider
  const availableModels = selectedProvider === 'auto'
    ? []
    : (providers[selectedProvider]?.models || HARDCODED_MODELS[selectedProvider] || []);

  return (
    <div className="aa-page">
      {/* Conversation Sidebar */}
      <div className={`aa-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="aa-sidebar-header">
          <span className="aa-sidebar-title">Conversations</span>
          <button className="aa-new-btn" onClick={handleNewConversation} title="New conversation">+</button>
        </div>
        <div className="aa-sidebar-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`aa-sidebar-item ${c.id === activeConversationId ? 'active' : ''}`}
              onClick={() => setActiveConversation(c.id)}
            >
              <span className="aa-sidebar-item-title">{c.title || 'New Chat'}</span>
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
            title="Toggle sidebar"
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
        <div className="aa-messages">
          <div className="aa-messages-inner">
            {messages.map((msg) => (
              <div key={msg.id} className={`aa-msg aa-msg-${msg.role}`}>
                <div className="aa-msg-content">
                  <MessageContent content={msg.content} />
                </div>
                {msg.role === 'assistant' && msg.provider && (
                  <div className="aa-msg-meta">
                    <span className={`aa-provider-badge aa-badge-${msg.provider}`}>
                      {PROVIDER_LABELS[msg.provider] || msg.provider}
                    </span>
                    {msg.model && <span className="aa-model-tag">{msg.model}</span>}
                    {msg.classified && <span className="aa-classified-tag">auto-routed</span>}
                  </div>
                )}
              </div>
            ))}

            {isStreaming && streamingContent && (
              <div className="aa-msg aa-msg-assistant aa-msg-streaming">
                <div className="aa-msg-content">
                  <MessageContent content={streamingContent} />
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

            <div ref={messagesEndRef} />
          </div>
        </div>

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
            <button
              className="aa-send-btn"
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              aria-label="Send message"
            >&rarr;</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Render message content with basic markdown */
function MessageContent({ content }: { content: string }) {
  const html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
