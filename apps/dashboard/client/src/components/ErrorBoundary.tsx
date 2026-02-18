import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Send error to API for logging in production
    this.reportError(error, errorInfo);
  }

  private async reportError(error: Error, errorInfo: ErrorInfo) {
    try {
      const host = window.location.hostname;
      const apiBase = (host.includes('askalf.org') || host.includes('integration.tax'))
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

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
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
              We encountered an unexpected error. Our team has been notified.
            </p>

            {this.state.error && (
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
                  Error Details
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
