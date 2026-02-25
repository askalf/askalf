import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../../stores/chat';
import type { ConversationMessage, ParsedIntent, IntentSubtask, Conversation } from '../../stores/chat';
import './ChatTab.css';

// ── Sub-components ──

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  const startRename = (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title ?? '');
  };

  const commitRename = (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  };

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  return (
    <div className="chat-sidebar">
      <button className="chat-new-btn" onClick={onCreate}>+ New Chat</button>
      <div className="chat-conv-list">
        {conversations.map(c => (
          <div
            key={c.id}
            className={`chat-conv-item ${c.id === activeId ? 'active' : ''}`}
            onClick={() => { if (editingId !== c.id) onSelect(c.id); }}
            title={c.title ?? 'Untitled'}
          >
            {editingId === c.id ? (
              <input
                ref={editRef}
                className="chat-conv-rename-input"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={() => commitRename(c.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(c.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="chat-conv-title">{c.title ?? 'Untitled'}</span>
                <div className="chat-conv-row">
                  <span className="chat-conv-date">{new Date(c.updated_at).toLocaleDateString()}</span>
                  <span className="chat-conv-actions">
                    <button className="chat-conv-action" onClick={e => startRename(e, c)} title="Rename">R</button>
                    <button className="chat-conv-action chat-conv-action-delete" onClick={e => { e.stopPropagation(); onDelete(c.id); }} title="Delete">X</button>
                  </span>
                </div>
              </>
            )}
          </div>
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

const PATTERN_LABELS: Record<string, { label: string; color: string }> = {
  single: { label: 'Single Agent', color: '#6366f1' },
  pipeline: { label: 'Pipeline', color: '#3b82f6' },
  'fan-out': { label: 'Fan-Out', color: '#8b5cf6' },
  consensus: { label: 'Consensus', color: '#06b6d4' },
};

function SubtaskList({
  subtasks,
  pattern,
}: {
  subtasks: IntentSubtask[];
  pattern: string;
}) {
  const header = pattern === 'pipeline' ? 'Sequential Steps'
    : pattern === 'fan-out' ? 'Parallel Tasks'
    : 'Consensus Agents';

  return (
    <div className="chat-intent-subtasks">
      <div className="chat-intent-subtasks-header">{header}</div>
      {subtasks.map((st, i) => (
        <div key={i} className="chat-intent-subtask">
          <div className="chat-intent-subtask-connector">
            {pattern === 'pipeline'
              ? <span className="chat-intent-subtask-arrow">{i > 0 ? '\u2193' : '\u25CF'}</span>
              : <span className="chat-intent-subtask-parallel">{'\u2502'}</span>}
          </div>
          <div className="chat-intent-subtask-content">
            <div className="chat-intent-subtask-title">
              {st.title}
              <span className="chat-intent-subtask-type">{st.suggestedAgentType}</span>
            </div>
            <div className="chat-intent-subtask-desc">{st.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const TARGET_PLACEHOLDERS: Record<string, string> = {
  research: 'e.g., competitor domain names, market segment...',
  security: 'e.g., apps/forge/, specific endpoint, PR #42...',
  build: 'e.g., apps/dashboard/src/components/, feature branch...',
  analyze: 'e.g., database queries, API response times...',
  monitor: 'e.g., production endpoints, CPU/memory metrics...',
  automate: 'e.g., deployment pipeline, data sync schedule...',
};

const MODEL_OPTIONS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-2.0-flash',
];

function IntentPreview({
  intent,
  onConfirm,
  onCancel,
}: {
  intent: ParsedIntent;
  onConfirm: (modified: ParsedIntent) => void;
  onCancel: () => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const [target, setTarget] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState(intent.agentConfig.model);
  const [maxCost, setMaxCost] = useState(intent.agentConfig.maxCostPerExecution);

  const isMultiAgent = intent.executionMode !== 'single' && intent.subtasks?.length;
  const patternInfo = PATTERN_LABELS[intent.executionMode] ?? PATTERN_LABELS['single']!;
  const placeholder = TARGET_PLACEHOLDERS[intent.category] ?? 'e.g., repository, files, URLs, PR numbers...';

  const handleLaunch = () => {
    const modified = structuredClone(intent);
    const prefix: string[] = [];
    if (target.trim()) prefix.push(`TARGET: ${target.trim()}`);
    if (instructions.trim()) prefix.push(`ADDITIONAL INSTRUCTIONS: ${instructions.trim()}`);
    if (prefix.length) {
      modified.agentConfig.systemPrompt = prefix.join('\n') + '\n\n' + modified.agentConfig.systemPrompt;
    }
    modified.agentConfig.model = model;
    modified.agentConfig.maxCostPerExecution = maxCost;
    modified.estimatedCost = maxCost;
    onConfirm(modified);
  };

  return (
    <div className="chat-intent-preview">
      <div className="chat-intent-header">
        <div className="chat-intent-header-left">
          <span className="chat-intent-category">{intent.category}</span>
          {isMultiAgent && (
            <span className="chat-intent-mode-badge" style={{ background: patternInfo.color }}>
              {patternInfo.label}
            </span>
          )}
        </div>
        <span className="chat-intent-confidence">
          {Math.round(intent.confidence * 100)}% match
        </span>
      </div>
      <div className="chat-intent-summary">{intent.summary}</div>

      {isMultiAgent && intent.subtasks ? (
        <SubtaskList subtasks={intent.subtasks} pattern={intent.executionMode} />
      ) : (
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
      )}

      <div className="chat-intent-cost">
        Budget cap: <strong>${intent.agentConfig.maxCostPerExecution.toFixed(2)}</strong>
        {isMultiAgent && <span className="chat-intent-agent-count"> ({intent.subtasks?.length} agents)</span>}
        {intent.requiresApproval && (
          <span className="chat-intent-approval"> (requires approval)</span>
        )}
      </div>

      {configuring && (
        <div className="chat-intent-configure">
          <div className="chat-intent-field">
            <label>Target — what should this agent work on?</label>
            <input
              type="text"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={placeholder}
              autoFocus
            />
          </div>
          <div className="chat-intent-field">
            <label>Additional instructions (optional)</label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="Any extra context, constraints, or focus areas..."
              rows={2}
            />
          </div>
          <div className="chat-intent-field-row">
            <div className="chat-intent-field">
              <label>Model</label>
              <select value={model} onChange={e => setModel(e.target.value)}>
                {MODEL_OPTIONS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="chat-intent-field">
              <label>Max cost ($)</label>
              <input
                type="number"
                value={maxCost}
                onChange={e => setMaxCost(Number(e.target.value))}
                min={0.01}
                step={0.5}
              />
            </div>
          </div>
        </div>
      )}

      <div className="chat-intent-actions">
        {configuring ? (
          <>
            <button className="chat-btn chat-btn-primary" onClick={handleLaunch}>
              {isMultiAgent ? 'Launch Orchestration' : 'Launch Agent'}
            </button>
            <button className="chat-btn chat-btn-secondary" onClick={() => setConfiguring(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            <button className="chat-btn chat-btn-primary" onClick={() => setConfiguring(true)}>
              Configure
            </button>
            <button className="chat-btn chat-btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
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
    renameConversation, deleteConversation,
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

  const handleConfirm = useCallback(async (modified?: ParsedIntent) => {
    if (modified) {
      await confirmIntent(modified);
    } else if (pendingIntent) {
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
        onRename={renameConversation}
        onDelete={deleteConversation}
      />
      <div className="chat-main">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <h2>Welcome to AskAlf</h2>
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
