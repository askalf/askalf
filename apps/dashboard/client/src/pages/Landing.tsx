import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { trackClick } from '../utils/trackClick';
import { useBugReport } from '../contexts/BugReportContext';
import HeaderMenu from '../components/layout/HeaderMenu';
import './Landing.css';

// API base URL
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return '';
};

const API_BASE = getApiUrl();

interface DemoMessage {
  role: 'user' | 'assistant';
  content: string;
  shardHit?: {
    shardName: string;
    tokensSaved: number;
    executionMs: number;
  };
  knowledgeType?: string;
  matchMethod?: string;
  smartRouter?: {
    tier: string;
    model: string;
    reason: string;
    confidence: number;
  };
  environmental?: {
    tokensSaved: number;
    waterMlSaved: number;
    powerWhSaved: number;
    carbonGSaved: number;
  };
  memoryContext?: boolean;
  tokensUsed?: number;
  executionMs?: number;
  hint?: string | null;
}

interface Suggestion {
  name: string;
  description: string;
  query: string;
}

interface LiveStats {
  tokensSaved: number;
  shardHits: number;
}

const DEMO_SESSION_KEY = 'alf_demo_session';
const DEMO_MESSAGES_KEY = 'alf_demo_messages';

// Format water saved based on tokens (500ml per 1000 tokens)
function formatWaterSaved(tokensSaved: number): string {
  const waterMl = Math.round((tokensSaved / 1000) * 500);
  if (waterMl < 1000) {
    return `${waterMl}ml saved`;
  }
  return `${(waterMl / 1000).toFixed(1)}L saved`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function formatModel(model: string): string {
  const map: Record<string, string> = {
    'claude-sonnet-4-5': 'Sonnet 4.5',
    'claude-haiku-3-5': 'Haiku 3.5',
    'claude-opus-4': 'Opus 4',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gemini-2.0-flash': 'Gemini Flash',
    'gemini-2.5-pro': 'Gemini Pro',
    'grok-3': 'Grok 3',
    'grok-3-mini': 'Grok 3 Mini',
  };
  return map[model] || model.split('/').pop() || model;
}

function formatKnowledgeType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

export default function Landing() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuthStore();
  const { openBugReport } = useBugReport();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [interactionsRemaining, setInteractionsRemaining] = useState<number | null>(null);
  const [showSignupPrompt, setShowSignupPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const demoChatRef = useRef<HTMLDivElement>(null);

  // Force dark theme on Landing page
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.';

    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  // If user is logged in, redirect to chat
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/app', { replace: true });
    }
  }, [user, authLoading, navigate]);

  // Fetch live stats + suggestions
  useEffect(() => {
    const fetchLiveStats = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/demo/environmental`);
        if (res.ok) {
          const data = await res.json();
          setLiveStats({
            tokensSaved: data.global?.tokensSaved || data.tokensSaved || 0,
            shardHits: data.global?.shardHits || data.shardHits || 0,
          });
        }
      } catch {
        // Silently fail
      }
    };

    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/onboarding/suggestions`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
        }
      } catch {
        // Silently fail
      }
    };

    fetchLiveStats();
    fetchSuggestions();
  }, []);

  // Restore session from localStorage on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedToken = localStorage.getItem(DEMO_SESSION_KEY);
        const savedMessages = localStorage.getItem(DEMO_MESSAGES_KEY);

        if (savedToken) {
          // Verify session is still valid
          const res = await fetch(`${API_BASE}/api/v1/demo/session/${savedToken}`);
          if (res.ok) {
            const data = await res.json();
            setSessionToken(savedToken);
            setInteractionsRemaining(data.interactionsRemaining);

            if (savedMessages) {
              setMessages(JSON.parse(savedMessages));
            }

            if (data.interactionsRemaining <= 0) {
              setShowSignupPrompt(true);
            }
          } else {
            localStorage.removeItem(DEMO_SESSION_KEY);
            localStorage.removeItem(DEMO_MESSAGES_KEY);
          }
        }
      } catch (err) {
        localStorage.removeItem(DEMO_SESSION_KEY);
        localStorage.removeItem(DEMO_MESSAGES_KEY);
      } finally {
        setIsRestoring(false);
      }
    };

    restoreSession();
  }, []);

  // Persist messages to localStorage when they change
  useEffect(() => {
    if (messages.length > 0 && sessionToken) {
      localStorage.setItem(DEMO_MESSAGES_KEY, JSON.stringify(messages));
    }
  }, [messages, sessionToken]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const createDemoSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/demo/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: getFingerprint() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create demo session');
      }

      const data = await res.json();
      setSessionToken(data.sessionToken);
      setInteractionsRemaining(data.interactionsRemaining);
      localStorage.setItem(DEMO_SESSION_KEY, data.sessionToken);
      return data.sessionToken;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start demo');
      return null;
    }
  };

  const sendMessage = async (messageText?: string) => {
    const userMessage = (messageText || input).trim();
    if (!userMessage || isLoading) return;

    if (!messageText) setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    // Scroll to demo chat section
    setTimeout(() => {
      demoChatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    try {
      let token = sessionToken;
      if (!token) {
        token = await createDemoSession();
        if (!token) {
          setIsLoading(false);
          return;
        }
      }

      if (interactionsRemaining !== null && interactionsRemaining <= 0) {
        setShowSignupPrompt(true);
        setIsLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/api/v1/demo/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionToken: token,
          message: userMessage,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429 || data.code === 'DEMO_LIMIT_REACHED') {
          setShowSignupPrompt(true);
          setInteractionsRemaining(0);
        } else {
          throw new Error(data.error || 'Failed to send message');
        }
        setIsLoading(false);
        return;
      }

      const assistantMessage: DemoMessage = {
        role: 'assistant',
        content: data.response,
        executionMs: data.executionMs ?? undefined,
        tokensUsed: data.tokensUsed ?? undefined,
        memoryContext: data.memoryContext ?? undefined,
        matchMethod: data.matchMethod ?? undefined,
        knowledgeType: data.knowledgeType ?? undefined,
        hint: data.hint ?? null,
        smartRouter: data.smartRouter ?? undefined,
        environmental: data.environmental ?? undefined,
      };

      if (data.isShardHit && data.shardName) {
        assistantMessage.shardHit = {
          shardName: data.shardName,
          tokensSaved: data.environmental?.tokensSaved ?? 500,
          executionMs: data.executionMs ?? 0,
        };
      }

      setMessages(prev => [...prev, assistantMessage]);
      setInteractionsRemaining(data.interactionsRemaining ?? null);

      if (data.interactionsRemaining <= 0) {
        setShowSignupPrompt(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getFingerprint = () => {
    const nav = window.navigator;
    return btoa(`${nav.userAgent}-${nav.language}-${screen.width}x${screen.height}`).slice(0, 32);
  };

  if (authLoading || isRestoring) {
    return (
      <div className="landing-loading">
        <span className="landing-loading-icon">👽</span>
      </div>
    );
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="landing">
      {/* Header */}
      <header className="landing-header">
        <div className="landing-logo">
          <span className="landing-logo-icon">👽</span>
          <span className="landing-logo-text">
            <span className="landing-logo-ask">Ask</span>
            <span className="landing-logo-alf">ALF</span>
          </span>
          <span className="beta-badge">Public Beta</span>
        </div>

        <div className="landing-header-right">
          <HeaderMenu />
          <Link to="/login" className="landing-btn landing-btn-secondary" onClick={() => trackClick('login')}>
            Log in
          </Link>
          <Link to="/signup" className="landing-btn landing-btn-primary" onClick={() => trackClick('signup')}>
            Sign up for free
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="landing-main-full">
        {/* Hero Section */}
        <section className="landing-hero">
          <h1 className="landing-hero-title">It remembers. It evolves. <span className="landing-hero-accent">It replaces itself.</span></h1>
          <p className="landing-hero-subtitle">Not a chatbot. Not a wrapper. A living intelligence.</p>
          <p className="landing-hero-description">
            ALF doesn't call a model and forget. It runs a metabolic loop — crystallizing what it
            learns, evolving what fails, verifying what it knows, and replacing itself when something
            better exists. The longer it runs, the smarter and cheaper it gets.
          </p>
        </section>

        {/* Four Pillars */}
        <section className="landing-pillars">
          <div className="landing-pillar">
            <div className="landing-pillar-badge">Autonomous</div>
            <div className="landing-pillar-icon">🔬</div>
            <h3 className="landing-pillar-title">The system breathes</h3>
            <p className="landing-pillar-text">
              Sixteen autonomous systems run continuously -- crystallizing knowledge, evolving shards
              that fail, recalibrating confidence, and extracting lessons from mistakes. Every shard
              carries its own death condition. No human oversight required.
            </p>
          </div>
          <div className="landing-pillar">
            <div className="landing-pillar-badge">4 types</div>
            <div className="landing-pillar-icon">💎</div>
            <h3 className="landing-pillar-title">Four types of knowledge</h3>
            <p className="landing-pillar-text">
              Immutable facts that never decay. Temporal knowledge verified nightly. Contextual
              shards that stay private to you. Procedural patterns that follow a full promotion
              lifecycle. Each type has its own rules, its own lifespan, its own confidence score.
            </p>
          </div>
          <div className="landing-pillar">
            <div className="landing-pillar-badge">Real-time</div>
            <div className="landing-pillar-icon">🤖</div>
            <h3 className="landing-pillar-title">It evolves HOW it thinks</h3>
            <p className="landing-pillar-text">
              A shadow classifier evaluates every query in parallel, building its own replacement
              for the matching engine in real time. ALF doesn't just answer -- it evolves how
              it thinks, in production, while you wait.
            </p>
          </div>
          <div className="landing-pillar">
            <div className="landing-pillar-badge">Zero cost</div>
            <div className="landing-pillar-icon">📉</div>
            <h3 className="landing-pillar-title">Gets cheaper the smarter it gets</h3>
            <p className="landing-pillar-text">
              Every shard hit is a free answer -- zero tokens, zero cost, under 50ms. As ALF
              learns more, the ratio of free answers to paid calls goes up. Your cost per query
              goes down over time, not up.
            </p>
          </div>
        </section>

        {/* Live Counter */}
        {liveStats && (liveStats.tokensSaved > 0 || liveStats.shardHits > 0) && (
          <section className="landing-live-counter">
            <div className="landing-live-stat">
              <span className="landing-live-value">{formatNumber(liveStats.tokensSaved)}</span>
              <span className="landing-live-label">tokens saved globally</span>
            </div>
            <div className="landing-live-divider" />
            <div className="landing-live-stat">
              <span className="landing-live-value">{formatNumber(liveStats.shardHits)}</span>
              <span className="landing-live-label">free answers delivered</span>
            </div>
          </section>
        )}

        {/* Deep Dive Link */}
        <section className="landing-deep-dive">
          <Link to="/our-solution" className="landing-btn landing-btn-secondary" onClick={() => trackClick('our-solution')}>
            See all sixteen systems &rarr;
          </Link>
        </section>

        {/* Demo Chat Section */}
        <section className="landing-demo" ref={demoChatRef}>
          <h2 className="landing-demo-title">Try it now</h2>
          <p className="landing-demo-subtitle">
            Ask anything below. Questions that hit a knowledge shard are answered instantly for free.
          </p>

          {/* Suggestion pills */}
          {!hasMessages && suggestions.length > 0 && (
            <div className="landing-demo-suggestions">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className="landing-demo-suggestion"
                  onClick={() => sendMessage(s.query)}
                  title={s.description}
                >
                  <span className="landing-demo-suggestion-icon">⚡</span>
                  <span>{s.query}</span>
                  <span className="landing-demo-suggestion-badge">Instant</span>
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          {hasMessages && (
            <div className="landing-messages">
              {messages.map((msg, i) => (
                <div key={i} className={`landing-message landing-message-${msg.role}${msg.shardHit ? ' landing-message-shard-hit' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="landing-message-avatar">👽</div>
                  )}
                  <div className="landing-message-content-wrapper">
                    <div className="landing-message-content">
                      {msg.content}
                    </div>
                    {msg.shardHit && (
                      <div className="landing-shard-badge">
                        <div className="landing-shard-badge-header">
                          <span className="landing-shard-badge-icon">⚡</span>
                          <span className="landing-shard-badge-label">
                            {msg.knowledgeType ? `${formatKnowledgeType(msg.knowledgeType)} SHARD` : 'KNOWLEDGE SHARD'}
                          </span>
                          {msg.matchMethod && (
                            <span className="landing-shard-badge-method">{msg.matchMethod}</span>
                          )}
                          <span className="landing-shard-badge-free">FREE</span>
                        </div>
                        <div className="landing-shard-badge-name">{msg.shardHit.shardName}</div>
                        <div className="landing-shard-badge-stats">
                          <span>🪙 {msg.shardHit.tokensSaved} tokens saved</span>
                          <span>💧 {formatWaterSaved(msg.shardHit.tokensSaved)}</span>
                          <span>🚀 {msg.shardHit.executionMs}ms</span>
                        </div>
                      </div>
                    )}
                    {msg.role === 'assistant' && !msg.shardHit && (
                      <div className="landing-telemetry">
                        {msg.executionMs !== undefined && (
                          <span className="landing-telemetry-item">
                            <span className="landing-telemetry-icon">⏱</span>
                            {msg.executionMs}ms
                          </span>
                        )}
                        {msg.memoryContext && (
                          <span className="landing-telemetry-item landing-telemetry-memory">
                            <span className="landing-telemetry-icon">🧠</span>
                            Memory active
                          </span>
                        )}
                        {msg.smartRouter && (
                          <>
                            <span className="landing-telemetry-item landing-telemetry-router">
                              <span className="landing-telemetry-icon">🔀</span>
                              {msg.smartRouter.tier}
                            </span>
                            <span className="landing-telemetry-item landing-telemetry-model">
                              <span className="landing-telemetry-icon">🤖</span>
                              {formatModel(msg.smartRouter.model)}
                            </span>
                          </>
                        )}
                        <span className="landing-telemetry-item">
                          <span className="landing-telemetry-icon">🪙</span>
                          {msg.tokensUsed ?? '?'} tokens
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="landing-message landing-message-assistant">
                  <div className="landing-message-avatar">👽</div>
                  <div className="landing-message-content landing-typing">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Signup Prompt */}
          {showSignupPrompt && (
            <div className="landing-signup-prompt">
              <div className="landing-signup-prompt-content">
                <h3>Ready for more?</h3>
                <p>You've used your free preview. Sign up to continue chatting with ALF for free.</p>
                <div className="landing-signup-prompt-actions">
                  <Link to="/signup" className="landing-btn landing-btn-primary" onClick={() => trackClick('signup')}>
                    Sign up for free
                  </Link>
                  <Link to="/login" className="landing-btn landing-btn-secondary" onClick={() => trackClick('login')}>
                    Already have an account? Log in
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className={`landing-input-container ${hasMessages ? 'has-messages' : ''}`}>
            {error && <div className="landing-error">{error}</div>}
            <div className="landing-input-wrapper">
              <textarea
                ref={inputRef}
                className="landing-input"
                placeholder="Ask anything"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || showSignupPrompt}
                rows={1}
              />
              <button
                className="landing-send-btn"
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading || showSignupPrompt}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
            {interactionsRemaining !== null && interactionsRemaining > 0 && (
              <div className="landing-interactions-hint">
                {interactionsRemaining} message{interactionsRemaining !== 1 ? 's' : ''} remaining in demo
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <span>By messaging Ask ALF, you agree to our </span>
        <a href="/terms">Terms</a>
        <span> and have read our </span>
        <a href="/privacy" onClick={() => trackClick('privacy')}>Privacy Policy</a>
        <span>.</span>
        <span className="landing-footer-divider">|</span>
        <button className="landing-footer-bug" onClick={openBugReport}>Report an issue</button>
      </footer>
    </div>
  );
}
