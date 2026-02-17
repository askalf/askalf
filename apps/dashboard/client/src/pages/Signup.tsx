import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import './Login.css';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [deploymentName, setDeploymentName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();
  const { register } = useAuthStore();

  // Force dark theme on auth pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Sign Up — Forge';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    if (!deploymentName.trim()) {
      setError('Deployment name is required');
      setIsLoading(false);
      return;
    }

    try {
      await register(email, password, displayName || undefined, deploymentName);
      navigate('/command-center');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="auth-logo-icon" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--crystal)' }}>F</span>
            <span className="auth-logo-text">
              <span className="auth-logo-alf animate-gradient-text">Forge</span>
            </span>
          </div>
          <p className="auth-subtitle">Create your account</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && (
            <div className="auth-error">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="deploymentName">Deployment Name</label>
            <input
              id="deploymentName"
              type="text"
              value={deploymentName}
              onChange={(e) => setDeploymentName(e.target.value)}
              placeholder="e.g., Acme Corp Production"
              required
              autoFocus
            />
            <span style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px', display: 'block' }}>
              The name of your Forge deployment
            </span>
          </div>

          <div className="auth-field">
            <label htmlFor="displayName">Display Name</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
              autoComplete="name"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="auth-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="auth-loading">
                <span className="auth-loading-dot" />
                <span className="auth-loading-dot" />
                <span className="auth-loading-dot" />
              </span>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-link">Sign in</Link>
          </p>
        </div>
      </div>

      <div className="auth-background">
        <div className="auth-gradient" />
      </div>
    </div>
  );
}
