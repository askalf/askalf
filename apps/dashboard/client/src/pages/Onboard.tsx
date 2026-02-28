import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import './Login.css';
import './Onboard.css';

function getApiUrl() {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  return 'http://localhost:3001';
}

const API_BASE = getApiUrl();

type WizardStep = 'workspace' | 'theme' | 'connect-ai';
type ThemeChoice = 'dark' | 'light' | 'system';

export default function OnboardPage() {
  const navigate = useNavigate();
  const { user, checkAuth } = useAuthStore();
  const { setTheme } = useThemeStore();

  const [step, setStep] = useState<WizardStep>('workspace');
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<ThemeChoice>('dark');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // AI provider state
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicStatus, setAnthropicStatus] = useState<'none' | 'saving' | 'verifying' | 'valid' | 'error'>('none');
  const [openaiStatus, setOpenaiStatus] = useState<'none' | 'saving' | 'verifying' | 'valid' | 'error' | 'skipped'>('none');
  const [anthropicError, setAnthropicError] = useState('');
  const [openaiError, setOpenaiError] = useState('');

  // Force dark theme during onboarding
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Setup — AskAlf';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  // Pre-fill workspace name from user's display name
  useEffect(() => {
    if (user?.displayName && !workspaceName) {
      setWorkspaceName(`${user.displayName}'s workspace`);
    }
  }, [user?.displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  // If already onboarded, redirect
  useEffect(() => {
    if (user?.onboardingCompleted) {
      navigate('/command-center', { replace: true });
    }
  }, [user?.onboardingCompleted, navigate]);

  // If not logged in, redirect to login
  useEffect(() => {
    if (!user && !useAuthStore.getState().isLoading) {
      navigate('/login', { replace: true });
    }
  }, [user, navigate]);

  const handleContinue = () => {
    if (!workspaceName.trim()) {
      setError('Give your workspace a name');
      return;
    }
    setError('');
    setStep('theme');
  };

  const handleThemeContinue = () => {
    setError('');
    setStep('connect-ai');
  };

  const saveAndVerifyKey = async (providerType: string, apiKey: string): Promise<boolean> => {
    // Save
    const saveRes = await fetch(`${API_BASE}/api/v1/forge/user-providers/${providerType}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey.trim() }),
    });
    if (!saveRes.ok) {
      const data = await saveRes.json().catch(() => ({ message: 'Failed to save key' }));
      throw new Error(data.message || 'Failed to save key');
    }

    // Verify
    const verifyRes = await fetch(`${API_BASE}/api/v1/forge/user-providers/${providerType}/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await verifyRes.json() as { status: string; error?: string };
    if (data.status !== 'valid') {
      throw new Error(data.error || 'Key verification failed');
    }
    return true;
  };

  const handleSaveAnthropic = async () => {
    if (!anthropicKey.trim()) {
      setAnthropicError('Enter your Anthropic API key');
      return;
    }
    setAnthropicError('');
    setAnthropicStatus('saving');
    try {
      await saveAndVerifyKey('anthropic', anthropicKey);
      setAnthropicStatus('valid');
    } catch (err) {
      setAnthropicStatus('error');
      setAnthropicError(err instanceof Error ? err.message : 'Failed to verify');
    }
  };

  const handleSaveOpenai = async () => {
    if (!openaiKey.trim()) {
      setOpenaiStatus('skipped');
      return;
    }
    setOpenaiError('');
    setOpenaiStatus('saving');
    try {
      await saveAndVerifyKey('openai', openaiKey);
      setOpenaiStatus('valid');
    } catch (err) {
      setOpenaiStatus('error');
      setOpenaiError(err instanceof Error ? err.message : 'Failed to verify');
    }
  };

  const handleComplete = async () => {
    // Anthropic is required
    if (anthropicStatus !== 'valid') {
      setError('Connect your Anthropic account to continue');
      return;
    }

    // Save OpenAI if entered but not yet saved
    if (openaiKey.trim() && openaiStatus === 'none') {
      await handleSaveOpenai();
    }

    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspace_name: workspaceName.trim(),
          theme: selectedTheme,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Setup failed' }));
        throw new Error(data.error || 'Setup failed');
      }

      // Apply theme choice
      setTheme(selectedTheme);

      // Refresh auth state (now has onboardingCompleted: true)
      await checkAuth();

      navigate('/command-center', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) return null;

  const stepIndex = step === 'workspace' ? 0 : step === 'theme' ? 1 : 2;

  return (
    <div className="auth-page">
      <div className="auth-container" style={step === 'connect-ai' ? { maxWidth: 480 } : undefined}>
        <div className="auth-header">
          <div className="auth-logo">
            <span className="auth-logo-wordmark">askalf</span>
          </div>

          {/* Step indicator — 3 dots now */}
          <div className="onboard-steps">
            <div className={`onboard-step-dot ${stepIndex === 0 ? 'active' : stepIndex > 0 ? 'done' : ''}`} />
            <div className={`onboard-step-dot ${stepIndex === 1 ? 'active' : stepIndex > 1 ? 'done' : ''}`} />
            <div className={`onboard-step-dot ${stepIndex === 2 ? 'active' : ''}`} />
          </div>
        </div>

        {/* Step 1: Workspace */}
        {step === 'workspace' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
              <h3 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
                Name your workspace
              </h3>
              <p className="auth-subtitle">
                This is your team's home. You can change it later.
              </p>
            </div>

            {error && (
              <div className="auth-error" style={{ marginBottom: 'var(--space-md)' }}>
                <span>{error}</span>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="workspace-name">Workspace name</label>
              <input
                id="workspace-name"
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
                placeholder="My workspace"
                autoFocus
                autoComplete="off"
              />
            </div>

            <button
              className="auth-submit"
              onClick={handleContinue}
              style={{ marginTop: 'var(--space-lg)' }}
            >
              Continue
            </button>
          </>
        )}

        {/* Step 2: Theme */}
        {step === 'theme' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
              <h3 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
                Pick your look
              </h3>
              <p className="auth-subtitle">
                Choose a theme for your dashboard.
              </p>
            </div>

            <div className="onboard-theme-grid">
              <button
                className={`onboard-theme-card ${selectedTheme === 'dark' ? 'selected' : ''}`}
                onClick={() => setSelectedTheme('dark')}
                type="button"
              >
                <div className="onboard-theme-swatch onboard-swatch-dark">
                  <div className="onboard-swatch-bar" />
                  <div className="onboard-swatch-bar short" />
                </div>
                <span className="onboard-theme-label">Dark</span>
              </button>

              <button
                className={`onboard-theme-card ${selectedTheme === 'light' ? 'selected' : ''}`}
                onClick={() => setSelectedTheme('light')}
                type="button"
              >
                <div className="onboard-theme-swatch onboard-swatch-light">
                  <div className="onboard-swatch-bar" />
                  <div className="onboard-swatch-bar short" />
                </div>
                <span className="onboard-theme-label">Light</span>
              </button>

              <button
                className={`onboard-theme-card ${selectedTheme === 'system' ? 'selected' : ''}`}
                onClick={() => setSelectedTheme('system')}
                type="button"
              >
                <div className="onboard-theme-swatch onboard-swatch-system">
                  <div className="onboard-swatch-half-dark">
                    <div className="onboard-swatch-bar" />
                  </div>
                  <div className="onboard-swatch-half-light">
                    <div className="onboard-swatch-bar" />
                  </div>
                </div>
                <span className="onboard-theme-label">System</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-lg)' }}>
              <button className="onboard-back-btn" onClick={() => setStep('workspace')} type="button">
                Back
              </button>
              <button className="auth-submit" onClick={handleThemeContinue} style={{ flex: 1 }}>
                Continue
              </button>
            </div>
          </>
        )}

        {/* Step 3: Connect your AI */}
        {step === 'connect-ai' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
              <h3 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
                Connect your AI
              </h3>
              <p className="auth-subtitle">
                Your agents need an AI provider to think. Connect at least Anthropic to get started.
              </p>
            </div>

            {error && (
              <div className="auth-error" style={{ marginBottom: 'var(--space-md)' }}>
                <span>{error}</span>
              </div>
            )}

            {/* Anthropic — Required */}
            <div className="onboard-provider-card">
              <div className="onboard-provider-header">
                <div className="onboard-provider-info">
                  <span className="onboard-provider-name">Anthropic</span>
                  <span className="onboard-provider-badge required">Required</span>
                </div>
                {anthropicStatus === 'valid' && (
                  <span className="onboard-provider-status valid">Connected</span>
                )}
              </div>
              <p className="onboard-provider-desc">
                Powers Claude agents — the primary engine behind your fleet.
                Get a key at{' '}
                <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">
                  console.anthropic.com
                </a>
              </p>
              {anthropicStatus !== 'valid' && (
                <div className="onboard-key-row">
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveAnthropic()}
                    placeholder="sk-ant-..."
                    className="onboard-key-input"
                    autoComplete="off"
                  />
                  <button
                    className="onboard-key-btn"
                    onClick={handleSaveAnthropic}
                    disabled={anthropicStatus === 'saving' || anthropicStatus === 'verifying'}
                  >
                    {anthropicStatus === 'saving' || anthropicStatus === 'verifying' ? 'Verifying...' : 'Connect'}
                  </button>
                </div>
              )}
              {anthropicError && <p className="onboard-provider-error">{anthropicError}</p>}
            </div>

            {/* OpenAI — Optional */}
            <div className="onboard-provider-card" style={{ marginTop: 'var(--space-md)' }}>
              <div className="onboard-provider-header">
                <div className="onboard-provider-info">
                  <span className="onboard-provider-name">OpenAI</span>
                  <span className="onboard-provider-badge optional">Optional</span>
                </div>
                {openaiStatus === 'valid' && (
                  <span className="onboard-provider-status valid">Connected</span>
                )}
                {openaiStatus === 'skipped' && (
                  <span className="onboard-provider-status skipped">Skipped</span>
                )}
              </div>
              <p className="onboard-provider-desc">
                Run agents on GPT models. You can add this later in Settings.
              </p>
              {openaiStatus !== 'valid' && openaiStatus !== 'skipped' && (
                <div className="onboard-key-row">
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveOpenai()}
                    placeholder="sk-..."
                    className="onboard-key-input"
                    autoComplete="off"
                  />
                  <button
                    className="onboard-key-btn secondary"
                    onClick={handleSaveOpenai}
                    disabled={openaiStatus === 'saving' || openaiStatus === 'verifying'}
                  >
                    {openaiStatus === 'saving' || openaiStatus === 'verifying' ? 'Verifying...' : openaiKey.trim() ? 'Connect' : 'Skip'}
                  </button>
                </div>
              )}
              {openaiError && <p className="onboard-provider-error">{openaiError}</p>}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
              <button className="onboard-back-btn" onClick={() => setStep('theme')} type="button">
                Back
              </button>
              <button
                className="auth-submit"
                onClick={handleComplete}
                disabled={isSubmitting || anthropicStatus !== 'valid'}
                style={{ flex: 1 }}
              >
                {isSubmitting ? (
                  <span className="auth-loading">
                    <span className="auth-loading-dot" />
                    <span className="auth-loading-dot" />
                    <span className="auth-loading-dot" />
                  </span>
                ) : (
                  'Get Started'
                )}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="auth-background">
        <div className="auth-gradient" />
      </div>
    </div>
  );
}
