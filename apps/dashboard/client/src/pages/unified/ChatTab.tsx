import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../../stores/chat';
import type { ConversationMessage, ParsedIntent, Conversation } from '../../stores/chat';
import './ChatTab.css';

// ── Sub-components ──

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="chat-sidebar">
      <button className="chat-new-btn" onClick={onCreate}>+ New Chat</button>
      <div className="chat-conv-list">
        {conversations.map(c => (
          <button
            key={c.id}
            className={`chat-conv-item ${c.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
            title={c.title ?? 'Untitled'}
          >
            <span className="chat-conv-title">{c.title ?? 'Untitled'}</span>
            <span className="chat-conv-date">{new Date(c.updated_at).toLocaleDateString()}</span>
          </button>
        ))}
        {conversations.length === 0 && (
          <div className="chat-conv-empty">No conversations yet</div>
        )}
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`chat-msg ${isUser ? 'chat-msg-user' : 'chat-msg-assistant'}`}>
      <div className="chat-msg-avatar">{isUser ? 'You' : 'AI'}</div>
      <div className="chat-msg-content">
        <div className="chat-msg-text">{message.content}</div>
        <div className="chat-msg-time">
          {new Date(message.created_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

function IntentPreview({
  intent,
  onConfirm,
  onCancel,
}: {
  intent: ParsedIntent;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="chat-intent-preview">
      <div className="chat-intent-header">
        <span className="chat-intent-category">{intent.category}</span>
        <span className="chat-intent-confidence">
          {Math.round(intent.confidence * 100)}% match
        </span>
      </div>
      <div className="chat-intent-summary">{intent.summary}</div>
      <div className="chat-intent-details">
        <div><strong>Agent:</strong> {intent.agentConfig.name}</div>
        <div><strong>Model:</strong> {intent.agentConfig.model}</div>
        <div><strong>Tools:</strong> {intent.agentConfig.tools.join(', ')}</div>
        {intent.templateName && (
          <div><strong>Template:</strong> {intent.templateName}</div>
        )}
        {intent.schedule && (
          <div><strong>Schedule:</strong> Every {intent.schedule}</div>
        )}
      </div>
      <div className="chat-intent-cost">
        Estimated cost: <strong>${intent.estimatedCost.toFixed(2)}</strong>
        {intent.requiresApproval && (
          <span className="chat-intent-approval"> (requires approval)</span>
        )}
      </div>
      <div className="chat-intent-actions">
        <button className="chat-btn chat-btn-primary" onClick={onConfirm}>
          Confirm & Create
        </button>
        <button className="chat-btn chat-btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (msg: string) => void;
  disabled: boolean;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="chat-input-area">
      <textarea
        ref={inputRef}
        className="chat-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Tell me what you need an agent to do..."
        rows={2}
        disabled={disabled}
      />
      <button
        className="chat-send-btn"
        onClick={handleSend}
        disabled={disabled || !input.trim()}
      >
        Send
      </button>
    </div>
  );
}

// ── Main Component ──

export default function ChatTab() {
  const {
    conversations, activeConversationId, messages, isProcessing,
    pendingIntent, error,
    fetchConversations, createConversation, selectConversation,
    sendMessage, confirmIntent, cancelIntent, clearError,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingIntent]);

  const handleNewChat = useCallback(async () => {
    await createConversation();
  }, [createConversation]);

  const handleSend = useCallback(async (content: string) => {
    await sendMessage(content);
  }, [sendMessage]);

  const handleConfirm = useCallback(async () => {
    if (pendingIntent) {
      await confirmIntent(pendingIntent);
    }
  }, [pendingIntent, confirmIntent]);

  return (
    <div className="chat-container">
      <ConversationList
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={selectConversation}
        onCreate={handleNewChat}
      />
      <div className="chat-main">
        <div className="chat-messages">
          {!activeConversationId && messages.length === 0 && (
            <div className="chat-welcome">
              <h2>Welcome to Orcastr8r</h2>
              <p>Tell me what you need done in plain English. I'll create and configure an agent for you.</p>
              <div className="chat-suggestions">
                <button onClick={() => handleSend('Research my top competitors')}>
                  Research my competitors
                </button>
                <button onClick={() => handleSend('Scan my codebase for security issues')}>
                  Security scan
                </button>
                <button onClick={() => handleSend('Monitor my system health every 6 hours')}>
                  System monitoring
                </button>
                <button onClick={() => handleSend('Review recent code changes')}>
                  Code review
                </button>
              </div>
            </div>
          )}

          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {isProcessing && !pendingIntent && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-msg-avatar">AI</div>
              <div className="chat-msg-content">
                <div className="chat-msg-text chat-thinking">Thinking...</div>
              </div>
            </div>
          )}

          {pendingIntent && (
            <IntentPreview
              intent={pendingIntent}
              onConfirm={handleConfirm}
              onCancel={cancelIntent}
            />
          )}

          {error && (
            <div className="chat-error">
              <span>{error}</span>
              <button onClick={clearError}>Dismiss</button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <ChatInput onSend={handleSend} disabled={isProcessing} />
      </div>
    </div>
  );
}
