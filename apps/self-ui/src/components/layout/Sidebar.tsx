import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useSelfStore } from '../../stores/self';
import { useAuthStore } from '../../stores/auth';
import { useApprovalsStore } from '../../stores/approvals';
import { useChatStore } from '../../stores/chat';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: Props) {
  const { self } = useSelfStore();
  const { user } = useAuthStore();
  const { pendingCount } = useApprovalsStore();
  const { conversations } = useChatStore();

  const recentConvos = conversations.slice(0, 5);

  return (
    <aside className={clsx('sidebar', isOpen && 'open')}>
      <div className="sidebar-header">
        <NavLink to="/" className="sidebar-brand" onClick={onClose}>
          <span className={clsx('sidebar-brand-dot', self?.status || 'onboarding')} />
          <div>
            <div className="sidebar-brand-name">{self?.name || 'SELF'}</div>
            <div className="sidebar-brand-label">Your AI Agent</div>
          </div>
        </NavLink>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close sidebar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
          </svg>
          Dashboard
        </NavLink>

        <NavLink to="/chat" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Chat
        </NavLink>

        {recentConvos.length > 0 && (
          <div className="sidebar-conversations">
            {recentConvos.map((c) => (
              <NavLink
                key={c.id}
                to={`/chat/${c.id}`}
                className={({ isActive }) => clsx('sidebar-convo-item', isActive && 'active')}
              >
                {c.title || 'New conversation'}
              </NavLink>
            ))}
          </div>
        )}

        <NavLink to="/activity" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Activity
        </NavLink>

        <NavLink to="/approvals" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          Approvals
          {pendingCount > 0 && <span className="nav-link-badge">{pendingCount}</span>}
        </NavLink>

        <NavLink to="/integrations" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          Integrations
        </NavLink>

        <div className="sidebar-section-title">System</div>

        <NavLink to="/budget" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          Budget
        </NavLink>

        <NavLink to="/settings" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">
            {(user?.displayName || user?.email || '?')[0].toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.displayName || 'User'}</div>
            <div className="sidebar-user-email">{user?.email}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
