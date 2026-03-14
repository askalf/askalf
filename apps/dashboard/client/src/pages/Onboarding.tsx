import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import './Onboarding.css';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001' : '';

type Step = 'welcome' | 'ai-provider' | 'theme' | 'complete';

const STEPS: { key: Step; label: string }[] = [
  { key: 'welcome', label: 'Workspace' },
  { key: 'ai-provider', label: 'AI Provider' },
  { key: 'theme', label: 'Appearance' },
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
  const [saving, setSaving] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

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

  const handleComplete = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/v1/forge/onboarding/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_name: workspaceName || 'AskAlf', theme }),
      });
      setOnboardingCompleted();
      navigate('/command-center', { replace: true });
    } catch {
      // Still navigate even if the API fails
      setOnboardingCompleted();
      navigate('/command-center', { replace: true });
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
              <h1 className="ob-title">Welcome to your command center</h1>
              <p className="ob-desc">
                Set up your self-hosted AskAlf instance. This will only take a minute.
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
              <button className="ob-btn-primary" onClick={() => setStep('ai-provider')}>
                Continue
              </button>
            </div>
          )}

          {/* Step 2: AI Provider */}
          {step === 'ai-provider' && (
            <div className="ob-step-content">
              <h1 className="ob-title">Intent Parser</h1>
              <p className="ob-desc">
                Choose how the command center interprets your natural language requests.
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

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('welcome')}>Back</button>
                <button
                  className="ob-btn-primary"
                  onClick={() => setStep('theme')}
                  disabled={parserMode === 'enhanced' && !keySaved}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Theme */}
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
                <button className="ob-btn-secondary" onClick={() => setStep('ai-provider')}>Back</button>
                <button className="ob-btn-primary" onClick={() => setStep('complete')}>Continue</button>
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
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
                  <span>Theme</span>
                  <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                </div>
              </div>
              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('theme')}>Back</button>
                <button className="ob-btn-primary ob-btn-launch" onClick={handleComplete} disabled={saving}>
                  {saving ? 'Launching...' : 'Launch Command Center'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
