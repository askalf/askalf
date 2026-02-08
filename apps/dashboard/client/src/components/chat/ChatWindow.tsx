import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import MessageBubble from './MessageBubble';
import InputBar from './InputBar';
import TypingIndicator from './TypingIndicator';
import './Chat.css';

const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return '';
};

const API_BASE = getApiUrl();

interface Suggestion {
  name: string;
  description: string;
  query: string;
}

export default function ChatWindow() {
  const { messages, isLoading, billingStatus, showBillingPrompt, dismissBillingPrompt } = useChatStore();
  const { user } = useAuthStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const isEmpty = messages.length === 0;

  const handleUpgrade = () => {
    navigate('/settings?tab=billing');
    dismissBillingPrompt();
  };

  const handleBuyBundle = () => {
    navigate('/settings?tab=billing');
    dismissBillingPrompt();
  };

  return (
    <div className="chat-window">
      {/* Billing Prompt Banner */}
      {showBillingPrompt && billingStatus && (
        <BillingPrompt
          billingStatus={billingStatus}
          userPlan={user?.plan || 'free'}
          onUpgrade={handleUpgrade}
          onBuyBundle={handleBuyBundle}
          onDismiss={dismissBillingPrompt}
        />
      )}

      <div className="chat-messages">
        {isEmpty ? (
          <WelcomeScreen />
        ) : (
          <>
            {messages
              .filter((m) => !(m.isStreaming && m.content === ''))
              .map((message, index, filtered) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isLatest={index === filtered.length - 1}
                />
              ))}
            {isLoading && <TypingIndicator />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-footer">
        <InputBar />
        <AccumulationBar />
      </div>
    </div>
  );
}

function WelcomeScreen() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const { sendMessage } = useChatStore();

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/onboarding/suggestions`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
        }
      } catch {
        // Silently fail -- suggestions are optional
      }
    };
    fetchSuggestions();
  }, []);

  const handleSuggestionClick = (query: string) => {
    sendMessage(query);
  };

  return (
    <div className="chat-welcome">
      <div className="chat-welcome-logo">
        <span className="chat-welcome-logo-icon">👽</span>
        <span className="chat-welcome-logo-text">
          <span className="chat-welcome-ask">Ask</span>
          <span className="chat-welcome-alf">ALF</span>
        </span>
      </div>

      <h1 className="chat-welcome-title">The more you use ALF, the less it costs.</h1>

      <p className="chat-welcome-hint">
        Every answer ALF learns becomes a shard — crystallized knowledge that responds instantly, costs nothing, and stays yours.
      </p>

      {suggestions.length > 0 && (
        <div className="chat-welcome-suggestions">
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="chat-welcome-suggestion"
              onClick={() => handleSuggestionClick(s.query)}
              title={s.description}
            >
              <span className="chat-suggestion-icon">⚡</span>
              <span className="chat-suggestion-text">{s.query}</span>
              <span className="chat-suggestion-badge">Instant</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface BillingPromptProps {
  billingStatus: {
    suggestUpgrade: boolean;
    suggestBundle: boolean;
    usage: {
      dailyUsed: number;
      dailyLimit: number;
      bundleTokens: number;
      hasByok: boolean;
    };
    source: string;
  };
  userPlan: string;
  onUpgrade: () => void;
  onBuyBundle: () => void;
  onDismiss: () => void;
}

function AccumulationBar() {
  const { user } = useAuthStore();
  const chatShardHits = useChatStore((s) => s.sessionStats.shardHits);
  const [stats, setStats] = useState<{ shardHits: number; tokensSaved: number } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/user/shard-stats`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [user, chatShardHits, fetchStats]);

  if (!user || !stats) return null;

  const { shardHits, tokensSaved } = stats;

  // Derive environmental impact using same formulas as backend
  const waterMl = Math.round((tokensSaved / 1000) * 500);
  const powerWh = parseFloat(((tokensSaved / 1000) * 10).toFixed(1));

  const fmt = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  // Don't show bar if zero activity
  if (shardHits === 0) return null;

  return (
    <div className="environment-stats" title="Your account's total shard impact this month">
      <div className="environment-stat">
        <svg className="environment-stat-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span className="environment-stat-value">{fmt(shardHits)}</span>
        <span className="environment-stat-label">hits</span>
      </div>
      <div className="environment-stat">
        <svg className="environment-stat-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <circle cx="12" cy="12" r="8" />
          <path d="M14.5 9a3.5 3.5 0 0 0-5 0 3.5 3.5 0 0 0 0 5 3.5 3.5 0 0 0 5 0" />
          <path d="M12 6v2M12 16v2" />
        </svg>
        <span className="environment-stat-value">{fmt(tokensSaved)}</span>
        <span className="environment-stat-label">tokens saved</span>
      </div>
      <div className="environment-stat">
        <svg className="environment-stat-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
        </svg>
        <span className="environment-stat-value">{fmt(waterMl)}ml</span>
        <span className="environment-stat-label">water</span>
      </div>
      <div className="environment-stat">
        <svg className="environment-stat-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
        <span className="environment-stat-value">{fmt(powerWh)}Wh</span>
        <span className="environment-stat-label">power</span>
      </div>
    </div>
  );
}

function BillingPrompt({ billingStatus, userPlan, onUpgrade, onBuyBundle, onDismiss }: BillingPromptProps) {
  const { usage, suggestBundle } = billingStatus;

  // Only show upgrade option for free and basic tiers
  // Pro, lifetime, team, enterprise users can only buy credits (no upgrade path except teams)
  const canUpgrade = ['free', 'basic'].includes(userPlan);
  const usagePercent = usage.dailyLimit > 0 ? Math.round((usage.dailyUsed / usage.dailyLimit) * 100) : 0;
  const isLimitReached = usage.dailyUsed >= usage.dailyLimit && usage.dailyLimit > 0;
  const isLow = usagePercent >= 80 && !isLimitReached;

  // Determine message and type
  let message = '';
  let type: 'warning' | 'critical' | 'info' = 'info';

  if (isLimitReached) {
    if (usage.bundleTokens > 0) {
      message = `Daily limit reached. Using bundle credits (${usage.bundleTokens.toLocaleString()} remaining).`;
      type = 'warning';
    } else {
      message = `Daily limit reached (${usage.dailyUsed}/${usage.dailyLimit}). Get more credits to continue.`;
      type = 'critical';
    }
  } else if (isLow) {
    message = `${usagePercent}% of daily credits used (${usage.dailyUsed}/${usage.dailyLimit}).`;
    type = 'warning';
  } else if (canUpgrade || suggestBundle) {
    message = `${usage.dailyUsed}/${usage.dailyLimit} credits used today.`;
    type = 'info';
  }

  if (!message) return null;

  return (
    <div className={`billing-prompt billing-prompt-${type}`}>
      <div className="billing-prompt-content">
        <span className="billing-prompt-icon">
          {type === 'critical' ? '⚠️' : type === 'warning' ? '💡' : 'ℹ️'}
        </span>
        <span className="billing-prompt-message">{message}</span>
      </div>
      <div className="billing-prompt-actions">
        {suggestBundle && (
          <button className="billing-prompt-btn bundle" onClick={onBuyBundle}>
            Buy Credits
          </button>
        )}
        {canUpgrade && (
          <button className="billing-prompt-btn upgrade" onClick={onUpgrade}>
            Upgrade Plan
          </button>
        )}
        <button className="billing-prompt-dismiss" onClick={onDismiss} title="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
