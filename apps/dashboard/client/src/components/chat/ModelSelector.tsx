import { useState, useRef, useEffect } from 'react';
import { useChatStore, type Model } from '../../stores/chat';
import './ModelSelector.css';

// Model with pricing info
interface ModelWithPricing extends Model {
  credits: number;
}

// Full model list - Updated January 2026
const MODELS: ModelWithPricing[] = [
  // ===== FAST TIER (1 credit) =====
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', tier: 'fast', credits: 1 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', tier: 'fast', credits: 1 },
  { id: 'o4-mini', name: 'o4 Mini', provider: 'openai', tier: 'fast', credits: 1 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'fast', credits: 1 },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: 'google', tier: 'fast', credits: 1 },
  { id: 'grok-3-mini', name: 'Grok 3 Mini', provider: 'xai', tier: 'fast', credits: 1 },
  { id: 'deepseek-v3', name: 'DeepSeek V3.2', provider: 'deepseek', tier: 'fast', credits: 1 },

  // ===== STANDARD TIER (2 credits) =====
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai', tier: 'standard', credits: 2 },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', tier: 'standard', credits: 2 },
  { id: 'gpt-4.1', name: 'GPT-4.1 (Code)', provider: 'openai', tier: 'standard', credits: 2 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic', tier: 'standard', credits: 2 },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', tier: 'standard', credits: 2 },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'google', tier: 'standard', credits: 2 },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', tier: 'standard', credits: 2 },
  { id: 'grok-4', name: 'Grok 4', provider: 'xai', tier: 'standard', credits: 2 },
  { id: 'grok-3', name: 'Grok 3', provider: 'xai', tier: 'standard', credits: 2 },
  { id: 'grok-code', name: 'Grok Code', provider: 'xai', tier: 'standard', credits: 2 },

  // ===== REASONING TIER (10 credits) =====
  { id: 'o3', name: 'o3', provider: 'openai', tier: 'reasoning', credits: 10 },
  { id: 'o3-pro', name: 'o3 Pro', provider: 'openai', tier: 'reasoning', credits: 10 },
  { id: 'o1', name: 'o1', provider: 'openai', tier: 'reasoning', credits: 10 },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic', tier: 'reasoning', credits: 10 },
  { id: 'gemini-3-deep-think', name: 'Gemini 3 Deep Think', provider: 'google', tier: 'reasoning', credits: 10 },
  { id: 'grok-4.1-fast', name: 'Grok 4.1 Fast', provider: 'xai', tier: 'reasoning', credits: 10 },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', tier: 'reasoning', credits: 10 },

  // ===== VISION TIER (5 credits) =====
  { id: 'grok-2-vision', name: 'Grok 2 Vision', provider: 'xai', tier: 'vision', credits: 5 },

  // ===== LOCAL TIER (0 credits) =====
  { id: 'llama3.3', name: 'Llama 3.3 70B', provider: 'ollama', tier: 'local', credits: 0 },
  { id: 'llama3.2', name: 'Llama 3.2 3B', provider: 'ollama', tier: 'local', credits: 0 },
  { id: 'mistral', name: 'Mistral 7B', provider: 'ollama', tier: 'local', credits: 0 },
  { id: 'mixtral', name: 'Mixtral 8x7B', provider: 'ollama', tier: 'local', credits: 0 },
  { id: 'phi4', name: 'Phi-4 14B', provider: 'ollama', tier: 'local', credits: 0 },
  { id: 'qwen2.5', name: 'Qwen 2.5 7B', provider: 'ollama', tier: 'local', credits: 0 },
  { id: 'deepseek-r1-local', name: 'DeepSeek R1 (Local)', provider: 'ollama', tier: 'local', credits: 0 },
  { id: 'codellama', name: 'CodeLlama', provider: 'ollama', tier: 'local', credits: 0 },
];

// Smart Router constant
const SMART_ROUTER_ID = 'smart-router';

const TIER_LABELS: Record<string, string> = {
  fast: 'Nano (1 credit)',
  standard: 'Pro (2 credits)',
  reasoning: 'Reasoning (10 credits)',
  vision: 'Vision (5 credits)',
  local: 'Local (Free)',
};

const PROVIDER_ICONS: Record<string, string> = {
  openai: 'O',
  anthropic: 'A',
  google: 'G',
  xai: 'X',
  deepseek: 'D',
  ollama: 'L',
  lmstudio: 'S',
};

// Cloud providers that are currently available (have API keys configured)
const AVAILABLE_PROVIDERS = new Set(['openai', 'anthropic']);

// Providers coming soon
const COMING_SOON_PROVIDERS = new Set(['google', 'xai', 'deepseek']);

// Models that require organization verification on OpenAI (now verified)
const REQUIRES_VERIFICATION = new Set<string>();

const TIER_ORDER = ['fast', 'standard', 'reasoning', 'vision', 'local'];

// Smart Router Icon Component
function SmartRouterIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

