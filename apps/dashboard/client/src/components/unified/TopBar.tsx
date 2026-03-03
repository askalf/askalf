import { useState, useEffect, useRef } from 'react';

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
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch current user
  useEffect(() => {
    fetch('/api/v1/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.user) setUser(data.user); })
      .catch(() => {});
  }, []);

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
    window.location.href = '/login';
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
        <span className="ud-health-dot" style={{ background: healthColor }} />
        <span className="ud-topbar-label">{healthLabel}</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">{agentCount} running</span>
        <span className="ud-topbar-divider" />
        <span className={`ud-topbar-stat${budgetLimit && todayCost / budgetLimit > 0.8 ? todayCost / budgetLimit >= 1 ? ' ud-topbar-cost-over' : ' ud-topbar-cost-warn' : ''}`}>
          ${todayCost.toFixed(2)}{budgetLimit ? ` / $${budgetLimit.toFixed(0)}` : ''} today
        </span>
      </div>
      <div className="ud-topbar-right">
        <button className="ud-topbar-icon-btn" onClick={() => onNavigate?.('settings')} title="Settings">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <div className="ud-account-menu" ref={menuRef}>
          <button
            className="ud-account-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            title={user?.email ?? 'Account'}
          >
            {initials}
          </button>
          {menuOpen && (
            <div className="ud-account-dropdown">
              {user && (
                <div className="ud-account-info">
                  <div className="ud-account-name">{user.name ?? user.email}</div>
                  {user.name && <div className="ud-account-email">{user.email}</div>}
                  {user.role && <div className="ud-account-role">{user.role}</div>}
                </div>
              )}
              <div className="ud-account-divider" />
              <button className="ud-account-link" onClick={() => { setMenuOpen(false); onNavigate?.('settings'); }}>Settings</button>
              {user?.role === 'super_admin' && (
                <button className="ud-account-link" onClick={() => { setMenuOpen(false); onNavigate?.('users'); }}>Users</button>
              )}
              <div className="ud-account-divider" />
              <button className="ud-account-link ud-account-logout" onClick={handleLogout}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
