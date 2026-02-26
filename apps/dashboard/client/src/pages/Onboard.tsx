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

type WizardStep = 'workspace' | 'theme';
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

  const handleComplete = async () => {
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

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="auth-logo-wordmark">askalf</span>
          </div>

          {/* Step indicator */}
          <div className="onboard-steps">
            <div className={`onboard-step-dot ${step === 'workspace' ? 'active' : 'done'}`} />
            <div className={`onboard-step-dot ${step === 'theme' ? 'active' : ''}`} />
          </div>
        </div>

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

            {error && (
              <div className="auth-error" style={{ marginBottom: 'var(--space-md)' }}>
                <span>{error}</span>
              </div>
            )}

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
              <button
                className="onboard-back-btn"
                onClick={() => setStep('workspace')}
                type="button"
              >
                Back
              </button>
              <button
                className="auth-submit"
                onClick={handleComplete}
                disabled={isSubmitting}
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
