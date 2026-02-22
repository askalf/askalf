import { useState, useRef, useEffect, useCallback } from 'react';
import './AdminAssistantPanel.css';

const API_BASE = (() => {
  const host = window.location.hostname;
  if (host.includes('orcastr8r.com') || host.includes('askalf.org') || host.includes('integration.tax')) return '';
  return 'http://localhost:3001';
})();

interface Message {
  role: 'user' | 'assistant';
  content: string;
  actionsExecuted?: { tool: string; result: unknown }[];
}

interface AdminAssistantPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  activeTier: string;
  selectedItemId?: string;
  pageContext?: string;
}

const TIER_SUGGESTIONS: Record<string, string[]> = {
  fleet: ['Fleet health summary', 'Which agents have errors?', 'Agent success rates', 'Agents needing attention'],
  executions: ['Recent failed executions', 'Execution trends today', 'Slowest agents', 'Average execution time'],
  tickets: ['Open urgent tickets', 'Unassigned tickets', 'Ticket resolution rate', 'Overdue tickets'],
  memory: ['Fleet memory stats', 'Recent knowledge entries', 'Memory usage by agent', 'Search fleet memory'],
};

const PAGE_SUGGESTIONS: Record<string, string[]> = {
  agents: ['Fleet overview', 'Agents with errors', 'Schedule health', 'Intervention queue'],
  users: ['Inactive accounts', 'Role distribution', 'Recent signups', 'Active sessions'],
  settings: ['System configuration', 'API key status', 'Service health', 'Database stats'],
  'git-space': ['Active branches', 'Pending reviews', 'Recent merges', 'Agent commits'],
};

const SELECTED_SUGGESTIONS = ['Analyze this agent', 'Show recent executions', 'What tickets are assigned?'];

export default function AdminAssistantPanel({ isOpen, onToggle, activeTier, selectedItemId, pageContext }: AdminAssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: trimmed,
          history: messages,
          context: { currentTier: activeTier, selectedItemId, pageContext },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setMessages([...updatedMessages, { role: 'assistant', content: `Error: ${err.error || res.statusText}` }]);
        return;
      }

      const data = await res.json();
      setMessages([...updatedMessages, {
        role: 'assistant',
        content: data.response,
        actionsExecuted: data.meta?.actionsExecuted,
      }]);
    } catch (err) {
      setMessages([...updatedMessages, { role: 'assistant', content: 'Error: Failed to connect to the assistant API.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const suggestions = selectedItemId
    ? SELECTED_SUGGESTIONS
    : (pageContext && PAGE_SUGGESTIONS[pageContext]?.length)
      ? PAGE_SUGGESTIONS[pageContext]
      : (TIER_SUGGESTIONS[activeTier] || TIER_SUGGESTIONS.fleet);

  // Simple markdown-ish rendering: bold, inline code, code blocks, lists
  const renderContent = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (inCodeBlock) {
          elements.push(<pre key={`code-${i}`} className="assistant-code-block">{codeLines.join('\n')}</pre>);
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // Render inline formatting
      const renderInline = (str: string): React.ReactNode[] => {
        const parts: React.ReactNode[] = [];
        let remaining = str;
        let key = 0;

        while (remaining.length > 0) {
          // Bold
          const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
          // Inline code
          const codeMatch = remaining.match(/`(.+?)`/);

          // Find earliest match
          let earliest: { type: string; match: RegExpMatchArray } | null = null;
          if (boldMatch && boldMatch.index !== undefined) {
            earliest = { type: 'bold', match: boldMatch };
          }
          if (codeMatch && codeMatch.index !== undefined) {
            if (!earliest || codeMatch.index < earliest.match.index!) {
              earliest = { type: 'code', match: codeMatch };
            }
          }

          if (!earliest) {
            parts.push(remaining);
            break;
          }

          const idx = earliest.match.index!;
          if (idx > 0) {
            parts.push(remaining.slice(0, idx));
          }

          if (earliest.type === 'bold') {
            parts.push(<strong key={`b-${key++}`}>{earliest.match[1]}</strong>);
          } else {
            parts.push(<code key={`c-${key++}`} className="assistant-inline-code">{earliest.match[1]}</code>);
          }

          remaining = remaining.slice(idx + earliest.match[0].length);
        }

        return parts;
      };

      if (line.startsWith('- ') || line.startsWith('* ')) {
        elements.push(<div key={i} className="assistant-list-item">{renderInline(line.slice(2))}</div>);
      } else if (/^\d+\.\s/.test(line)) {
        elements.push(<div key={i} className="assistant-list-item numbered">{renderInline(line)}</div>);
      } else if (line.trim() === '') {
        elements.push(<div key={i} className="assistant-spacer" />);
      } else {
        elements.push(<div key={i} className="assistant-line">{renderInline(line)}</div>);
      }
    }

    // Close any unclosed code block
    if (inCodeBlock && codeLines.length > 0) {
      elements.push(<pre key="code-end" className="assistant-code-block">{codeLines.join('\n')}</pre>);
    }

    return elements;
  };

  return (
    <div className={`admin-assistant-panel ${isOpen ? 'open' : 'closed'}`}>
      <div className="admin-panel-header">
        <div className="admin-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
            <path d="M12 15v4" />
            <path d="M8 19h8" />
          </svg>
          System Assistant
        </div>
        <button className="admin-panel-close" onClick={onToggle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="admin-panel-messages">
        {messages.length === 0 && (
          <div className="admin-panel-welcome">
            <div className="welcome-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
                <path d="M12 15v4" />
                <path d="M8 19h8" />
              </svg>
            </div>
            <p>Ask me about fleet health, agent status, tickets, or system diagnostics.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`admin-msg ${msg.role}`}>
            {msg.actionsExecuted && msg.actionsExecuted.length > 0 && (
              <div className="admin-actions-executed">
                <div className="admin-actions-label">Actions executed:</div>
                {msg.actionsExecuted.map((action, j) => (
                  <div key={j} className="admin-action-item">
                    <span className="admin-action-tool">{action.tool.replace(/_/g, ' ')}</span>
                    <span className="admin-action-result">
                      {typeof action.result === 'string' ? action.result : JSON.stringify(action.result)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="admin-msg-content">
              {msg.role === 'assistant' ? renderContent(msg.content) : msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="admin-msg assistant">
            <div className="admin-msg-content">
              <div className="admin-typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="admin-panel-suggestions">
        {suggestions.map((s) => (
          <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)} disabled={isLoading}>
            {s}
          </button>
        ))}
      </div>

      <div className="admin-panel-input">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about fleet health, agents, tickets..."
          rows={1}
          disabled={isLoading}
        />
        <button
          className="admin-send-btn"
          onClick={() => sendMessage(input)}
          disabled={isLoading || !input.trim()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M22 2L11 13" />
            <path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
