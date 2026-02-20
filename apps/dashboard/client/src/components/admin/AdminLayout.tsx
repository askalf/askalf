import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { useHubStore } from '../../stores/hub';
import { ADMIN_TAB_SECTIONS, USER_TAB_SECTIONS } from '../../config/forge-tabs';
import type { TabSection } from '../../config/forge-tabs';
import './AdminLayout.css';

const getOtherNavSections = (_role: string) => {
  const sections: Array<{ section: string; items: Array<{ path: string; label: string; icon: string }> }> = [];
  return sections;
};

const getAdminNavItems = (role: string) => [{
  section: 'Admin',
  items: [
    { path: '/settings', label: 'Settings', icon: 'S' },
    ...(role === 'super_admin' ? [{ path: '/users', label: 'Users', icon: 'U' }] : []),
  ],
}];

/** Find which group label contains a given tab key */
function findGroupForTab(sections: TabSection[], tabKey: string): string | null {
  for (const section of sections) {
    if (section.tabs.some((t) => t.key === tabKey)) {
      return section.label;
    }
  }
  return null;
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const activeTab = useHubStore((s) => s.activeTab);
  const setActiveTab = useHubStore((s) => s.setActiveTab);
  const interventions = useHubStore((s) => s.interventions);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const forgeSections = isAdmin ? ADMIN_TAB_SECTIONS : USER_TAB_SECTIONS;
  const otherSections = getOtherNavSections(user?.role || 'user');
  const adminSections = isAdmin ? getAdminNavItems(user?.role || 'user') : [];

  // Track which groups are expanded
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    // Default: expand the group containing the active tab, or first group
    const activeGroup = findGroupForTab(forgeSections, activeTab);
    const initial: Record<string, boolean> = {};
    forgeSections.forEach((s, i) => {
      initial[s.label] = activeGroup ? s.label === activeGroup : i === 0;
    });
    return initial;
  });

  // Auto-expand group when activeTab changes (e.g. from URL navigation)
  useEffect(() => {
    const group = findGroupForTab(forgeSections, activeTab);
    if (group && !expandedGroups[group]) {
      setExpandedGroups((prev) => ({ ...prev, [group]: true }));
    }
  }, [activeTab, forgeSections]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const handleTabClick = (tabKey: string) => {
    setActiveTab(tabKey as Parameters<typeof setActiveTab>[0]);
    navigate(tabKey === 'overview' ? '/command-center' : `/command-center/${tabKey}`);
  };

  // Determine if we're on a command-center page
  const isOnCommandCenter = location.pathname.startsWith('/command-center');

  // For admin users with groups, check if user sections are flat (no sub-groups)
  const showFlatForge = !isAdmin;

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-logo" onClick={() => { handleTabClick('overview'); }}>
            <span className="admin-logo-wordmark">orcastr8r</span>
          </div>
        </div>

        <nav className="admin-nav">
          {/* Forge Section */}
          <div className="admin-nav-section">
            <div className="admin-nav-section-title">Orcastr8r</div>

            {showFlatForge ? (
              /* Regular users: flat list */
              forgeSections[0]?.tabs.map((tab) => (
                <button
                  key={tab.key}
                  className={`admin-nav-item ${isOnCommandCenter && activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => handleTabClick(tab.key)}
                >
                  <span className="admin-nav-label">{tab.label}</span>
                </button>
              ))
            ) : (
              /* Admin: expandable groups */
              forgeSections.map((section) => (
                <div key={section.label} className="admin-nav-group">
                  <button
                    className={`admin-nav-group-header ${expandedGroups[section.label] ? 'expanded' : ''}`}
                    onClick={() => toggleGroup(section.label)}
                  >
                    <svg className="admin-nav-group-chevron" viewBox="0 0 16 16" width="12" height="12">
                      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{section.label}</span>
                  </button>
                  <div className={`admin-nav-group-items ${expandedGroups[section.label] ? 'expanded' : ''}`}>
                    {section.tabs.map((tab) => (
                      <button
                        key={tab.key}
                        className={`admin-nav-sub-item ${isOnCommandCenter && activeTab === tab.key ? 'active' : ''}`}
                        onClick={() => handleTabClick(tab.key)}
                      >
                        <span>{tab.label}</span>
                        {tab.key === 'interventions' && interventions.length > 0 && (
                          <span className="admin-nav-badge">{interventions.length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Other sections (Ask Alf, Self) */}
          {otherSections.map((section) => (
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
