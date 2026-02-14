import { useState } from 'react';
import { useUsersStore } from '../../stores/users';
import Modal from '../hub/shared/Modal';

export default function CreateUserModal() {
  const showCreateModal = useUsersStore((s) => s.showCreateModal);
  const setShowCreateModal = useUsersStore((s) => s.setShowCreateModal);
  const createUser = useUsersStore((s) => s.createUser);
  const creating = useUsersStore((s) => s.loading.create);

  const [form, setForm] = useState({
    email: '',
    display_name: '',
    password: '',
    role: 'user',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!showCreateModal) return null;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.email) {
      errs.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Invalid email format';
    }
    if (!form.password) {
      errs.password = 'Password is required';
    } else if (form.password.length < 8) {
      errs.password = 'Password must be at least 8 characters';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    const ok = await createUser(form);
    if (ok) {
      setForm({ email: '', display_name: '', password: '', role: 'user' });
      setErrors({});
    }
  };

  const close = () => {
    setShowCreateModal(false);
    setErrors({});
  };

  return (
    <Modal title="Create User" onClose={close}>
      <div className="users-form-group">
        <label>Email *</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="user@example.com"
          className={errors.email ? 'users-input-error' : ''}
        />
        {errors.email && <span className="users-field-error">{errors.email}</span>}
      </div>

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
        <label>Password *</label>
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder="Minimum 8 characters"
          className={errors.password ? 'users-input-error' : ''}
        />
        {errors.password && <span className="users-field-error">{errors.password}</span>}
        {form.password && form.password.length >= 8 && (
          <div className="users-password-strength">
            <div className={`users-strength-bar ${form.password.length >= 12 ? 'strong' : form.password.length >= 10 ? 'medium' : 'weak'}`} />
            <span>{form.password.length >= 12 ? 'Strong' : form.password.length >= 10 ? 'Medium' : 'Weak'}</span>
          </div>
        )}
      </div>

      <div className="users-form-group">
        <label>Role</label>
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="users-modal-footer">
        <button className="hub-btn" onClick={close}>Cancel</button>
        <button className="hub-btn hub-btn--primary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'Create User'}
        </button>
      </div>
    </Modal>
  );
}
