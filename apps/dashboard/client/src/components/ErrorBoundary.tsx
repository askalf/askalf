import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** If true, show a compact inline error instead of fullscreen */
  inline?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

const MAX_AUTO_RETRIES = 3;

class ErrorBoundary extends Component<Props, State> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const nextRetry = this.state.retryCount + 1;
    this.setState({ errorInfo, retryCount: nextRetry });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Send error to API for logging in production
    this.reportError(error, errorInfo);

    // Auto-retry up to MAX_AUTO_RETRIES times, then stop (prevents infinite crash loop)
    if (nextRetry <= MAX_AUTO_RETRIES) {
      this.retryTimer = setTimeout(() => {
        this.setState({ hasError: false, error: null, errorInfo: null });
      }, 10000 + nextRetry * 5000); // 15s, 20s, 25s
    }
  }

  private async reportError(error: Error, errorInfo: ErrorInfo) {
    try {
      const host = window.location.hostname;
      const apiBase = host.includes('orcastr8r.com')
        ? ''
        : 'http://localhost:3001';

      await fetch(`${apiBase}/api/v1/errors/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          url: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Silently fail - don't want error reporting to cause more errors
      console.warn('Failed to report error to server');
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, retryCount: 0 });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const stillRetrying = this.state.retryCount <= MAX_AUTO_RETRIES;
      const statusMessage = stillRetrying
        ? `Auto-retrying... (attempt ${this.state.retryCount}/${MAX_AUTO_RETRIES})`
        : 'Auto-retry exhausted. Click reload to try again.';

      // Inline mode — compact error for per-panel boundaries
      if (this.props.inline) {
        return (
          <div style={{
            padding: '1.5rem',
            margin: '0.5rem',
            background: 'rgba(255, 107, 107, 0.08)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 107, 107, 0.2)',
            color: '#e0e0e0',
            textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 0.5rem', color: '#ff6b6b', fontWeight: 500 }}>This panel failed to load</p>
            <p style={{ margin: '0 0 0.75rem', color: '#a0a0a0', fontSize: '0.8rem' }}>{statusMessage}</p>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.4rem 1rem',
                background: '#4f46e5',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Retry
            </button>
          </div>
        );
      }

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)',
          color: '#e0e0e0',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <div style={{
            maxWidth: '500px',
            textAlign: 'center',
            padding: '2rem',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
              <span role="img" aria-label="Error">&#x26A0;</span>
            </div>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: '#ff6b6b' }}>
              Something went wrong
            </h1>
            <p style={{ color: '#a0a0a0', marginBottom: '1.5rem' }}>
              {statusMessage}
            </p>

            {this.state.error && import.meta.env.DEV && (
              <details style={{
                marginBottom: '1.5rem',
                textAlign: 'left',
                padding: '1rem',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '8px',
                fontSize: '0.75rem',
                overflow: 'auto',
              }}>
                <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
                  Error Details (dev only)
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#4f46e5',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Reload Page
              </button>
              <button
                onClick={this.handleGoHome}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'transparent',
                  color: '#a0a0a0',
                  border: '1px solid #a0a0a0',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
