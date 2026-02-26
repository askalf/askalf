import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import './Login.css';

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

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuthStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean }>({});

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Create Account — AskAlf';
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

  const nameError = touched.name ? validateName(name) : null;
  const emailError = touched.email ? validateEmail(email) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, email: true });

    const nameErr = validateName(name);
    const emailErr = validateEmail(email);
    if (nameErr || emailErr) { setError(nameErr || emailErr || ''); return; }

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
      await register(email.trim(), password, name.trim());
      // Auto-login happens in register() — navigate to verify email
      navigate('/verify-email', { replace: true });
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
            <span className="auth-logo-wordmark">askalf</span>
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

            <div className={`auth-field${nameError ? ' auth-field-error' : ''}`}>
              <label htmlFor="name">Display Name</label>
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
