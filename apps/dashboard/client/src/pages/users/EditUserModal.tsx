import { useState } from 'react';
import { useUsersStore } from '../../stores/users';
import { useAuthStore } from '../../stores/auth';
import Modal from '../hub/shared/Modal';
import ConfirmModal from '../hub/shared/ConfirmModal';

export default function EditUserModal() {
  const editingUser = useUsersStore((s) => s.editingUser);
  const setEditingUser = useUsersStore((s) => s.setEditingUser);
  const updateUser = useUsersStore((s) => s.updateUser);
  const plans = useUsersStore((s) => s.plans);
  const saving = useUsersStore((s) => s.loading.save);
  const { user: currentUser } = useAuthStore();

  const [form, setForm] = useState({
    display_name: editingUser?.name || '',
    role: editingUser?.role || 'user',
    status: editingUser?.status || 'active',
    plan: editingUser?.plan || 'free',
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [planChangeConfirm, setPlanChangeConfirm] = useState(false);

  if (!editingUser) return null;

  const handleSave = async () => {
    const payload: Record<string, string> = {};

    if (form.display_name !== (editingUser.name || '')) payload.display_name = form.display_name;
    if (form.status !== editingUser.status) payload.status = form.status;
    if (form.role !== editingUser.role) payload.role = form.role;
    if (form.plan !== (editingUser.plan || 'free')) {
      setPlanChangeConfirm(true);
      return;
    }

    if (Object.keys(payload).length === 0) {
      setEditingUser(null);
      return;
    }

    const ok = await updateUser(editingUser.id, payload);
    if (!ok) setSaveError('Failed to save changes');
  };

  const handlePlanChangeConfirm = async () => {
    const payload: Record<string, string> = {};
    if (form.display_name !== (editingUser.name || '')) payload.display_name = form.display_name;
    if (form.status !== editingUser.status) payload.status = form.status;
    if (form.role !== editingUser.role) payload.role = form.role;
    payload.plan = form.plan;

    setPlanChangeConfirm(false);
    const ok = await updateUser(editingUser.id, payload);
    if (!ok) setSaveError('Failed to save changes');
  };

  return (
    <>
      <Modal title="Edit User" onClose={() => setEditingUser(null)}>
        <div className="users-modal-user-info">
          <div className="users-avatar users-avatar--large">
            {(editingUser.name || editingUser.email)[0].toUpperCase()}
          </div>
          <div>
            <div className="users-cell-name">{editingUser.name || 'No name'}</div>
            <div className="users-cell-email">{editingUser.email}</div>
          </div>
        </div>

        {saveError && <div className="users-modal-error">{saveError}</div>}

        <div className="users-form-group">
          <label>Display Name</label>
          <input
            type="text"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            placeholder="Enter display name"
          />
        </div>

        <div className="users-form-group">
          <label>Role</label>
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'user' | 'admin' | 'super_admin' }))}
            disabled={editingUser.id === currentUser?.id}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
          {editingUser.id === currentUser?.id && (
            <span className="users-form-hint">Cannot change your own role</span>
          )}
        </div>

        <div className="users-form-group">
          <label>Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'active' | 'suspended' | 'deleted' }))}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>

        <div className="users-form-group">
          <label>Tier</label>
          <select
            value={form.plan}
            onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}
            disabled={plans.length === 0}
          >
            {plans.length > 0 ? (
              plans.map((plan) => (
                <option key={plan.id} value={plan.name}>{plan.display_name}</option>
              ))
            ) : (
              <option value={form.plan}>Loading plans...</option>
            )}
          </select>
        </div>

        <div className="users-modal-footer">
          <button className="hub-btn" onClick={() => setEditingUser(null)}>Cancel</button>
          <button className="hub-btn hub-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Modal>

      {planChangeConfirm && (
        <ConfirmModal
          title="Change Tier"
          message="Changing tier will cancel the current subscription and create a new one. Continue?"
          confirmLabel="Change Tier"
          variant="warning"
          onConfirm={handlePlanChangeConfirm}
          onCancel={() => setPlanChangeConfirm(false)}
        />
      )}
    </>
  );
}
