import { useState, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useThemeStore } from '../stores/theme';
import './Login.css';

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);

  // Honeypot fields (hidden from users, filled by bots)
  const [honeypot1, setHoneypot1] = useState('');
  const [honeypot2, setHoneypot2] = useState('');

  // Force dark theme on auth pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Join Waitlist — Ask ALF';

    // Fetch waitlist count
    fetch(`${API_BASE}/api/v1/waitlist/count`)
      .then(res => res.json())
      .then(data => setWaitlistCount(data.count))
      .catch(() => {});

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

    // Bot detection
    if (honeypot1 || honeypot2) return;

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, honeypot1, honeypot2 }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setSuccess(true);
      // Update count
      fetch(`${API_BASE}/api/v1/waitlist/count`)
        .then(res => res.json())
        .then(data => setWaitlistCount(data.count))
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join waitlist');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="auth-logo-icon">👽</span>
            <span className="auth-logo-text">
              <span className="auth-logo-ask">Ask</span>
              <span className="auth-logo-alf animate-gradient-text">ALF</span>
            </span>
          </div>
          <p className="auth-subtitle">Join the waitlist for early access</p>
        </div>

        {success ? (
          <div className="auth-success-card">
            <div className="auth-success-icon">🎉</div>
            <h2>You're on the list!</h2>
            <p>We'll send you an invite when it's your turn. Check your email for confirmation.</p>
            {waitlistCount && (
              <p className="auth-waitlist-position">
                <strong>{waitlistCount.toLocaleString()}</strong> people on the waitlist
              </p>
            )}
            <Link to="/" className="auth-back-link">← Back to home</Link>
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
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            {/* Honeypot fields - hidden from real users */}
            <input
              type="text"
              name="website"
              value={honeypot1}
              onChange={(e) => setHoneypot1(e.target.value)}
              autoComplete="off"
              tabIndex={-1}
              style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }}
            />
            <input
              type="text"
              name="company_name"
              value={honeypot2}
              onChange={(e) => setHoneypot2(e.target.value)}
              autoComplete="off"
              tabIndex={-1}
              style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }}
            />

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
                'Join Waitlist'
              )}
            </button>

            {waitlistCount && (
              <p className="auth-waitlist-note">
                Join <strong>{waitlistCount.toLocaleString()}</strong> others waiting for access
              </p>
            )}
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
