import { useState } from 'react';
import './SmartRouterBadge.css';

interface SmartRouterInfo {
  tier: 'nano' | 'pro' | 'reasoning' | 'local';
  selectedModel: string;
  provider: string;
  reason: string;
  confidence: number;
  complexity: number;
  analysisMs: number;
}

interface SmartRouterBadgeProps {
  info: SmartRouterInfo;
}

const TIER_DISPLAY: Record<string, { label: string; color: string; description: string }> = {
  nano: {
    label: 'Nano',
    color: '#10b981',
    description: 'Fast & efficient for simple queries',
  },
  pro: {
    label: 'Pro',
    color: '#3b82f6',
    description: 'Balanced capability for standard tasks',
  },
  reasoning: {
    label: 'Reasoning',
    color: '#9333ea',
    description: 'Maximum capability for complex problems',
  },
  local: {
    label: 'Local',
    color: '#6b7280',
    description: 'Privacy-first, zero cloud processing',
  },
};

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
};

export default function SmartRouterBadge({ info }: SmartRouterBadgeProps) {
  const [showDetails, setShowDetails] = useState(false);
  const tierInfo = TIER_DISPLAY[info.tier] || TIER_DISPLAY.pro;

  return (
    <div className="smart-router-badge-container">
      <button
        className="smart-router-badge"
        onClick={() => setShowDetails(!showDetails)}
        style={{ '--tier-color': tierInfo.color } as React.CSSProperties}
        title="Click to see routing details"
      >
        <span className="smart-router-badge-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
            <path d="M4 4l1.5 1.5M10.5 10.5L12 12M4 12l1.5-1.5M10.5 5.5L12 4" />
          </svg>
        </span>
        <span className="smart-router-badge-tier">{tierInfo.label}</span>
        <span className="smart-router-badge-model">{info.selectedModel}</span>
      </button>

      {showDetails && (
        <div className="smart-router-details">
          <div className="smart-router-details-header">
            <span className="smart-router-details-title">Smart Router Decision</span>
            <button
              className="smart-router-details-close"
              onClick={() => setShowDetails(false)}
            >
              &times;
            </button>
          </div>

          <div className="smart-router-details-content">
            <div className="smart-router-detail-row">
              <span className="smart-router-detail-label">Tier</span>
              <span
                className="smart-router-detail-value tier-value"
                style={{ color: tierInfo.color }}
              >
                {tierInfo.label}
              </span>
            </div>

            <div className="smart-router-detail-row">
              <span className="smart-router-detail-label">Model</span>
              <span className="smart-router-detail-value">{info.selectedModel}</span>
            </div>

            <div className="smart-router-detail-row">
              <span className="smart-router-detail-label">Provider</span>
              <span className="smart-router-detail-value">
                {PROVIDER_NAMES[info.provider] || info.provider}
              </span>
            </div>

            <div className="smart-router-detail-row">
              <span className="smart-router-detail-label">Reason</span>
              <span className="smart-router-detail-value reason">{info.reason}</span>
            </div>

            <div className="smart-router-detail-row">
              <span className="smart-router-detail-label">Complexity</span>
              <div className="smart-router-complexity-bar">
                <div
                  className="smart-router-complexity-fill"
                  style={{
                    width: `${info.complexity}%`,
                    backgroundColor:
                      info.complexity < 30 ? '#10b981' :
                      info.complexity < 60 ? '#3b82f6' : '#9333ea',
                  }}
                />
                <span className="smart-router-complexity-text">{info.complexity}/100</span>
              </div>
            </div>

            <div className="smart-router-detail-row">
              <span className="smart-router-detail-label">Confidence</span>
              <span className="smart-router-detail-value">
                {Math.round(info.confidence * 100)}%
              </span>
            </div>

            <div className="smart-router-detail-row muted">
              <span className="smart-router-detail-label">Analysis time</span>
              <span className="smart-router-detail-value">{info.analysisMs}ms</span>
            </div>
          </div>

          <div className="smart-router-details-footer">
            <p>{tierInfo.description}</p>
          </div>
        </div>
      )}
    </div>
  );
}
