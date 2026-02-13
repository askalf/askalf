import { useUsersStore } from '../../stores/users';
import { useAuthStore } from '../../stores/auth';
import { formatDate } from '../../hooks/useUsersApi';
import LoadingSkeleton from '../hub/shared/LoadingSkeleton';

export default function UserTable() {
  const users = useUsersStore((s) => s.users);
  const total = useUsersStore((s) => s.total);
  const page = useUsersStore((s) => s.page);
  const limit = useUsersStore((s) => s.limit);
  const setPage = useUsersStore((s) => s.setPage);
  const selectedUser = useUsersStore((s) => s.selectedUser);
  const fetchUserDetails = useUsersStore((s) => s.fetchUserDetails);
  const setEditingUser = useUsersStore((s) => s.setEditingUser);
  const setConfirmAction = useUsersStore((s) => s.setConfirmAction);
  const deleteUser = useUsersStore((s) => s.deleteUser);
  const selectedIds = useUsersStore((s) => s.selectedIds);
  const toggleSelection = useUsersStore((s) => s.toggleSelection);
  const toggleSelectAll = useUsersStore((s) => s.toggleSelectAll);
  const sortColumn = useUsersStore((s) => s.sortColumn);
  const sortDirection = useUsersStore((s) => s.sortDirection);
  const toggleSort = useUsersStore((s) => s.toggleSort);
  const loading = useUsersStore((s) => s.loading.users);
  const { user: currentUser } = useAuthStore();

  if (loading && users.length === 0) return <LoadingSkeleton type="table" rows={10} />;

  const allSelected = users.length > 0 && users.every((u) => selectedIds.has(u.id));

  // Client-side sort within current page
  const sorted = [...users].sort((a, b) => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    const valA = a[sortColumn] || '';
    const valB = b[sortColumn] || '';
    if (typeof valA === 'string') return valA.localeCompare(String(valB)) * dir;
    return 0;
  });

  const SortIcon = ({ col }: { col: string }) => (
    <span className="users-sort-icon">
      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
    </span>
  );

  return (
    <div className="users-table-container">
      <table className="users-table">
        <thead>
          <tr>
            <th className="users-th-check">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            </th>
            <th className="users-th-sortable" onClick={() => toggleSort('name')}>
              User <SortIcon col="name" />
            </th>
            <th className="users-th-sortable" onClick={() => toggleSort('role')}>
              Role <SortIcon col="role" />
            </th>
            <th className="users-th-sortable" onClick={() => toggleSort('status')}>
              Status <SortIcon col="status" />
            </th>
            <th className="users-th-sortable" onClick={() => toggleSort('plan')}>
              Tier <SortIcon col="plan" />
            </th>
            <th className="users-th-sortable" onClick={() => toggleSort('createdAt')}>
              Created <SortIcon col="createdAt" />
            </th>
            <th className="users-th-sortable" onClick={() => toggleSort('lastLoginAt')}>
              Last Login <SortIcon col="lastLoginAt" />
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={8} className="users-empty">No users found</td>
            </tr>
          ) : (
            sorted.map((user) => (
              <tr
                key={user.id}
                className={`${selectedUser?.id === user.id ? 'selected' : ''} ${selectedIds.has(user.id) ? 'checked' : ''}`}
                onClick={() => fetchUserDetails(user.id)}
              >
                <td className="users-td-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(user.id)}
                    onChange={() => toggleSelection(user.id)}
                  />
                </td>
                <td>
                  <div className="users-cell">
                    <div className="users-avatar">
                      {(user.name || user.email)[0].toUpperCase()}
                    </div>
                    <div className="users-cell-info">
                      <div className="users-cell-name">{user.name || 'No name'}</div>
                      <div className="users-cell-email">
                        {user.email}
                        {user.emailVerified ? (
                          <span className="users-verified">Verified</span>
                        ) : (
                          <span className="users-unverified">Unverified</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`users-badge users-badge--role-${user.role}`}>
                    {user.role.replace('_', ' ')}
                  </span>
                </td>
                <td>
                  <span className={`users-badge users-badge--status-${user.status}`}>
                    {user.status}
                  </span>
                </td>
                <td><span className="users-badge users-badge--plan">{user.planDisplayName}</span></td>
                <td className="users-muted">{formatDate(user.createdAt)}</td>
                <td className="users-muted">{formatDate(user.lastLoginAt)}</td>
                <td>
                  <div className="users-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="users-action-btn users-action-btn--edit"
                      title="Edit user"
                      onClick={() => setEditingUser(user)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    {user.id !== currentUser?.id && (
                      <button
                        className="users-action-btn users-action-btn--delete"
                        title="Delete user"
                        onClick={() => setConfirmAction({
                          type: 'delete',
                          userId: user.id,
                          label: `Delete ${user.email}? This action cannot be undone.`,
                          onConfirm: () => deleteUser(user.id),
                        })}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
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

      <div className="users-pagination">
        <span className="users-pagination-info">
          {total > 0
            ? `${page * limit + 1}-${Math.min((page + 1) * limit, total)} of ${total}`
            : 'No results'}
        </span>
        <div className="users-pagination-btns">
          <button className="hub-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="hub-btn" disabled={(page + 1) * limit >= total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
