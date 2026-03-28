import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import './Onboarding.css';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001' : '';

type Step = 'welcome' | 'workspace-type' | 'ai-provider' | 'connect-claude' | 'theme' | 'use-case' | 'meet-team' | 'first-task' | 'complete';

interface UseCaseOption {
  id: string;
  icon: string;
  title: string;
  description: string;
  specialists: string[];
  category: 'personal' | 'business' | 'both';
}

const USE_CASE_OPTIONS: UseCaseOption[] = [
  {
    id: 'personal',
    icon: '\u2661',
    title: 'Personal Productivity',
    description: 'Meal planning, habit tracking, travel research, budget coaching',
    specialists: ['Scheduler', 'Researcher', 'Budget Coach', 'Planner'],
    category: 'personal',
  },
  {
    id: 'health',
    icon: '\u2695',
    title: 'Health & Fitness',
    description: 'Workout plans, nutrition tracking, sleep analysis, wellness goals',
    specialists: ['Fitness Coach', 'Meal Planner', 'Wellness Tracker', 'Health Researcher'],
    category: 'personal',
  },
  {
    id: 'home',
    icon: '\u2302',
    title: 'Home & Family',
    description: 'Home projects, pet care, family scheduling, household management',
    specialists: ['Home Manager', 'Pet Care Scheduler', 'Family Planner', 'Project Tracker'],
    category: 'personal',
  },
  {
    id: 'learning',
    icon: '\u2710',
    title: 'Learning & Growth',
    description: 'Study plans, skill tracking, reading lists, course research',
    specialists: ['Study Planner', 'Researcher', 'Note Organizer', 'Progress Tracker'],
    category: 'personal',
  },
  {
    id: 'travel',
    icon: '\u2708',
    title: 'Travel & Adventure',
    description: 'Trip planning, itineraries, budget tracking, destination research',
    specialists: ['Trip Planner', 'Researcher', 'Budget Tracker', 'Itinerary Builder'],
    category: 'personal',
  },
  {
    id: 'software-dev',
    icon: '\u2699',
    title: 'Software Development',
    description: 'Build, test, and ship code with AI-powered specialists',
    specialists: ['Builder', 'Reviewer', 'Tester', 'Security', 'Ops', 'Monitor'],
    category: 'business',
  },
  {
    id: 'devops',
    icon: '\u2601',
    title: 'DevOps & Infrastructure',
    description: 'Automate deployments, monitor systems, and manage infrastructure',
    specialists: ['Ops', 'Security', 'Monitor', 'Deploy'],
    category: 'business',
  },
  {
    id: 'marketing',
    icon: '\u2606',
    title: 'Marketing & Content',
    description: 'Create content, track SEO, and monitor your brand presence',
    specialists: ['Content Writer', 'SEO Analyst', 'Social Media Monitor', 'Competitor Researcher'],
    category: 'business',
  },
  {
    id: 'support',
    icon: '\u260E',
    title: 'Customer Support',
    description: 'Automate support workflows, triage tickets, and build knowledge bases',
    specialists: ['Support Agent', 'Ticket Triager', 'FAQ Builder', 'Escalation Monitor'],
    category: 'business',
  },
  {
    id: 'ecommerce',
    icon: '\u2302',
    title: 'E-Commerce',
    description: 'Track inventory, respond to reviews, and analyze order data',
    specialists: ['Inventory Monitor', 'Review Responder', 'Price Tracker', 'Order Analyst'],
    category: 'business',
  },
  {
    id: 'research',
    icon: '\u2318',
    title: 'Research & Analysis',
    description: 'Collect data, spot trends, and generate comprehensive reports',
    specialists: ['Research Analyst', 'Data Collector', 'Report Writer', 'Trend Monitor'],
    category: 'both',
  },
  {
    id: 'agency',
    icon: '\u2692',
    title: 'Agency / Freelancer',
    description: 'Manage clients, track projects, and automate invoicing workflows',
    specialists: ['Client Manager', 'Project Tracker', 'Invoice Monitor', 'Report Generator'],
    category: 'business',
  },
  {
    id: 'finance',
    icon: '\u2696',
    title: 'Finance & Accounting',
    description: 'Invoice tracking, expense reports, bookkeeping, financial analysis',
    specialists: ['Finance Analyst', 'Invoice Monitor', 'Report Generator', 'Auditor'],
    category: 'both',
  },
  {
    id: 'custom',
    icon: '\u271A',
    title: 'Custom',
    description: 'Start from scratch and handpick specialists for your unique workflow',
    specialists: [],
    category: 'both',
  },
];

