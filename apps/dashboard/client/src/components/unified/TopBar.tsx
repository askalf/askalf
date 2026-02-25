import { useState, useEffect, useRef } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { SchedulerStatus } from '../../hooks/useHubApi';

interface TopBarProps {
  wsConnected: boolean;
  agentCount: number;
  ticketCount: number;
  todayCost: number;
}

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

export default function TopBar({ wsConnected, agentCount, ticketCount, todayCost }: TopBarProps) {
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hubApi.reports.scheduler().then(setSchedulerStatus).catch(() => {});
    const timer = setInterval(() => {
      hubApi.reports.scheduler().then(setSchedulerStatus).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, []);

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

  const toggleScheduler = async () => {
    if (toggling || !schedulerStatus) return;
    setToggling(true);
    try {
      const action = schedulerStatus.running ? 'stop' : 'start';
      await hubApi.reports.toggleScheduler(action);
      const updated = await hubApi.reports.scheduler();
      setSchedulerStatus(updated);
    } catch {
      // ignore
    }
    setToggling(false);
  };

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
  const initials = user?.name ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="ud-topbar">
      <div className="ud-topbar-left">
        <span className="ud-health-dot" style={{ background: healthColor }} />
        <span className="ud-topbar-label">{healthLabel}</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">{agentCount} running</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">{ticketCount} tickets</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">${todayCost.toFixed(2)} today</span>
      </div>
      <div className="ud-topbar-right">
        <button
          className={`ud-scheduler-toggle ${schedulerStatus?.running ? 'running' : 'stopped'}`}
          onClick={toggleScheduler}
          disabled={toggling}
          title={schedulerStatus?.running ? 'Stop Scheduler' : 'Start Scheduler'}
        >
          {schedulerStatus?.running ? '⏸' : '▶'}
        </button>
        <a className="ud-topbar-icon-btn" href="/settings" title="Settings">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </a>
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
              <a className="ud-account-link" href="/settings">Settings</a>
              {user?.role === 'super_admin' && (
                <a className="ud-account-link" href="/users">Users</a>
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
