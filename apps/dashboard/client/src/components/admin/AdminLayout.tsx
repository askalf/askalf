import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import './AdminLayout.css';

const getNavSections = (role: string) => {
  const sections: Array<{ section: string; items: Array<{ path: string; label: string; icon: string }> }> = [];

  // Forge — visible to all roles
  sections.push({
    section: 'Forge',
    items: [{ path: '/command-center', label: 'Command Center', icon: 'F' }],
  });

  // Dev projects — super_admin only
  if (role === 'super_admin') {
    sections.push(
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
    );
  }

  return sections;
};

const getAdminNavItems = (role: string) => [{
  section: 'Admin',
  items: [
    { path: '/settings', label: 'Settings', icon: 'S' },
    ...(role === 'super_admin' ? [{ path: '/users', label: 'Users', icon: 'U' }] : []),
  ],
}];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const navSections = getNavSections(user?.role || 'user');

  const allSections = isAdmin ? [...navSections, ...getAdminNavItems(user?.role || 'user')] : navSections;

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
