import { useUsersStore } from '../../stores/users';

export default function UserFilters() {
  const search = useUsersStore((s) => s.search);
  const setSearch = useUsersStore((s) => s.setSearch);
  const roleFilter = useUsersStore((s) => s.roleFilter);
  const setRoleFilter = useUsersStore((s) => s.setRoleFilter);
  const statusFilter = useUsersStore((s) => s.statusFilter);
  const setStatusFilter = useUsersStore((s) => s.setStatusFilter);
  const planFilter = useUsersStore((s) => s.planFilter);
  const setPlanFilter = useUsersStore((s) => s.setPlanFilter);
  const plans = useUsersStore((s) => s.plans);
  const selectedIds = useUsersStore((s) => s.selectedIds);
  const setConfirmAction = useUsersStore((s) => s.setConfirmAction);
  const bulkUpdateStatus = useUsersStore((s) => s.bulkUpdateStatus);
  const bulkDelete = useUsersStore((s) => s.bulkDelete);
  const fetchUsers = useUsersStore((s) => s.fetchUsers);

  const hasBulk = selectedIds.size > 0;

  return (
    <div className="users-filter-bar">
      <div className="users-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // Debounced fetch handled in shell
          }}
        />
        {search && (
          <button className="users-search-clear" onClick={() => { setSearch(''); fetchUsers(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); fetchUsers(); }}>
        <option value="">All Roles</option>
        <option value="user">User</option>
        <option value="admin">Admin</option>
        <option value="super_admin">Super Admin</option>
      </select>

      <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); fetchUsers(); }}>
        <option value="">All Statuses</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="deleted">Deleted</option>
      </select>

      <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); fetchUsers(); }}>
        <option value="">All Tiers</option>
        {plans.map((plan) => (
          <option key={plan.id} value={plan.name}>{plan.display_name}</option>
        ))}
      </select>

      {hasBulk && (
        <div className="users-bulk-actions">
          <span className="users-bulk-count">{selectedIds.size} selected</span>
          <button
            className="hub-btn hub-btn--success hub-btn--sm"
            onClick={() => setConfirmAction({
              type: 'bulk-activate',
              label: `Activate ${selectedIds.size} selected users?`,
              onConfirm: () => bulkUpdateStatus('active'),
            })}
          >
            Activate
          </button>
          <button
            className="hub-btn hub-btn--sm"
            onClick={() => setConfirmAction({
              type: 'bulk-suspend',
              label: `Suspend ${selectedIds.size} selected users?`,
              onConfirm: () => bulkUpdateStatus('suspended'),
            })}
          >
            Suspend
          </button>
          <button
            className="hub-btn hub-btn--danger hub-btn--sm"
            onClick={() => setConfirmAction({
              type: 'bulk-delete',
              label: `Delete ${selectedIds.size} selected users? This cannot be undone.`,
              onConfirm: bulkDelete,
            })}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
