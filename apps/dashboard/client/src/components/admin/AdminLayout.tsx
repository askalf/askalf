import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import './AdminLayout.css';

const NAV_ITEMS = [
  {
    section: 'Command',
    items: [
      { path: '/command-center', label: 'Command Center', icon: 'C' },
    ],
  },
  {
    section: 'Orchestration',
    items: [
      { path: '/agents', label: 'Agent Fleet', icon: 'A' },
      { path: '/git-space', label: 'Git Space', icon: 'G' },
    ],
  },
  {
    section: 'Knowledge',
    items: [
      { path: '/memory', label: 'Memory Tiers', icon: 'M' },
      { path: '/convergence', label: 'Convergence', icon: 'V' },
    ],
  },
  {
    section: 'Platform',
    items: [
      { path: '/settings', label: 'Settings', icon: 'S' },
    ],
  },
];

const ADMIN_NAV_ITEMS = [
  {
    section: 'Admin',
    items: [
      { path: '/users', label: 'Users', icon: 'U' },
      { path: '/backups', label: 'Backups', icon: 'B' },
    ],
  },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const allSections = isAdmin ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-logo" onClick={() => navigate('/command-center')}>
            <span className="admin-logo-icon">F</span>
            <span className="admin-logo-text">Forge</span>
          </div>
        </div>

        <nav className="admin-nav">
          {allSections.map((section) => (
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
          <button className="admin-back-btn" onClick={() => { logout(); navigate('/login'); }}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
