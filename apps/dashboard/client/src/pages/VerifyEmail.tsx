import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import './Login.css';

function getApiUrl() {
  const host = window.location.hostname;
  if (host.includes('orcastr8r.com') || host.includes('integration.tax')) return '';
  return 'http://localhost:3001';
}

const API_BASE = getApiUrl();

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'waiting'>('waiting');
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const { user, checkAuth, logout } = useAuthStore();

  // Force dark theme
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Verify Email — Orcastr8r';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  // If user is already verified, redirect to app
  useEffect(() => {
    if (user && user.emailVerified === true) {
      sessionStorage.removeItem('just_registered');
      navigate('/command-center', { replace: true });
    }
  }, [user, navigate]);

  // If token present, auto-verify
  useEffect(() => {
    if (!token) {
      setStatus('waiting');
      return;
    }

    setStatus('verifying');
    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Verification failed');
        }

        setStatus('success');
        await checkAuth();
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Verification failed');
      }
    }

    verify();

    return () => { cancelled = true; };
  }, [token, checkAuth]);

  const handleResend = async () => {
    setResending(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/resend-verification`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setResent(true);
      }
    } catch {
      // silent fail
    } finally {
      setResending(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Poll for verification status every 5 seconds (user may verify in another tab)
  useEffect(() => {
    if (status !== 'waiting' || !user || user.emailVerified === true) return;

    const interval = setInterval(async () => {
      await checkAuth();
    }, 5000);

    return () => clearInterval(interval);
  }, [status, user, checkAuth]);

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="auth-logo-wordmark">orcastr8r</span>
          </div>
        </div>

        {/* Mode 1: Processing token verification */}
        {status === 'verifying' && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div className="auth-loading" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
              <span className="auth-loading-dot" />
              <span className="auth-loading-dot" />
              <span className="auth-loading-dot" />
            </div>
            <p className="auth-subtitle">Verifying your email...</p>
          </div>
        )}

        {/* Mode 2: Verification succeeded */}
        {status === 'success' && (
          <div className="auth-success-box">
            <div className="auth-success-icon">✓</div>
            <h3>Email Verified</h3>
            <p>Your email has been verified successfully.</p>
            <div style={{ marginTop: '1.5rem' }}>
              <Link to="/command-center" className="auth-submit" style={{ display: 'inline-block', textDecoration: 'none', padding: '0.75rem 2rem' }}>
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Mode 3: Token verification failed */}
        {status === 'error' && (
          <>
            <div className="auth-error">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>

            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              {resent ? (
                <p className="auth-subtitle" style={{ color: '#7c3aed' }}>New verification email sent!</p>
              ) : (
                <button
                  className="auth-submit"
                  onClick={handleResend}
                  disabled={resending}
                  style={{ width: '100%' }}
                >
                  {resending ? 'Sending...' : 'Resend Verification Email'}
                </button>
              )}
            </div>

            <div className="auth-footer">
              <p>
                <button onClick={handleLogout} className="auth-link" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  Sign out
                </button>
                {' and try a different account.'}
              </p>
            </div>
          </>
        )}

        {/* Mode 4: Waiting for verification (gate page - no token) */}
        {status === 'waiting' && (
          <>
            <div style={{ textAlign: 'center', padding: '1.5rem 0 0.5rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>✉️</div>
              <h3 style={{ color: '#fff', fontSize: '1.35rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
                Verify Your Email
              </h3>
              <p className="auth-subtitle" style={{ marginBottom: '1.5rem', lineHeight: 1.6 }}>
                {user ? (
                  <>We sent a verification link to <strong style={{ color: '#fff' }}>{user.email}</strong>. Please check your inbox and click the link to activate your account.</>
                ) : (
                  <>Please check your inbox for a verification link to activate your account.</>
                )}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {resent ? (
                <p className="auth-subtitle" style={{ color: '#7c3aed', textAlign: 'center', padding: '0.75rem 0' }}>
                  Verification email sent! Check your inbox.
                </p>
              ) : (
                <button
                  className="auth-submit"
                  onClick={handleResend}
                  disabled={resending || !user}
                  style={{ width: '100%' }}
                >
                  {resending ? 'Sending...' : 'Resend Verification Email'}
                </button>
              )}
            </div>

            <div style={{ textAlign: 'center', padding: '1rem 0 0', fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
              We'll automatically redirect you once verified.
            </div>

            <div className="auth-footer">
              <p>
                Wrong email?{' '}
                <button onClick={handleLogout} className="auth-link" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
                  Sign out
                </button>
              </p>
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
