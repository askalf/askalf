import { useUsersStore } from '../../stores/users';
import { useAuthStore } from '../../stores/auth';
import { formatDate } from '../../hooks/useUsersApi';

export default function UserDetailPanel() {
  const selectedUser = useUsersStore((s) => s.selectedUser);
  const setSelectedUser = useUsersStore((s) => s.setSelectedUser);
  const setEditingUser = useUsersStore((s) => s.setEditingUser);
  const setConfirmAction = useUsersStore((s) => s.setConfirmAction);
  const deleteUser = useUsersStore((s) => s.deleteUser);
  const loading = useUsersStore((s) => s.loading.detail);
  const { user: currentUser } = useAuthStore();

  if (!selectedUser) return null;

  return (
    <div className="users-detail-panel">
      <div className="users-detail-header">
        <h2>User Details</h2>
        <button className="users-detail-close" onClick={() => setSelectedUser(null)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="users-detail-loading">Loading...</div>
      ) : (
        <div className="users-detail-content">
          <div className="users-detail-avatar">
            {(selectedUser.name || selectedUser.email)[0].toUpperCase()}
          </div>
          <h3 className="users-detail-name">{selectedUser.name || 'No name'}</h3>
          <p className="users-detail-email">{selectedUser.email}</p>

          <div className="users-detail-badges">
            <span className={`users-badge users-badge--role-${selectedUser.role}`}>
              {selectedUser.role.replace('_', ' ')}
            </span>
            <span className={`users-badge users-badge--status-${selectedUser.status}`}>
              {selectedUser.status}
            </span>
            {selectedUser.emailVerified && <span className="users-verified">Verified</span>}
          </div>

          <div className="users-detail-section">
            <h4>Usage Statistics</h4>
            <div className="users-detail-stats-grid">
              <div className="users-detail-stat">
                <div className="users-detail-stat-value">{selectedUser.stats.executions}</div>
                <div className="users-detail-stat-label">Executions</div>
              </div>
            </div>
          </div>

          <div className="users-detail-section">
            <h4>Account Info</h4>
            <div className="users-detail-row">
              <span>Created</span>
              <span>{formatDate(selectedUser.createdAt)}</span>
            </div>
            <div className="users-detail-row">
              <span>Last Login</span>
              <span>{formatDate(selectedUser.lastLoginAt)}</span>
            </div>
            {selectedUser.failedLoginAttempts > 0 && (
              <div className="users-detail-row users-detail-row--warning">
                <span>Failed Logins</span>
                <span>{selectedUser.failedLoginAttempts}</span>
              </div>
            )}
            {selectedUser.lockedUntil && (
              <div className="users-detail-row users-detail-row--danger">
                <span>Locked Until</span>
                <span>{formatDate(selectedUser.lockedUntil)}</span>
              </div>
            )}
          </div>

          <div className="users-detail-actions">
            <button className="hub-btn hub-btn--primary" onClick={() => setEditingUser(selectedUser)}>
              Edit User
            </button>
            {selectedUser.id !== currentUser?.id && (
              <button
                className="hub-btn hub-btn--danger"
                onClick={() => setConfirmAction({
                  type: 'delete',
                  userId: selectedUser.id,
                  label: `Delete ${selectedUser.email}? This action cannot be undone.`,
                  onConfirm: () => deleteUser(selectedUser.id),
                })}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
