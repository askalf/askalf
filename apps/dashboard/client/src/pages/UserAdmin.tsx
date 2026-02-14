import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import './UserAdmin.css';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin' | 'super_admin';
  status: 'active' | 'suspended' | 'deleted';
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  tenantId: string;
  plan: string;
  planDisplayName: string;
}

interface UserDetails extends User {
  failedLoginAttempts: number;
  lockedUntil: string | null;
  stats: {
    executions: number;
  };
}

interface AdminStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    today: number;
  };
  executions: {
    total: number;
    today: number;
  };
}

export default function UserAdmin() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  // State
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Pagination
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 25;

  // Selected user for detail view
  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Edit modal
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ status: '', display_name: '', role: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Create user modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', display_name: '', password: '', role: 'user' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Auto-clear success messages
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (roleFilter) params.append('role', roleFilter);
      if (statusFilter) params.append('status', statusFilter);
      params.append('limit', limit.toString());
      params.append('offset', (page * limit).toString());

      const response = await fetch(`/api/v1/admin/users?${params}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }

      const data = await response.json();
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    }
  }, [search, roleFilter, statusFilter, page]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/admin/users/stats', {
        credentials: 'include',
      });

      if (!response.ok) return;

      const data = await response.json();
      setStats(data);
    } catch {
      // Stats are optional
    }
  }, []);

  const fetchUserDetails = async (userId: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/v1/admin/users/${userId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user details');
      }

      const data = await response.json();
      setSelectedUser({
        ...data.user,
        stats: data.stats || { executions: 0 },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(), fetchStats()]);
      setLoading(false);
    };
    loadData();
  }, [fetchUsers, fetchStats]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      fetchUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, roleFilter, statusFilter, fetchUsers]);

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setSaveError(null);
    setEditForm({
      status: user.status,
      display_name: user.name || '',
      role: user.role,
    });
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;

    setSaving(true);
    setSaveError(null);
    try {
      // Build payload with only changed fields
      const payload: Record<string, string> = {};

      if (editForm.display_name !== (editingUser.name || '')) {
        payload.display_name = editForm.display_name;
      }
      if (editForm.status !== editingUser.status) {
        payload.status = editForm.status;
      }
      if (editForm.role !== editingUser.role) {
        payload.role = editForm.role;
      }

      if (Object.keys(payload).length === 0) {
        setEditingUser(null);
        return;
      }

      const response = await fetch(`/api/v1/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update user');
      }

      setSuccessMsg(`Updated ${editingUser.email}`);
      setEditingUser(null);
      fetchUsers();
      if (selectedUser?.id === editingUser.id) {
        fetchUserDetails(editingUser.id);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete user');
      }

      setSuccessMsg('User deleted');
      fetchUsers();
      if (selectedUser?.id === userId) {
        setSelectedUser(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const handleCreateUser = async () => {
    if (!createForm.email || !createForm.password) {
      setCreateError('Email and password are required');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(createForm),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create user');
      }

      setSuccessMsg(`Created user ${createForm.email}`);
      setShowCreateModal(false);
      setCreateForm({ email: '', display_name: '', password: '', role: 'user' });
      fetchUsers();
      fetchStats();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const classes: Record<string, string> = {
      active: 'badge-success',
      suspended: 'badge-warning',
      deleted: 'badge-danger',
    };
    return `status-badge ${classes[status] || ''}`;
  };

  const getRoleBadge = (role: string) => {
    const classes: Record<string, string> = {
      admin: 'badge-admin',
      super_admin: 'badge-super',
      user: 'badge-user',
    };
    return `role-badge ${classes[role] || ''}`;
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <span className="loading-spinner"></span>
          <span>Loading users...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
     <div className="admin-main">
      {/* Header */}
      <div className="admin-header">
        <button className="admin-back-btn" onClick={() => navigate('/command-center')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="admin-title-group">
          <h1>User Management</h1>
          <p>Manage users and roles</p>
        </div>
        <div className="admin-header-actions">
          <button className="admin-create-btn" onClick={() => { setShowCreateModal(true); setCreateError(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create User
          </button>
          <button className="admin-refresh-btn" onClick={() => { fetchUsers(); fetchStats(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Success message */}
      {successMsg && (
        <div className="admin-success">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)}>x</button>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="admin-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="admin-stats">
          <div className="ua-stat-card">
            <div className="ua-stat-dot users" />
            <div className="ua-stat-content">
              <div className="ua-stat-value">{stats.users.total}</div>
              <div className="ua-stat-label">Total Users</div>
            </div>
          </div>
          <div className="ua-stat-card">
            <div className="ua-stat-dot active" />
            <div className="ua-stat-content">
              <div className="ua-stat-value">{stats.users.active}</div>
              <div className="ua-stat-label">Active</div>
            </div>
          </div>
          <div className="ua-stat-card">
            <div className="ua-stat-dot today" />
            <div className="ua-stat-content">
              <div className="ua-stat-value">{stats.users.today}</div>
              <div className="ua-stat-label">New Today</div>
            </div>
          </div>
          <div className="ua-stat-card">
            <div className="ua-stat-dot executions" />
            <div className="ua-stat-content">
              <div className="ua-stat-value">{stats.executions?.today || 0}</div>
              <div className="ua-stat-label">Exec Today</div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="admin-filters">
        <div className="filter-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>

      {/* Main Content */}
      <div className="admin-content">
        {/* Users Table */}
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Tier</th>
                <th>Created</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">No users found</td>
                </tr>
              ) : (
                users.map(user => (
                  <tr
                    key={user.id}
                    className={selectedUser?.id === user.id ? 'selected' : ''}
                    onClick={() => fetchUserDetails(user.id)}
                  >
                    <td>
                      <div className="user-cell">
                        <div className="user-avatar">
                          {(user.name || user.email)[0].toUpperCase()}
                        </div>
                        <div className="user-info">
                          <div className="user-name">{user.name || 'No name'}</div>
                          <div className="user-email">
                            {user.email}
                            {user.emailVerified ? (
                              <span className="verified-badge" title="Email verified">Verified</span>
                            ) : (
                              <span className="unverified-badge" title="Email not verified">Unverified</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={getRoleBadge(user.role)}>
                        {user.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <span className={getStatusBadge(user.status)}>
                        {user.status}
                      </span>
                    </td>
                    <td>
                      <span className="plan-badge">{user.planDisplayName}</span>
                    </td>
                    <td className="date-cell">{formatDate(user.createdAt)}</td>
                    <td className="date-cell">{formatDate(user.lastLoginAt)}</td>
                    <td>
                      <div className="action-buttons" onClick={e => e.stopPropagation()}>
                        <button
                          className="action-btn edit"
                          onClick={() => handleEditUser(user)}
                          title="Edit user"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            className="action-btn delete"
                            onClick={() => handleDeleteUser(user.id)}
                            title="Delete user"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="admin-pagination">
            <span className="pagination-info">
              {total > 0
                ? `Showing ${page * limit + 1} - ${Math.min((page + 1) * limit, total)} of ${total}`
                : 'No results'}
            </span>
            <div className="pagination-buttons">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </button>
              <button
                disabled={(page + 1) * limit >= total}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* User Detail Panel */}
        {selectedUser && (
          <div className="admin-detail-panel">
            <div className="detail-header">
              <h2>User Details</h2>
              <button className="detail-close" onClick={() => setSelectedUser(null)}>x</button>
            </div>

            {detailLoading ? (
              <div className="detail-loading">Loading...</div>
            ) : (
              <div className="detail-content">
                <div className="detail-avatar">
                  {(selectedUser.name || selectedUser.email)[0].toUpperCase()}
                </div>
                <h3 className="detail-name">{selectedUser.name || 'No name'}</h3>
                <p className="detail-email">{selectedUser.email}</p>

                <div className="detail-badges">
                  <span className={getRoleBadge(selectedUser.role)}>
                    {selectedUser.role.replace('_', ' ')}
                  </span>
                  <span className={getStatusBadge(selectedUser.status)}>
                    {selectedUser.status}
                  </span>
                  {selectedUser.emailVerified && (
                    <span className="verified-badge">Verified</span>
                  )}
                </div>

                <div className="detail-section">
                  <h4>Usage</h4>
                  <div className="detail-stats">
                    <div className="detail-stat">
                      <div className="detail-stat-value">{selectedUser.stats?.executions || 0}</div>
                      <div className="detail-stat-label">Executions</div>
                    </div>
                  </div>
                </div>

                <div className="detail-section">
                  <h4>Account Info</h4>
                  <div className="detail-row">
                    <span>Created</span>
                    <span>{formatDate(selectedUser.createdAt)}</span>
                  </div>
                  <div className="detail-row">
                    <span>Last Login</span>
                    <span>{formatDate(selectedUser.lastLoginAt)}</span>
                  </div>
                  {selectedUser.failedLoginAttempts > 0 && (
                    <div className="detail-row warning">
                      <span>Failed Logins</span>
                      <span>{selectedUser.failedLoginAttempts}</span>
                    </div>
                  )}
                  {selectedUser.lockedUntil && (
                    <div className="detail-row danger">
                      <span>Locked Until</span>
                      <span>{formatDate(selectedUser.lockedUntil)}</span>
                    </div>
                  )}
                </div>

                <div className="detail-actions">
                  <button
                    className="btn-edit"
                    onClick={() => handleEditUser(selectedUser)}
                  >
                    Edit User
                  </button>
                  {selectedUser.id !== currentUser?.id && (
                    <button
                      className="btn-delete"
                      onClick={() => handleDeleteUser(selectedUser.id)}
                    >
                      Delete User
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingUser && (
        <div className="admin-modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit User</h2>
              <button className="modal-close" onClick={() => setEditingUser(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="modal-user-info">
                <div className="user-avatar large">
                  {(editingUser.name || editingUser.email)[0].toUpperCase()}
                </div>
                <div>
                  <div className="user-name">{editingUser.name || 'No name'}</div>
                  <div className="user-email">{editingUser.email}</div>
                </div>
              </div>

              {saveError && (
                <div className="modal-error">{saveError}</div>
              )}

              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={editForm.display_name}
                  onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="Enter display name"
                />
              </div>

              <div className="form-group">
                <label>Role</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  disabled={editingUser?.id === currentUser?.id}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
                {editingUser?.id === currentUser?.id && (
                  <span className="form-hint">Cannot change your own role</span>
                )}
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="deleted">Deleted</option>
                </select>
              </div>

            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setEditingUser(null)}>
                Cancel
              </button>
              <button className="btn-save" onClick={handleSaveUser} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="admin-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create User</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>x</button>
            </div>
            <div className="modal-body">
              {createError && (
                <div className="modal-error">{createError}</div>
              )}

              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="user@example.com"
                />
              </div>

              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={createForm.display_name}
                  onChange={e => setCreateForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="Enter display name"
                />
              </div>

              <div className="form-group">
                <label>Password *</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Minimum 8 characters"
                />
              </div>

              <div className="form-group">
                <label>Role</label>
                <select
                  value={createForm.role}
                  onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn-save" onClick={handleCreateUser} disabled={creating}>
                {creating ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
     </div>
    </div>
  );
}
