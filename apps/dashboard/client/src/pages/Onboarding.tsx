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
  const [providerType, setProviderType] = useState<'anthropic' | 'openai' | 'google'>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [keysSaved, setKeysSaved] = useState<string[]>([]);

  const currentIdx = STEPS.findIndex(s => s.key === step);

  const handleTestKey = async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Save the key first
      const saveRes = await fetch(`${API_BASE}/api/v1/forge/user-providers/${providerType}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!saveRes.ok) {
        setTestResult({ ok: false, msg: 'Failed to save key' });
        setTesting(false);
        return;
      }
      // Verify it works
      const verifyRes = await fetch(`${API_BASE}/api/v1/forge/user-providers/${providerType}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await verifyRes.json() as { valid?: boolean; error?: string };
      if (data.valid) {
        setTestResult({ ok: true, msg: 'Connected successfully' });
        if (!keysSaved.includes(providerType)) setKeysSaved([...keysSaved, providerType]);
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
              <h1 className="ob-title">Connect an AI provider</h1>
              <p className="ob-desc">
                AskAlf needs at least one AI provider to power agent executions.
              </p>

              <div className="ob-provider-tabs">
                {(['anthropic', 'openai', 'google'] as const).map(p => (
                  <button
                    key={p}
                    className={`ob-provider-tab ${providerType === p ? 'active' : ''} ${keysSaved.includes(p) ? 'saved' : ''}`}
                    onClick={() => { setProviderType(p); setApiKey(''); setTestResult(null); }}
                  >
                    {p === 'anthropic' ? 'Anthropic' : p === 'openai' ? 'OpenAI' : 'Google AI'}
                    {keysSaved.includes(p) && <span className="ob-provider-check">&#10003;</span>}
                  </button>
                ))}
              </div>

              <div className="ob-field">
                <label>API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestResult(null); }}
                  placeholder={providerType === 'anthropic' ? 'sk-ant-...' : providerType === 'openai' ? 'sk-...' : 'AI...'}
                />
              </div>

              {testResult && (
                <div className={`ob-test-result ${testResult.ok ? 'ok' : 'fail'}`}>
                  {testResult.msg}
                </div>
              )}

              <div className="ob-btn-row">
                <button className="ob-btn-secondary" onClick={() => setStep('welcome')}>Back</button>
                <button className="ob-btn-secondary" onClick={handleTestKey} disabled={testing || !apiKey.trim()}>
                  {testing ? 'Testing...' : 'Test & Save'}
                </button>
                <button
                  className="ob-btn-primary"
                  onClick={() => setStep('theme')}
                  disabled={keysSaved.length === 0}
                >
                  Continue
                </button>
              </div>
              {keysSaved.length === 0 && (
                <span className="ob-hint" style={{ textAlign: 'center', display: 'block', marginTop: '8px' }}>
                  Add and test at least one provider to continue
                </span>
              )}
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
                  <span>AI Providers</span>
                  <span>{keysSaved.map(k => k === 'anthropic' ? 'Anthropic' : k === 'openai' ? 'OpenAI' : 'Google').join(', ')}</span>
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
