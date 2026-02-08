import { useEffect, useState } from 'react';
import { type Message } from '../../stores/chat';
import SmartRouterBadge from './SmartRouterBadge';
import clsx from 'clsx';

const FIRST_SHARD_HIT_KEY = 'alf_first_shard_hit_seen';

interface MessageBubbleProps {
  message: Message;
  isLatest: boolean;
}

export default function MessageBubble({ message, isLatest }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming && message.content === '';
  const [showFirstHitCelebration, setShowFirstHitCelebration] = useState(false);

  useEffect(() => {
    if (message.shardHit && isLatest) {
      const seen = localStorage.getItem(FIRST_SHARD_HIT_KEY);
      if (!seen) {
        setShowFirstHitCelebration(true);
        localStorage.setItem(FIRST_SHARD_HIT_KEY, 'true');
      }
    }
  }, [message.shardHit, isLatest]);

  return (
    <div
      className={clsx(
        'message',
        isUser ? 'message-user' : 'message-assistant',
        isLatest && (isUser ? 'animate-message-user' : 'animate-message-alf'),
        message.shardHit && 'message-shard-hit'
      )}
    >
      {!isUser && (
        <div className="message-avatar">
          <span className="message-avatar-icon">👽</span>
        </div>
      )}

      <div className="message-content-wrapper">
        <div className="message-content">
          {isStreaming ? (
            <span className="message-cursor">▊</span>
          ) : (
            <div className="message-text">{message.content}</div>
          )}
        </div>

        {/* Knowledge Shard - Free instant answer */}
        {message.shardHit && (
          <div className="message-shard-badge animate-shard-pulse">
            <div className="shard-badge-header">
              <span className="shard-badge-icon">⚡</span>
              <span className="shard-badge-label">
                {message.shardHit.knowledgeType === 'immutable' ? 'IMMUTABLE SHARD' :
                 message.shardHit.knowledgeType === 'temporal' ? 'TEMPORAL SHARD' :
                 message.shardHit.knowledgeType === 'contextual' ? 'CONTEXTUAL SHARD' :
                 'KNOWLEDGE SHARD'}
              </span>
              <span className="shard-badge-free">FREE</span>
            </div>
            <div className="shard-badge-name">{message.shardHit.shardName}</div>
            <div className="shard-badge-description">
              ALF already knew this. Zero cost, instant answer.
            </div>
            {showFirstHitCelebration && (
              <div className="shard-badge-celebration">
                Your first free answer! ALF already knew this. Every matching question from now on costs nothing.
              </div>
            )}
            <div className="shard-badge-savings">
              <div className="shard-saving-item">
                <span className="shard-saving-icon">🪙</span>
                <span className="shard-saving-value">~{message.shardHit.tokensSaved || 0}</span>
                <span className="shard-saving-label">tokens saved</span>
              </div>
              <div className="shard-saving-item">
                <span className="shard-saving-icon">💧</span>
                <span className="shard-saving-value">~{message.shardHit.waterSaved || 0} mL</span>
                <span className="shard-saving-label">water saved</span>
              </div>
              <div className="shard-saving-item">
                <span className="shard-saving-icon">⚡</span>
                <span className="shard-saving-value">~{message.shardHit.powerSaved || 0} Wh</span>
                <span className="shard-saving-label">power saved</span>
              </div>
              <div className="shard-saving-item">
                <span className="shard-saving-icon">🚀</span>
                <span className="shard-saving-value">~{message.responseMs || 3}ms</span>
                <span className="shard-saving-label">response</span>
              </div>
            </div>
          </div>
        )}

        {/* LLM Response Metadata */}
        {!isUser && message.model && !message.shardHit && !isStreaming && (
          <div className="message-meta">
            {/* Smart Router Badge - shows routing decision */}
            {message.smartRouter ? (
              <SmartRouterBadge info={message.smartRouter} />
            ) : (
              <span className="message-meta-model">{formatModel(message.model)}</span>
            )}
            {message.responseMs && (
              <span className="message-meta-speed">{message.responseMs}ms</span>
            )}
            {message.tokensUsed && (
              <span className="message-meta-tokens">{message.tokensUsed} tokens</span>
            )}
            {message.intent && (
              <span className="message-meta-intent" title={message.intent.name}>
                {message.intent.category}
              </span>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className="message-timestamp">
          {formatTimestamp(message.createdAt)}
        </div>
      </div>

      {isUser && (
        <div className="message-avatar message-avatar-user">
          <span className="message-avatar-icon">👤</span>
        </div>
      )}
    </div>
  );
}

function formatModel(model: string): string {
  const names: Record<string, string> = {
    // OpenAI
    'gpt-5.2': 'GPT-5.2',
    'gpt-5.2-pro': 'GPT-5.2 Pro',
    'gpt-5-mini': 'GPT-5 Mini',
    'gpt-5-nano': 'GPT-5 Nano',
    'gpt-5': 'GPT-5',
    'gpt-4.1': 'GPT-4.1',
    'gpt-4.1-nano': 'GPT-4.1 Nano',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'o3': 'o3',
    'o3-pro': 'o3 Pro',
    'o1': 'o1',
    'o1-pro': 'o1 Pro',
    'o4-mini': 'o4-mini',
    // Anthropic
    'claude-sonnet-4-5': 'Sonnet 4.5',
    'claude-sonnet-4-0': 'Sonnet 4',
    'claude-opus-4-5': 'Opus 4.5',
    'claude-opus-4-1': 'Opus 4.1',
    'claude-opus-4-0': 'Opus 4',
    'claude-haiku-4-5': 'Haiku 4.5',
    'claude-3-7-sonnet-latest': 'Sonnet 3.7',
    'claude-3-haiku-20240307': 'Haiku 3',
    // Google
    'gemini-3-pro-preview': 'Gemini 3 Pro',
    'gemini-3-flash-preview': 'Gemini 3 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Lite',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    // xAI
    'grok-4': 'Grok 4',
    'grok-4-1-fast-reasoning': 'Grok 4.1 Fast',
    'grok-3': 'Grok 3',
    'grok-3-mini-beta': 'Grok 3 Mini',
    'grok-2-1212': 'Grok 2',
    // Local
    'ollama/llama3.2': 'Llama 3.2',
    'ollama/deepseek-coder': 'DeepSeek',
    'ollama/qwen2.5-coder': 'Qwen 2.5',
    'lmstudio/local': 'LM Studio',
  };
  return names[model] || model;
}

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 1 minute
  if (diff < 60000) {
    return 'just now';
  }

  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }

  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Same year - show date without year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Different year - show full date
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