export default function ModelSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(new Set(TIER_ORDER));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { selectedModel, setSelectedModel } = useChatStore();

  const isSmartRouter = selectedModel === SMART_ROUTER_ID;
  const accessibleModels = MODELS.filter(m => AVAILABLE_PROVIDERS.has(m.provider));
  const currentModel = !isSmartRouter
    ? accessibleModels.find(m => m.id === selectedModel) || null
    : null;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const modelsByTier = MODELS.reduce((acc, model) => {
    if (!acc[model.tier]) acc[model.tier] = [];
    acc[model.tier].push(model);
    return acc;
  }, {} as Record<string, ModelWithPricing[]>);

  const toggleTier = (tier: string) => {
    setExpandedTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  const isProviderAvailable = (provider: string) => AVAILABLE_PROVIDERS.has(provider);
  const isComingSoon = (provider: string) => COMING_SOON_PROVIDERS.has(provider);
  const requiresVerification = (modelId: string) => REQUIRES_VERIFICATION.has(modelId);

  const handleSelectSmartRouter = () => {
    setSelectedModel(SMART_ROUTER_ID);
    setIsOpen(false);
  };

  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    setIsOpen(false);
  };

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        className={`model-selector-trigger ${isSmartRouter ? 'smart-router-active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={isSmartRouter
          ? 'Smart Router - Automatically selects the best model for your query'
          : `${currentModel?.name} (${currentModel?.credits} credit${currentModel?.credits !== 1 ? 's' : ''}/msg)`
        }
      >
        {isSmartRouter ? (
          <>
            <SmartRouterIcon className="model-selector-smart-icon" />
            <span className="model-selector-name">Smart Router</span>
          </>
        ) : (
          <>
            <span className="model-selector-provider">{PROVIDER_ICONS[currentModel?.provider || 'anthropic']}</span>
            <span className="model-selector-name">{currentModel?.name}</span>
          </>
        )}
        <svg
          className={`model-selector-chevron ${isOpen ? 'open' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          {/* Smart Router - Featured Option */}
          <div className="model-selector-featured">
            <div
              className={`smart-router-option ${isSmartRouter ? 'selected' : ''}`}
              onClick={handleSelectSmartRouter}
            >
              <div className="smart-router-header">
                <SmartRouterIcon className="smart-router-icon" />
                <div className="smart-router-info">
                  <span className="smart-router-name">Smart Router</span>
                  <span className="smart-router-badge">Recommended</span>
                </div>
              </div>
              <p className="smart-router-description">
                Automatically selects the right model for each query.
                Save up to 90% on simple tasks.
              </p>
              <div className="smart-router-tiers">
                <span className="tier-badge nano">Nano</span>
                <span className="tier-badge pro">Pro</span>
                <span className="tier-badge reasoning">Reasoning</span>
                <span className="tier-badge local">Local</span>
              </div>
            </div>
          </div>

          <div className="model-selector-divider">
            <span>Or choose a specific model</span>
          </div>

          {/* Model Tiers */}
          {TIER_ORDER.filter(tier => modelsByTier[tier]).map(tier => {
            const models = modelsByTier[tier];
            const isExpanded = expandedTiers.has(tier);

            return (
              <div key={tier} className="model-selector-section">
                <button
                  className={`model-selector-section-header ${isExpanded ? 'expanded' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTier(tier);
                  }}
                >
                  <span className="model-selector-section-title">{TIER_LABELS[tier]}</span>
                  <span className="model-selector-section-count">{models.length}</span>
                  <svg
                    className={`model-selector-section-chevron ${isExpanded ? 'expanded' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="model-selector-section-models">
                    {models.map(model => {
                      const available = isProviderAvailable(model.provider);
                      const comingSoon = isComingSoon(model.provider);
                      const needsVerification = requiresVerification(model.id);
                      const isDisabled = !available || needsVerification;
                      return (
                        <div
                          key={model.id}
                          className={`model-option ${selectedModel === model.id ? 'selected' : ''} ${isDisabled ? 'disabled' : ''} ${comingSoon ? 'coming-soon' : ''} ${needsVerification ? 'verification-required' : ''}`}
                          onClick={() => {
                            if (!isDisabled) {
                              handleSelectModel(model.id);
                            }
                          }}
                          title={comingSoon ? 'Coming Soon' : needsVerification ? 'Requires OpenAI organization verification' : undefined}
                        >
                          <span className="model-option-provider">{PROVIDER_ICONS[model.provider]}</span>
                          <span className="model-option-name">{model.name}</span>
                          {comingSoon ? (
                            <span className="model-option-coming-soon">Coming Soon</span>
                          ) : needsVerification ? (
                            <span className="model-option-verification">Verify Org</span>
                          ) : (
                            <span className={`model-option-credits ${model.credits === 0 ? 'free' : ''}`}>
                              {model.credits === 0 ? 'Free' : `${model.credits}c`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
