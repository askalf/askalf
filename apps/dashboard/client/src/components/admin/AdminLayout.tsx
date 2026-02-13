import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import './AdminLayout.css';

const ADMIN_NAV_ITEMS = [
  {
    section: 'Overview',
    items: [
      { path: '/admin/analytics', label: 'Analytics', icon: '📊' },
    ],
  },
  {
    section: 'Agent Hub',
    items: [
      { path: '/admin/hub', label: 'Orchestration Hub', icon: '🤖' },
      { path: '/admin/git-space', label: 'Git Space', icon: '🔀' },
    ],
  },
  {
    section: 'Knowledge',
    items: [
      { path: '/admin/memory', label: 'Memory Tiers', icon: '🧠' },
      { path: '/admin/convergence', label: 'Convergence', icon: '🔮' },
    ],
  },
  {
    section: 'Management',
    items: [
      { path: '/admin/users', label: 'Users', icon: '👥' },
      { path: '/admin/backups', label: 'Backups', icon: '💾' },
    ],
  },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-logo" onClick={() => navigate('/app/chat')}>
            <span className="admin-logo-icon">👽</span>
            <span className="admin-logo-text">Admin</span>
          </div>
        </div>

        <nav className="admin-nav">
          {ADMIN_NAV_ITEMS.map((section) => (
            <div key={section.section} className="admin-nav-section">
              <div className="admin-nav-section-title">{section.section}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `admin-nav-item ${isActive ? 'active' : ''}`
                  }
                >
                  <span className="admin-nav-icon">{item.icon}</span>
                  <span className="admin-nav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user">
            <span className="admin-user-avatar">
              {user?.email?.[0]?.toUpperCase() || '?'}
            </span>
            <div className="admin-user-info">
              <span className="admin-user-name">{user?.displayName || user?.email}</span>
              <span className="admin-user-role">{user?.role}</span>
            </div>
          </div>
          <button className="admin-back-btn" onClick={() => navigate('/app/chat')}>
            ← Back to App
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
