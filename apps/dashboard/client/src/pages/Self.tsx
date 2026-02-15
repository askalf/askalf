import { useEffect, useRef, useState, useCallback } from 'react';
import { useSelfStore } from '../stores/self';
import { useSelfApi } from '../hooks/useSelfApi';
import type { SelfAction } from '../hooks/useSelfApi';
import './Self.css';

export default function Self() {
  const {
    conversations,
    activeConversationId,
    messages,
    isStreaming,
    streamingContent,
    isLoading,
    error,
    fetchConversations,
    createConversation,
    setActiveConversation,
    sendMessage,
    clearError,
  } = useSelfStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations on mount
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Auto-create first conversation if none exist
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

  // Handle URL params (OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const connError = params.get('connection_error');
    if (connected || connError) {
      window.history.replaceState({}, '', '/self');
    }
  }, []);

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

  return (
    <div className="self-page">
      <div className="self-header">
        <span className="self-header-title">
          {conversations.find(c => c.id === activeConversationId)?.title || 'New Conversation'}
        </span>
        <button className="self-new-btn" onClick={handleNewConversation}>
          + New
        </button>
      </div>

      <div className="self-messages">
        <div className="self-messages-inner">
          {messages.map((msg) => (
            <div key={msg.id} className={`self-msg self-msg-${msg.role}`}>
              <MessageContent content={msg.content} />
              {msg.actions && msg.actions.length > 0 && (
                <ActionCards actions={msg.actions} />
              )}
            </div>
          ))}

          {isStreaming && streamingContent && (
            <div className="self-msg self-msg-assistant self-msg-streaming">
              <MessageContent content={streamingContent} />
            </div>
          )}

          {isStreaming && !streamingContent && (
            <div className="self-loading">
              <div className="self-loading-dot" />
              <div className="self-loading-dot" />
              <div className="self-loading-dot" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '0.5rem 1rem', background: '#7f1d1d', color: '#fca5a5', fontSize: '0.8125rem', textAlign: 'center', cursor: 'pointer' }} onClick={clearError}>
          {error} (click to dismiss)
        </div>
      )}

      <div className="self-input-area">
        <div className="self-input-wrapper">
          <textarea
            ref={inputRef}
            className="self-input"
            placeholder="Message Self..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            rows={1}
          />
          <button
            className="self-send-btn"
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            aria-label="Send message"
          >
            &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}

/** Render message content with basic markdown */
function MessageContent({ content }: { content: string }) {
  // Simple markdown: **bold**, `code`, newlines
  const html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Render inline action cards */
function ActionCards({ actions }: { actions: SelfAction[] }) {
  const api = useSelfApi();

  const handleConnect = async (provider: string) => {
    try {
      const authUrl = await api.getAuthUrl(provider);
      window.open(authUrl, '_blank', 'width=600,height=700');
    } catch (err) {
      console.error('Failed to get auth URL:', err);
    }
  };

  const [credentialValue, setCredentialValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveCredential = async (provider: string) => {
    if (!credentialValue.trim() || saving) return;
    setSaving(true);
    try {
      await api.saveCredential(provider, 'api_key', credentialValue.trim());
      setCredentialValue('');
    } catch (err) {
      console.error('Failed to save credential:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="self-actions">
      {actions.map((action, i) => {
        if (action.type === 'connect' && action.provider) {
          return (
            <button
              key={i}
              className={`self-action-btn ${action.status === 'connected' ? 'connected' : ''}`}
              onClick={() => handleConnect(action.provider!)}
              disabled={action.status === 'connected'}
            >
              Connect {action.provider.charAt(0).toUpperCase() + action.provider.slice(1)}
            </button>
          );
        }
        if (action.type === 'credential' && action.provider) {
          return (
            <div key={i} className="self-credential-input">
              <input
                type="password"
                placeholder={`${action.provider} API key`}
                value={credentialValue}
                onChange={(e) => setCredentialValue(e.target.value)}
              />
              <button onClick={() => handleSaveCredential(action.provider!)} disabled={saving}>
                {saving ? '...' : 'Save'}
              </button>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
