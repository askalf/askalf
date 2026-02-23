import { useState, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useThemeStore } from '../stores/theme';
import './Login.css';

function getApiUrl() {
  const host = window.location.hostname;
  if (host.includes('orcastr8r.com') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  return 'http://localhost:3001';
}

const API_BASE = getApiUrl();

function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address';
  return null;
}

function validateName(name: string): string | null {
  if (!name.trim()) return 'Name is required';
  if (name.trim().length < 2) return 'Name must be at least 2 characters';
  return null;
}

export default function WaitlistPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean }>({});

  // Force dark theme on auth pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Join the Waitlist — Orcastr8r';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  const nameError = touched.name ? validateName(name) : null;
  const emailError = touched.email ? validateEmail(email) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, email: true });

    const nameErr = validateName(name);
    const emailErr = validateEmail(email);
    if (nameErr || emailErr) {
      setError(nameErr || emailErr || '');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), ...(website && { website }) }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setJoined(true);
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
            <span className="auth-logo-wordmark">orcastr8r</span>
          </div>
          <div className="auth-beta-badge">Early Access</div>
          <p className="auth-subtitle">
            Agent orchestration for teams that build with AI
          </p>
        </div>

        {joined ? (
          <div className="auth-success-box">
            <div className="auth-success-icon">✓</div>
            <h3>You're on the list</h3>
            <p>We'll reach out when your spot opens up.</p>
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

            <div className={`auth-field${nameError ? ' auth-field-error' : ''}`}>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, name: true }))}
                placeholder="Your name"
                required
                autoFocus
                autoComplete="name"
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'name-error' : undefined}
              />
              {nameError && <span id="name-error" className="auth-field-hint">{nameError}</span>}
            </div>

            <div className={`auth-field${emailError ? ' auth-field-error' : ''}`}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, email: true }))}
                placeholder="you@example.com"
                required
                autoComplete="email"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'email-error' : undefined}
              />
              {emailError && <span id="email-error" className="auth-field-hint">{emailError}</span>}
            </div>

            {/* Honeypot — hidden from real users, bots auto-fill it */}
            <div style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
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
                'Join the Waitlist'
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
