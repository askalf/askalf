import { useState, useRef, useEffect, useCallback } from 'react';

function getApiUrl() {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  return 'http://localhost:3001';
}

const API_BASE = getApiUrl();

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function SandboxDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [remaining, setRemaining] = useState(3);
  const [sessionToken] = useState(() => crypto.randomUUID());
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || remaining <= 0) return;

    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/demo/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionToken,
          history: messages,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setRemaining(0);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: data.detail || 'Demo limit reached. Sign up for full access!' },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: 'Something went wrong. Try again.' },
          ]);
        }
        return;
      }

      setRemaining(data.remaining ?? 0);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.response }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Connection error. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, remaining, sessionToken, messages]);

  if (!isOpen) {
    return (
      <button className="sandbox-trigger" onClick={() => setIsOpen(true)}>
        <span className="sandbox-trigger-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <span>Try Alf</span>
      </button>
    );
  }

  return (
    <div className="sandbox-container">
      <div className="sandbox-header">
        <div className="sandbox-header-left">
          <div className="sandbox-dot" />
          <span className="sandbox-title">Alf</span>
          <span className="sandbox-badge">Demo</span>
        </div>
        <div className="sandbox-header-right">
          <span className="sandbox-remaining">{remaining} left</span>
          <button className="sandbox-close" onClick={() => setIsOpen(false)} aria-label="Close demo">
            &times;
          </button>
        </div>
      </div>

      <div className="sandbox-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="sandbox-welcome">
            <p className="sandbox-welcome-title">Talk to an AskAlf agent</p>
            <p className="sandbox-welcome-sub">3 messages. Real AI. Ask anything.</p>
            <div className="sandbox-suggestions">
              {['What can AskAlf agents do?', 'How is this different from ChatGPT?', 'Show me a use case'].map((s) => (
                <button
                  key={s}
                  className="sandbox-suggestion"
                  onClick={() => { setInput(s); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`sandbox-msg sandbox-msg-${m.role}`}>
            <div className="sandbox-msg-bubble">{m.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="sandbox-msg sandbox-msg-assistant">
            <div className="sandbox-msg-bubble sandbox-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <div className="sandbox-input-area">
        {remaining > 0 ? (
          <>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Ask Alf anything..."
              disabled={isLoading}
              className="sandbox-input"
              autoFocus
            />
            <button
              className="sandbox-send"
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </>
        ) : (
          <a href="/register" className="sandbox-cta">
            Sign up for full access
          </a>
        )}
      </div>
    </div>
  );
}
