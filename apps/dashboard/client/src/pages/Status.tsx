import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'checking';
  latency?: number;
  details?: string;
}

function getApiUrl() {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('amnesia.tax')) return '';
  return 'http://localhost:3001';
}

const API_BASE = getApiUrl();

export default function StatusPage() {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'Dashboard', status: 'checking' },
    { name: 'Agent Engine', status: 'checking' },
    { name: 'MCP Tools', status: 'checking' },
    { name: 'Database', status: 'checking' },
  ]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);

  const checkServices = useCallback(async () => {
    setChecking(true);
    const results: ServiceStatus[] = [];

    // Dashboard health
    try {
      const start = performance.now();
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json() as { status: string; database: string };
        results.push({
          name: 'Dashboard',
          status: 'healthy',
          latency,
          details: `DB: ${data.database}`,
        });
        results.push({
          name: 'Database',
          status: data.database === 'connected' ? 'healthy' : 'degraded',
          details: data.database,
        });
      } else {
        results.push({ name: 'Dashboard', status: 'degraded', latency, details: `HTTP ${res.status}` });
        results.push({ name: 'Database', status: 'checking', details: 'Unknown' });
      }
    } catch {
      results.push({ name: 'Dashboard', status: 'down', details: 'Unreachable' });
      results.push({ name: 'Database', status: 'down', details: 'Unreachable (via dashboard)' });
    }

    // Forge health (proxied through dashboard/nginx)
    try {
      const start = performance.now();
      const res = await fetch(`${API_BASE}/api/v1/forge/health`, { signal: AbortSignal.timeout(5000) });
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        results.push({ name: 'Forge (Agent Engine)', status: 'healthy', latency });
      } else {
        results.push({ name: 'Forge (Agent Engine)', status: 'degraded', latency, details: `HTTP ${res.status}` });
      }
    } catch {
      results.push({ name: 'Forge (Agent Engine)', status: 'down', details: 'Unreachable' });
    }

    // MCP Tools health
    try {
      const start = performance.now();
      const res = await fetch(`${API_BASE}/api/v1/mcp/health`, { signal: AbortSignal.timeout(5000) });
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        results.push({ name: 'MCP Tools', status: 'healthy', latency });
      } else {
        results.push({ name: 'MCP Tools', status: 'degraded', latency, details: `HTTP ${res.status}` });
      }
    } catch {
      results.push({ name: 'MCP Tools', status: 'down', details: 'Unreachable' });
    }

    setServices(results);
    setLastChecked(new Date());
    setChecking(false);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'System Status — AskAlf';
    checkServices();
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, [checkServices]);

  const allHealthy = services.every((s) => s.status === 'healthy');
  const anyDown = services.some((s) => s.status === 'down');

  return (
    <div className="landing-page legal-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">askalf</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/command-center" className="landing-nav-signin">Dashboard</Link>
        </div>
      </nav>

      <section className="legal-content" style={{ maxWidth: 700 }}>
        <p className="landing-section-label">// system</p>
        <h1 className="landing-section-title" style={{ marginBottom: '0.5rem' }}>System Status</h1>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          margin: '1.5rem 0 2rem',
          padding: '1rem 1.25rem',
          background: allHealthy ? 'rgba(6, 214, 160, 0.08)' : anyDown ? 'rgba(239, 68, 68, 0.08)' : 'rgba(251, 191, 36, 0.08)',
          border: `1px solid ${allHealthy ? 'rgba(6, 214, 160, 0.2)' : anyDown ? 'rgba(239, 68, 68, 0.2)' : 'rgba(251, 191, 36, 0.2)'}`,
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: allHealthy ? '#06d6a0' : anyDown ? '#ef4444' : '#fbbf24',
            boxShadow: `0 0 8px ${allHealthy ? '#06d6a0' : anyDown ? '#ef4444' : '#fbbf24'}`,
          }} />
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>
            {allHealthy ? 'All Systems Operational' : anyDown ? 'System Outage Detected' : 'Partial Degradation'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {services.map((svc) => (
            <div key={svc.name} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.875rem 1.25rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: svc.status === 'healthy' ? '#06d6a0'
                    : svc.status === 'degraded' ? '#fbbf24'
                    : svc.status === 'down' ? '#ef4444' : 'var(--text-secondary)',
                }} />
                <span style={{ color: 'var(--text)', fontWeight: 500, fontSize: '0.9375rem' }}>{svc.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {svc.latency !== undefined && (
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                  }}>
                    {svc.latency}ms
                  </span>
                )}
                <span style={{
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  color: svc.status === 'healthy' ? '#06d6a0'
                    : svc.status === 'degraded' ? '#fbbf24'
                    : svc.status === 'down' ? '#ef4444' : 'var(--text-secondary)',
                }}>
                  {svc.status === 'checking' ? 'Checking...' : svc.status.charAt(0).toUpperCase() + svc.status.slice(1)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            {lastChecked ? `Last checked: ${lastChecked.toLocaleTimeString()}` : 'Checking...'}
            {' '}&middot; Auto-refreshes every 30s
          </span>
          <button
            onClick={checkServices}
            disabled={checking}
            style={{
              padding: '0.375rem 0.75rem',
              fontSize: '0.8125rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              cursor: checking ? 'not-allowed' : 'pointer',
              opacity: checking ? 0.5 : 1,
            }}
          >
            {checking ? 'Checking...' : 'Refresh'}
          </button>
        </div>
      </section>

      <footer className="landing-footer" role="contentinfo">
        <div className="landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-footer-copy">
              {'\u00A9'} {new Date().getFullYear()} AskAlf. All rights reserved.
            </span>
          </div>
          <div className="landing-footer-links">
            <Link to="/" className="landing-footer-link">Home</Link>
            <Link to="/docs" className="landing-footer-link">Docs</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
