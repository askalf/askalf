import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import './AdminLayout.css';

const NAV_ITEMS = [
  {
    section: 'Ask Alf',
    items: [
      { path: '/ask-alf', label: 'Chat', icon: 'A' },
      { path: '/ask-alf/integrations', label: 'Integrations', icon: 'I' },
    ],
  },
  {
    section: 'Self',
    items: [
      { path: '/self', label: 'Chat', icon: 'S' },
      { path: '/integrations', label: 'Integrations', icon: 'I' },
    ],
  },
  {
    section: 'Forge',
    items: [
      { path: '/command-center', label: 'Command Center', icon: 'F' },
    ],
  },
  {
    section: 'Search Engine',
    items: [
      { path: 'https://amnesia.tax', label: 'Amnesia', icon: 'A', external: true },
    ],
  },
  {
    section: 'Just Push',
    items: [
      { path: '/push/', label: 'My Repos', icon: 'R', external: true },
    ],
  },
];

const ADMIN_NAV_ITEMS = [
  {
    section: 'Admin',
    items: [
      { path: '/settings', label: 'Settings', icon: 'S' },
      { path: '/users', label: 'Users', icon: 'U' },
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
          <div className="admin-logo" onClick={() => navigate('/self')}>
            <span className="admin-logo-icon">S</span>
            <span className="admin-logo-text">Sprayberry Labs</span>
          </div>
        </div>

        <nav className="admin-nav">
          {allSections.map((section) => (
            <div key={section.section} className="admin-nav-section">
              <div className="admin-nav-section-title">{section.section}</div>
              {section.items.map((item) =>
                'external' in item && item.external ? (
                  <a
                    key={item.path}
                    href={item.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-nav-item"
                  >
                    <span className="admin-nav-icon">{item.icon}</span>
                    <span className="admin-nav-label">{item.label}</span>
                  </a>
                ) : (
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
                )
              )}
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
