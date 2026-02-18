import { useState, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useThemeStore } from '../stores/theme';
import './Login.css';

function getApiUrl() {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('integration.tax')) return '';
  return 'http://localhost:3001';
}

const API_BASE = getApiUrl();

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Create Account — Forge';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  const passwordChecks = {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!passwordChecks.length || !passwordChecks.upper || !passwordChecks.lower || !passwordChecks.number) {
      setError('Password does not meet requirements');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.trim(),
          password,
          display_name: name.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Registration failed' }));
        throw new Error(data.error || data.message || 'Registration failed');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="auth-logo-icon" style={{ fontSize: '2rem' }}>🔨</span>
            <span className="auth-logo-text">
              <span className="auth-logo-alf animate-gradient-text">Forge</span>
            </span>
          </div>
          <p className="auth-subtitle">Create your account</p>
        </div>

        {success ? (
          <div className="auth-success-box">
            <div className="auth-success-icon">✓</div>
            <h3>Account created</h3>
            <p>Check your email for a verification link.</p>
            <Link to="/login" className="auth-back-link">Go to sign in</Link>
          </div>
        ) : (
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
              <label htmlFor="name">Display Name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                autoFocus
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
                placeholder="Min 12 characters"
                required
                autoComplete="new-password"
              />
              {password && (
                <div className="auth-password-requirements">
                  <span className={passwordChecks.length ? 'auth-req-met' : 'auth-req-unmet'}>12+ chars</span>
                  <span className={passwordChecks.upper ? 'auth-req-met' : 'auth-req-unmet'}>Uppercase</span>
                  <span className={passwordChecks.lower ? 'auth-req-met' : 'auth-req-unmet'}>Lowercase</span>
                  <span className={passwordChecks.number ? 'auth-req-met' : 'auth-req-unmet'}>Number</span>
                </div>
              )}
            </div>

            <div className="auth-field">
              <label htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
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
        )}

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