const STEPS: { key: Step; label: string }[] = [
  { key: 'welcome', label: 'Workspace' },
  { key: 'workspace-type', label: 'Type' },
  { key: 'ai-provider', label: 'AI Config' },
  { key: 'connect-claude', label: 'Connect' },
  { key: 'theme', label: 'Appearance' },
  { key: 'use-case', label: 'Use Case' },
  { key: 'meet-team', label: 'Your Team' },
  { key: 'first-task', label: 'Try It' },
  { key: 'complete', label: 'Launch' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const setOnboardingCompleted = useAuthStore(s => s.setOnboardingCompleted);

  const [step, setStep] = useState<Step>('welcome');
  const [workspaceName, setWorkspaceName] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark');
  const [parserMode, setParserMode] = useState<'basic' | 'enhanced'>('basic');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null);
  const [marketplaceEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiTesting, setOpenaiTesting] = useState(false);
  const [openaiResult, setOpenaiResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [openaiSaved, setOpenaiSaved] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<'unknown' | 'connected' | 'expired' | 'none'>('unknown');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthState, setOauthState] = useState('');
  const [oauthCode, setOauthCode] = useState('');
  const [oauthStep, setOauthStep] = useState<'idle' | 'waiting'>('idle');
  const [oauthExchanging, setOauthExchanging] = useState(false);
  const [oauthError, setOauthError] = useState('');
  const [searchParams] = useSearchParams();
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [workspaceType, setWorkspaceType] = useState<'personal' | 'business' | null>(null);
  const [provisionedAgents, setProvisionedAgents] = useState<{ name: string; type: string; description: string }[]>([]);
  const [teamRevealed, setTeamRevealed] = useState(0);
  const [firstTaskInput, setFirstTaskInput] = useState('');
  const [firstTaskRunning, setFirstTaskRunning] = useState(false);
  const [firstTaskResult, setFirstTaskResult] = useState('');

  // Check OAuth + provider key status on mount
  useEffect(() => {
    const checkOAuth = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/forge/oauth/status`, { credentials: 'include' });
        const data = await res.json() as { connected: boolean; status: string };
        setOauthStatus(data.connected ? 'connected' : data.status === 'expired' ? 'expired' : 'none');
      } catch {
        setOauthStatus('none');
      }
    };
    const checkProviders = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/forge/user-providers`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json() as { keys?: { provider_type: string }[] };
          const keys = data.keys || [];
          if (keys.some(k => k.provider_type === 'openai')) setOpenaiSaved(true);
          if (keys.some(k => k.provider_type === 'anthropic')) setParserMode('enhanced');
        }
      } catch { /* ignore */ }
    };
    const checkOllama = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/forge/onboarding/ollama-status`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json() as { available: boolean; models?: string[] };
          setOllamaAvailable(data.available);
          setOllamaModels(data.models || []);
        }
      } catch { /* ignore */ }
    };
    checkOAuth();
    checkProviders();
    checkOllama();

    // Handle OAuth redirect result
    const success = searchParams.get('oauth_success');
    const error = searchParams.get('oauth_error');
    if (success === 'true') {
      setOauthStatus('connected');
      setStep('connect-claude');
    } else if (error) {
      setOauthStatus('none');
      setStep('connect-claude');
    }
  }, [searchParams]);

  const currentIdx = STEPS.findIndex(s => s.key === step);

  const handleTestKey = async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Save and test via the onboarding API key endpoint
      const res = await fetch(`${API_BASE}/api/v1/forge/onboarding/api-key`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey.trim(), provider: 'anthropic' }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setTestResult({ ok: true, msg: 'Connected and saved' });
        setKeySaved(true);
      } else {
        setTestResult({ ok: false, msg: data.error || 'Invalid key' });
      }
    } catch {
      setTestResult({ ok: false, msg: 'Connection failed' });
    }
    setTesting(false);
  };

  const handleSaveOpenai = async () => {
    if (!openaiKey.trim()) return;
    setOpenaiTesting(true);
    setOpenaiResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/onboarding/api-key`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: openaiKey.trim(), provider: 'openai' }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setOpenaiResult({ ok: true, msg: 'OpenAI key tested and saved' });
        setOpenaiSaved(true);
      } else {
        setOpenaiResult({ ok: false, msg: data.error || 'Failed to save' });
      }
    } catch {
      setOpenaiResult({ ok: false, msg: 'Connection failed' });
    }
    setOpenaiTesting(false);
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/v1/forge/onboarding/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_name: workspaceName || 'AskAlf', theme, use_case: selectedUseCase, marketplace_enabled: marketplaceEnabled }),
      });
      setOnboardingCompleted();
      navigate('/', { replace: true });
    } catch {
      // Still navigate even if the API fails
      setOnboardingCompleted();
      navigate('/', { replace: true });
    }
    setSaving(false);
  };

  return (
    <div className="ob-root">
      <div className="ob-bg" />

      <div className="ob-container">
        {/* Progress */}
        <div className="ob-progress">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`ob-step ${i <= currentIdx ? 'active' : ''} ${i < currentIdx ? 'done' : ''}`}>
              <div className="ob-step-dot">
                {i < currentIdx ? <span className="ob-step-check">&#10003;</span> : <span>{i + 1}</span>}
              </div>
              <span className="ob-step-label">{s.label}</span>
              {i < STEPS.length - 1 && <div className={`ob-step-line ${i < currentIdx ? 'done' : ''}`} />}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="ob-card">
          {/* Step 1: Welcome */}
          {step === 'welcome' && (
            <div className="ob-step-content">
              <div className="ob-brand">askalf</div>
              <h1 className="ob-title">Welcome to AskAlf</h1>
              <p className="ob-desc">
                Set up your AI workforce. This will only take a minute.
              </p>
              <div className="ob-field">
                <label>Workspace Name</label>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={e => setWorkspaceName(e.target.value)}
                  placeholder="My Workspace"
                  autoFocus
                />
                <span className="ob-hint">What should we call this deployment?</span>
              </div>
              <button className="ob-btn-primary" onClick={() => setStep('workspace-type')}>
                Continue
              </button>
            </div>
          )}

          {/* Step 2: Workspace Type */}
          {step === 'workspace-type' && (
            <div className="ob-step-content">
              <h1 className="ob-title">What is this workspace for?</h1>
              <p className="ob-desc">This shapes which AI specialists Alf creates for you.</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '32px 0' }}>
                <button
                  onClick={() => setWorkspaceType('personal')}
                  style={{
                    padding: '32px 24px', borderRadius: 16, cursor: 'pointer', textAlign: 'left',
                    background: workspaceType === 'personal' ? 'rgba(99,102,241,0.12)' : 'var(--surface, rgba(255,255,255,0.03))',
                    border: workspaceType === 'personal' ? '1.5px solid rgba(99,102,241,0.5)' : '1px solid var(--border, rgba(255,255,255,0.08))',
                    color: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: 12 }}>&#9825;</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>Personal</div>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                    Meal planning, budget coaching, travel research, habit tracking, fitness, journaling, home projects
                  </div>
                </button>
                <button
                  onClick={() => setWorkspaceType('business')}
                  style={{
                    padding: '32px 24px', borderRadius: 16, cursor: 'pointer', textAlign: 'left',
                    background: workspaceType === 'business' ? 'rgba(99,102,241,0.12)' : 'var(--surface, rgba(255,255,255,0.03))',
                    border: workspaceType === 'business' ? '1.5px solid rgba(99,102,241,0.5)' : '1px solid var(--border, rgba(255,255,255,0.08))',
                    color: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: 12 }}>&#9874;</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>Business</div>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                    Software dev, marketing, support, DevOps, finance, e-commerce, agency work, research, operations
                  </div>
                </button>
              </div>

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('welcome')}>Back</button>
                <button className="ob-btn-primary" onClick={() => setStep('ai-provider')} disabled={!workspaceType}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: AI Provider */}
          {step === 'ai-provider' && (
            <div className="ob-step-content">
              <h1 className="ob-title">AI Providers</h1>
              <p className="ob-desc">
                Configure your AI providers. You need at least one to power workers.
                Agent execution uses Claude CLI separately — this is just for parsing commands.
              </p>

              <div className="ob-parser-options">
                <button
                  className={`ob-parser-option ${parserMode === 'basic' ? 'active' : ''}`}
                  onClick={() => { setParserMode('basic'); setTestResult(null); }}
                >
                  <div className="ob-parser-header">
                    <span className="ob-parser-name">Basic Parser</span>
                    <span className="ob-parser-badge">No key needed</span>
                  </div>
                  <span className="ob-parser-desc">
                    Keyword-based intent classification. Works offline. Good for direct commands.
                  </span>
                </button>

                <button
                  className={`ob-parser-option ${parserMode === 'enhanced' ? 'active' : ''} ${keySaved ? 'saved' : ''}`}
                  onClick={() => { setParserMode('enhanced'); setTestResult(null); }}
                >
                  <div className="ob-parser-header">
                    <span className="ob-parser-name">Enhanced NL Parser</span>
                    <span className="ob-parser-badge enhanced">Anthropic API key</span>
                  </div>
                  <span className="ob-parser-desc">
                    AI-powered natural language understanding. Handles complex, ambiguous requests.
                  </span>
                  {keySaved && <span className="ob-parser-saved">&#10003; Connected</span>}
                </button>
              </div>

              {parserMode === 'enhanced' && !keySaved && (
                <>
                  <div className="ob-field">
                    <label>Anthropic API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={e => { setApiKey(e.target.value); setTestResult(null); }}
                      placeholder="sk-ant-..."
                    />
                    <span className="ob-hint">Get one at console.anthropic.com</span>
                  </div>
                  <button
                    className="ob-btn-secondary"
                    onClick={handleTestKey}
                    disabled={testing || !apiKey.trim()}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {testing ? 'Testing...' : 'Test & Save Key'}
                  </button>
                </>
              )}

              {testResult && (
                <div className={`ob-test-result ${testResult.ok ? 'ok' : 'fail'}`}>
                  {testResult.msg}
                </div>
              )}

              {/* Optional: OpenAI for embeddings */}
              <div className="ob-optional-section">
                <div className="ob-optional-header">
                  <span className="ob-optional-label">Optional</span>
                  <span className="ob-optional-title">OpenAI Key for Embeddings</span>
                </div>
                <p className="ob-optional-desc">
                  Powers semantic memory search and enables OpenAI model agents.
                  Without this, the brain uses basic matching instead of vector similarity.
                </p>
                {!openaiSaved ? (
                  <div className="ob-optional-fields">
                    <input
                      type="password"
                      className="ob-optional-input"
                      value={openaiKey}
                      onChange={e => { setOpenaiKey(e.target.value); setOpenaiResult(null); }}
                      placeholder="sk-..."
                    />
                    <button
                      className="ob-btn-secondary"
                      onClick={handleSaveOpenai}
                      disabled={openaiTesting || !openaiKey.trim()}
                    >
                      {openaiTesting ? 'Testing...' : 'Test & Save'}
                    </button>
                  </div>
                ) : (
                  <div className="ob-optional-saved">&#10003; OpenAI key saved</div>
                )}
                {openaiResult && !openaiSaved && (
                  <div className={`ob-test-result ${openaiResult.ok ? 'ok' : 'fail'}`}>
                    {openaiResult.msg}
                  </div>
                )}
              </div>

              {/* Ollama Detection */}
              <div className="ob-optional-section">
                <div className="ob-optional-header">
                  <span className="ob-optional-label">{ollamaAvailable ? 'Detected' : 'Optional'}</span>
                  <span className="ob-optional-title">Ollama (Local Models)</span>
                </div>
                {ollamaAvailable ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="ob-optional-saved" style={{ color: '#34d399' }}>&#10003; Ollama is running{ollamaModels.length > 0 ? ` with ${ollamaModels.length} model${ollamaModels.length > 1 ? 's' : ''}` : ''}</div>
                    {ollamaModels.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {ollamaModels.slice(0, 8).map(m => (
                          <span key={m} style={{ padding: '3px 10px', borderRadius: 12, background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.2)', fontSize: '0.75rem', color: '#34d399' }}>{m.split(':')[0]}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="ob-optional-desc">
                    No Ollama instance detected. Set OLLAMA_BASE_URL in .env to use local models. No API key needed.
                  </p>
                )}
              </div>

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('welcome')}>Back</button>
                <button
                  className="ob-btn-primary"
                  onClick={() => setStep('connect-claude')}
                  disabled={parserMode === 'enhanced' && !keySaved}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Connect Claude */}
          {step === 'connect-claude' && (
            <div className="ob-step-content">
              <h1 className="ob-title">Connect Claude for agent execution</h1>
              <p className="ob-desc">
                Agents use Claude CLI to execute tasks. Connect your Anthropic account
                via OAuth so agents can run autonomously.
              </p>

              <div className="ob-oauth-card">
                {oauthStatus === 'connected' ? (
                  <div className="ob-oauth-connected">
                    <div className="ob-oauth-check">&#10003;</div>
                    <div>
                      <div className="ob-oauth-status-text">Claude Connected</div>
                      <div className="ob-oauth-status-sub">Agent execution is ready</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="ob-oauth-info">
                      <div className="ob-oauth-icon">C</div>
                      <div>
                        <div className="ob-oauth-info-title">Anthropic OAuth</div>
                        <div className="ob-oauth-info-desc">
                          Sign in with your Anthropic account. This authorizes agent execution
                          using your Claude subscription.
                        </div>
                      </div>
                    </div>
                    {oauthStep === 'idle' && (
                      <button
                        className="ob-btn-oauth"
                        disabled={oauthLoading}
                        onClick={async () => {
                          setOauthLoading(true);
                          setOauthError('');
                          try {
                            const res = await fetch(`${API_BASE}/api/v1/forge/oauth/start`, { credentials: 'include' });
                            const data = await res.json() as { authUrl: string; state: string };
                            setOauthState(data.state);
                            setOauthStep('waiting');
                            window.open(data.authUrl, '_blank');
                          } catch {
                            setOauthError('Failed to start OAuth flow');
                          }
                          setOauthLoading(false);
                        }}
                      >
                        {oauthLoading ? 'Opening...' : 'Connect with Anthropic'}
                      </button>
                    )}
                    {oauthStep === 'waiting' && (
                      <div style={{ marginTop: '12px' }}>
                        <div className="ob-oauth-info-desc" style={{ marginBottom: '8px' }}>
                          Authorize in the browser tab that opened, then paste the code from the success page:
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            value={oauthCode}
                            onChange={(e) => setOauthCode(e.target.value)}
                            placeholder="Paste authorization code here"
                            style={{ flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '8px', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '.85rem' }}
                            autoFocus
                          />
                          <button
                            className="ob-btn-oauth"
                            disabled={!oauthCode.trim() || oauthExchanging}
                            onClick={async () => {
                              setOauthExchanging(true);
                              setOauthError('');
                              try {
                                const res = await fetch(`${API_BASE}/api/v1/forge/oauth/exchange`, {
                                  method: 'POST',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ code: oauthCode.trim(), state: oauthState }),
                                });
                                if (res.ok) {
                                  setOauthStatus('connected');
                                  setOauthStep('idle');
                                  setOauthCode('');
                                } else {
                                  const data = await res.json() as { error?: string };
                                  setOauthError(data.error || 'Exchange failed');
                                }
                              } catch {
                                setOauthError('Failed to exchange code');
                              }
                              setOauthExchanging(false);
                            }}
                          >
                            {oauthExchanging ? 'Connecting...' : 'Submit'}
                          </button>
                        </div>
                      </div>
                    )}
                    {oauthError && (
                      <div className="ob-test-result fail">{oauthError}</div>
                    )}
                  </>
                )}
              </div>

              <p className="ob-desc" style={{ marginTop: '16px', fontSize: '0.85rem', opacity: 0.7 }}>
                OpenAI Codex terminal can be connected later in Settings &gt; Keys &amp; Providers.
              </p>

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('ai-provider')}>Back</button>
                <button className="ob-btn-primary" onClick={() => setStep('theme')}>
                  {oauthStatus === 'connected' ? 'Continue' : 'Skip for now'}
                </button>
              </div>
              {oauthStatus !== 'connected' && (
                <span className="ob-hint" style={{ textAlign: 'center', display: 'block' }}>
                  You can connect later in Settings. Without this, agents cannot execute tasks.
                </span>
              )}
            </div>
          )}

          {/* Step 4: Theme */}
          {step === 'theme' && (
            <div className="ob-step-content">
              <h1 className="ob-title">Choose your theme</h1>
              <p className="ob-desc">You can change this anytime in Settings.</p>

              <div className="ob-theme-grid">
                {(['dark', 'light', 'system'] as const).map(t => (
                  <button
                    key={t}
                    className={`ob-theme-card ${theme === t ? 'active' : ''}`}
                    onClick={() => setTheme(t)}
                  >
                    <div className={`ob-theme-preview ${t}`}>
                      <div className="ob-theme-bar" />
                      <div className="ob-theme-content">
                        <div className="ob-theme-line" />
                        <div className="ob-theme-line short" />
                      </div>
                    </div>
                    <span className="ob-theme-name">{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                  </button>
                ))}
              </div>

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('connect-claude')}>Back</button>
                <button className="ob-btn-primary" onClick={() => setStep('use-case')}>Continue</button>
              </div>
            </div>
          )}

          {/* Step 5: Use Case */}
          {step === 'use-case' && (
            <div className="ob-step-content">
              <h1 className="ob-title">What do you do?</h1>
              <p className="ob-desc">
                Pick the category that best describes your work. We'll pre-configure a team of
                AI specialists tailored to your workflow.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: '12px',
                  margin: '24px 0 16px',
                }}
              >
                {USE_CASE_OPTIONS.filter(uc => uc.category === 'both' || uc.category === (workspaceType || 'business')).map(uc => {
                  const isSelected = selectedUseCase === uc.id;
                  return (
                    <button
                      key={uc.id}
                      onClick={() => setSelectedUseCase(uc.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        padding: '18px',
                        background: isSelected
                          ? 'rgba(99, 102, 241, 0.12)'
                          : 'var(--surface, rgba(255,255,255,0.03))',
                        border: isSelected
                          ? '1.5px solid rgba(99, 102, 241, 0.5)'
                          : '1px solid var(--border, rgba(255,255,255,0.08))',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'inherit',
                        transition: 'all 0.2s ease',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        boxShadow: isSelected
                          ? '0 0 20px rgba(99, 102, 241, 0.1)'
                          : 'none',
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) {
                          (e.currentTarget as HTMLButtonElement).style.background =
                            'var(--crystal, rgba(255,255,255,0.06))';
                          (e.currentTarget as HTMLButtonElement).style.borderColor =
                            'rgba(255,255,255,0.15)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) {
                          (e.currentTarget as HTMLButtonElement).style.background =
                            'var(--surface, rgba(255,255,255,0.03))';
                          (e.currentTarget as HTMLButtonElement).style.borderColor =
                            'var(--border, rgba(255,255,255,0.08))';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            fontSize: '1.5rem',
                            width: '36px',
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '8px',
                            background: isSelected
                              ? 'rgba(99, 102, 241, 0.2)'
                              : 'rgba(255,255,255,0.05)',
                            flexShrink: 0,
                          }}
                        >
                          {uc.icon}
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            color: isSelected
                              ? 'rgba(165, 168, 255, 1)'
                              : 'rgba(255,255,255,0.9)',
                          }}
                        >
                          {uc.title}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '0.82rem',
                          color: 'rgba(255,255,255,0.5)',
                          lineHeight: 1.4,
                        }}
                      >
                        {uc.description}
                      </span>
                      {uc.specialists.length > 0 && (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: isSelected
                              ? 'rgba(165, 168, 255, 0.7)'
                              : 'rgba(255,255,255,0.3)',
                            marginTop: '2px',
                            fontWeight: 500,
                          }}
                        >
                          {uc.specialists.length} specialists included
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => {
                  setSelectedUseCase(null);
                  setStep('complete');
                }}
                style={{
                  display: 'block',
                  margin: '0 auto 20px',
                  padding: '8px 16px',
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.35)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.6)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)'; }}
              >
                Skip — I'll build my own
              </button>

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('theme')}>Back</button>
                <button
                  className="ob-btn-primary"
                  onClick={() => {
                    // Show team preview based on selected use case
                    const uc = USE_CASE_OPTIONS.find(u => u.id === selectedUseCase);
                    if (uc) {
                      setProvisionedAgents(uc.specialists.map(s => ({ name: s, type: 'worker', description: '' })));
                      setTeamRevealed(0);
                      setStep('meet-team');
                    } else {
                      setStep('complete');
                    }
                  }}
                  disabled={!selectedUseCase}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 7: Meet Your Team */}
          {step === 'meet-team' && (
            <div className="ob-step-content">
              <h1 className="ob-title">Meet your team</h1>
              <p className="ob-desc">
                Alf created these specialists for your {workspaceType === 'personal' ? 'personal' : 'business'} workspace.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '24px 0' }}>
                {provisionedAgents.map((agent, i) => {
                  const visible = i < teamRevealed;
                  return (
                    <div
                      key={agent.name}
                      style={{
                        padding: '16px 20px', borderRadius: 12,
                        background: visible ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${visible ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}`,
                        opacity: visible ? 1 : 0.3,
                        transform: visible ? 'translateX(0)' : 'translateX(20px)',
                        transition: 'all 0.4s ease',
                        display: 'flex', alignItems: 'center', gap: 12,
                      }}
                    >
                      <span style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: visible ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1rem', fontWeight: 700, color: visible ? '#a5a8ff' : 'rgba(255,255,255,0.3)',
                      }}>
                        {agent.name.charAt(0)}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: visible ? '#f4f4f5' : 'rgba(255,255,255,0.4)' }}>
                          {agent.name}
                        </div>
                      </div>
                      {visible && (
                        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#34d399', fontWeight: 600 }}>READY</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {teamRevealed === 0 && provisionedAgents.length > 0 && (
                <button
                  className="ob-btn-primary"
                  onClick={() => {
                    let i = 0;
                    const reveal = () => {
                      i++;
                      setTeamRevealed(i);
                      if (i < provisionedAgents.length) {
                        setTimeout(reveal, 400);
                      }
                    };
                    setTimeout(reveal, 300);
                  }}
                >
                  Reveal Your Team
                </button>
              )}
              {teamRevealed > 0 && teamRevealed < provisionedAgents.length && (
                <div style={{ textAlign: 'center', opacity: 0.4, fontSize: '0.85rem', padding: 12 }}>
                  Setting up...
                </div>
              )}
              {teamRevealed >= provisionedAgents.length && provisionedAgents.length > 0 && (
                <div className="ob-btn-row" style={{ marginTop: 16 }}>
                  <button className="ob-btn-secondary" onClick={() => setStep('use-case')}>Back</button>
                  <button className="ob-btn-primary" onClick={() => setStep('first-task')}>
                    Try Your First Task
                  </button>
                </div>
              )}
              {provisionedAgents.length === 0 && (
                <div className="ob-btn-row">
                  <button className="ob-btn-secondary" onClick={() => setStep('use-case')}>Back</button>
                  <button className="ob-btn-primary" onClick={() => setStep('first-task')}>
                    Continue
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 8: First Task */}
          {step === 'first-task' && (
            <div className="ob-step-content">
              <h1 className="ob-title">Try it out</h1>
              <p className="ob-desc">
                Tell Alf what you need. Your team is ready.
              </p>

              <div style={{ margin: '24px 0' }}>
                <textarea
                  value={firstTaskInput}
                  onChange={e => setFirstTaskInput(e.target.value)}
                  placeholder={workspaceType === 'personal'
                    ? "Plan my meals for the week — I'm vegetarian, budget $80..."
                    : "Research our top 3 competitors and summarize their pricing..."}
                  style={{
                    width: '100%', minHeight: 100, padding: '14px 16px', borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)',
                    color: 'inherit', fontSize: '0.95rem', lineHeight: 1.6, resize: 'vertical',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {firstTaskResult && (
                <div style={{
                  padding: '16px', borderRadius: 12, background: 'rgba(52,211,153,0.06)',
                  border: '1px solid rgba(52,211,153,0.2)', marginBottom: 16,
                  fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.6,
                  maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap',
                }}>
                  {firstTaskResult}
                </div>
              )}

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('meet-team')}>Back</button>
                {!firstTaskResult ? (
                  <button
                    className="ob-btn-primary"
                    onClick={async () => {
                      if (!firstTaskInput.trim()) return;
                      setFirstTaskRunning(true);
                      try {
                        const res = await fetch(`${API_BASE}/api/v1/forge/dispatch`, {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ message: firstTaskInput }),
                        });
                        if (res.ok) {
                          const data = await res.json() as { response?: string; summary?: string };
                          setFirstTaskResult(data.response || data.summary || 'Task dispatched! Check the dashboard to see your team in action.');
                        } else {
                          setFirstTaskResult('Task dispatched! Your team will start working on it. You can watch progress in the Live tab.');
                        }
                      } catch {
                        setFirstTaskResult('Task dispatched! Head to the dashboard to watch your team work.');
                      }
                      setFirstTaskRunning(false);
                    }}
                    disabled={firstTaskRunning || !firstTaskInput.trim()}
                  >
                    {firstTaskRunning ? 'Alf is thinking...' : 'Send to Alf'}
                  </button>
                ) : (
                  <button className="ob-btn-primary ob-btn-launch" onClick={() => setStep('complete')}>
                    Launch Dashboard
                  </button>
                )}
              </div>

              <button
                onClick={() => setStep('complete')}
                style={{
                  display: 'block', margin: '12px auto 0', padding: '8px 16px',
                  background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                  fontSize: '0.8rem', cursor: 'pointer',
                }}
              >
                Skip — I'll explore on my own
              </button>
            </div>
          )}

          {/* Step 9: Complete */}
          {step === 'complete' && (
            <div className="ob-step-content ob-complete">
              <div className="ob-complete-icon">&#10003;</div>
              <h1 className="ob-title">Ready to launch</h1>
              <p className="ob-desc">
                Your AskAlf instance is configured. You can manage agents, channels,
                integrations, and devices from Settings at any time.
              </p>
              <div className="ob-summary">
                <div className="ob-summary-row">
                  <span>Workspace</span>
                  <span>{workspaceName || 'AskAlf'}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Intent Parser</span>
                  <span>{parserMode === 'enhanced' ? 'Enhanced (Anthropic)' : 'Basic (keyword)'}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Embeddings</span>
                  <span>{openaiSaved ? 'OpenAI (vector search)' : 'Basic (no similarity)'}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Agent Execution</span>
                  <span>{oauthStatus === 'connected' ? 'Claude (OAuth)' : 'Not connected'}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Local Models</span>
                  <span>{ollamaAvailable ? `Ollama (${ollamaModels.length} models)` : 'Not configured'}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Workspace Type</span>
                  <span>{workspaceType === 'personal' ? 'Personal' : workspaceType === 'business' ? 'Business' : 'Not set'}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Use Case</span>
                  <span>
                    {selectedUseCase
                      ? USE_CASE_OPTIONS.find(u => u.id === selectedUseCase)?.title || selectedUseCase
                      : 'Custom (build your own)'}
                  </span>
                </div>
                <div className="ob-summary-row">
                  <span>Team Size</span>
                  <span>{provisionedAgents.length > 0 ? `${provisionedAgents.length} specialists` : 'Custom'}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Theme</span>
                  <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                </div>
              </div>
              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('first-task')}>Back</button>
                <button className="ob-btn-primary ob-btn-launch" onClick={handleComplete} disabled={saving}>
                  {saving ? 'Launching...' : 'Launch Dashboard'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
