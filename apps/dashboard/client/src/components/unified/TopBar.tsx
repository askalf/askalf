import { useState, useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/theme';
import NotificationCenter from '../NotificationCenter';

interface TopBarProps {
  wsConnected: boolean;
  agentCount: number;
  todayCost: number;
  budgetLimit?: number;
  onNavigate?: (tab: string) => void;
}

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  displayName?: string;
  role?: string;
  tenantName?: string | null;
}

export default function TopBar({ wsConnected, agentCount, todayCost, budgetLimit, onNavigate }: TopBarProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<'healthy' | 'expiring' | 'expired' | 'unknown'>('unknown');
  const [oauthRefreshing, setOauthRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useThemeStore();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  // Fetch current user
  useEffect(() => {
    fetch('/api/v1/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.user) setUser(data.user); })
      .catch(() => {});
  }, []);

  // Check OAuth token health
  useEffect(() => {
    const checkOAuth = () => {
      fetch('/api/v1/forge/credentials/health', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.status) setOauthStatus(data.status); })
        .catch(() => {});
    };
    checkOAuth();
    const timer = setInterval(checkOAuth, 60000);
    return () => clearInterval(timer);
  }, []);

  const handleOAuthRefresh = async () => {
    setOauthRefreshing(true);
    try {
      const res = await fetch('/api/v1/forge/credentials/refresh', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (data?.refreshed) setOauthStatus('healthy');
    } catch { /* ignore */ }
    setOauthRefreshing(false);
  };

  const oauthColor = oauthStatus === 'healthy' ? '#22c55e' : oauthStatus === 'expiring' ? '#f59e0b' : oauthStatus === 'expired' ? '#ef4444' : '#6b7280';
  const oauthLabel = oauthStatus === 'healthy' ? 'Token OK' : oauthStatus === 'expiring' ? 'Token Expiring' : oauthStatus === 'expired' ? 'Token Expired' : 'Token ?';

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    window.location.href = '/command-center';
  };

  const healthColor = wsConnected ? '#22c55e' : '#ef4444';
  const healthLabel = wsConnected ? 'Healthy' : 'Disconnected';
  const userName = user?.displayName || user?.name;
  const initials = userName ? userName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="ud-topbar">
      <div className="ud-topbar-left">
        {user?.tenantName && (
          <>
            <span className="ud-topbar-workspace">{user.tenantName}</span>
            <span className="ud-topbar-divider" />
          </>
        )}
        <span className="ud-health-dot" style={{ background: healthColor }} aria-hidden="true" />
        <span className="ud-topbar-label" aria-label={`Connection status: ${healthLabel}`}>{healthLabel}</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">{agentCount} running</span>
        <span className="ud-topbar-divider" />
        <span className={`ud-topbar-stat${budgetLimit && todayCost / budgetLimit > 0.8 ? todayCost / budgetLimit >= 1 ? ' ud-topbar-cost-over' : ' ud-topbar-cost-warn' : ''}`}>
          ${todayCost.toFixed(2)}{budgetLimit ? ` / $${budgetLimit.toFixed(0)}` : ''} today
        </span>
        <span className="ud-topbar-divider" />
        <span
          className="ud-topbar-stat"
          style={{ cursor: oauthStatus !== 'healthy' ? 'pointer' : 'default' }}
          onClick={oauthStatus !== 'healthy' ? handleOAuthRefresh : undefined}
          title={oauthStatus !== 'healthy' ? 'Click to refresh token' : 'OAuth token is healthy'}
        >
          <span className="ud-health-dot" style={{ background: oauthColor, marginRight: 4 }} aria-hidden="true" />
          {oauthRefreshing ? 'Refreshing...' : oauthLabel}
        </span>
      </div>
      <div className="ud-topbar-right">
        <NotificationCenter />
        <button
          className="ud-topbar-icon-btn"
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? (
            /* Sun icon */
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            /* Moon icon */
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button className="ud-topbar-icon-btn" onClick={() => onNavigate?.('settings')} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <div className="ud-account-menu" ref={menuRef}>
          <button
            className="ud-account-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={user?.email ?? 'Account menu'}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            {initials}
          </button>
          {menuOpen && (
            <div className="ud-account-dropdown" role="menu" aria-label="Account options">
              {user && (
                <div className="ud-account-info" role="presentation">
                  <div className="ud-account-name">{user.name ?? user.email}</div>
                  {user.name && <div className="ud-account-email">{user.email}</div>}
                  {user.role && <div className="ud-account-role">{user.role}</div>}
                </div>
              )}
              <div className="ud-account-divider" role="separator" />
              <button role="menuitem" className="ud-account-link" onClick={() => { setMenuOpen(false); onNavigate?.('settings'); }}>Settings</button>
              {user?.role === 'super_admin' && (
                <button role="menuitem" className="ud-account-link" onClick={() => { setMenuOpen(false); onNavigate?.('users'); }}>Users</button>
              )}
              <div className="ud-account-divider" role="separator" />
              <button role="menuitem" className="ud-account-link ud-account-logout" onClick={handleLogout}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
