import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import './AdminLayout.css';

const getAdminNavItems = (role: string) => [{
  section: 'Admin',
  items: [
    { path: '/settings', label: 'Settings', icon: 'S' },
    ...(role === 'super_admin' ? [{ path: '/users', label: 'Users', icon: 'U' }] : []),
  ],
}];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const adminSections = isAdmin ? getAdminNavItems(user?.role || 'user') : [];

  // All command-center routes get full-width layout (UnifiedDashboard handles its own tabs)
  if (location.pathname.startsWith('/command-center')) {
    return (
      <div className="admin-layout admin-layout--full">
        <main className="admin-main admin-main--full">
          <Outlet />
        </main>
      </div>
    );
  }

  // Settings / Users get a minimal sidebar
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-logo" onClick={() => navigate('/command-center')}>
            <span className="admin-logo-wordmark">orcastr8r</span>
          </div>
        </div>

        <nav className="admin-nav">
          {/* Admin section */}
          {adminSections.map((section) => (
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
