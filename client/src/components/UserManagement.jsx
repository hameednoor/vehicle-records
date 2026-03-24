import { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Key,
  Shield,
  ShieldCheck,
  X,
  Save,
  UserCheck,
  UserX,
} from 'lucide-react';
import { getUsers, createUser, updateUser, resetUserPin, deleteUser } from '../api';
import { useAuth } from '../context/AuthContext';
import { Skeleton } from './ui/LoadingSkeleton';
import { showSuccess, showError } from './ui/Toast';

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { type: 'add' | 'edit' | 'resetPin' | 'delete', user? }
  const [form, setForm] = useState({ name: '', pin: '', role: 'driver' });
  const [saving, setSaving] = useState(false);

  const fetchUsers = async () => {
    try {
      const data = await getUsers();
      setUsers(data.users || []);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openAdd = () => {
    setForm({ name: '', pin: '', role: 'driver' });
    setModal({ type: 'add' });
  };

  const openEdit = (u) => {
    setForm({ name: u.name, pin: '', role: u.role });
    setModal({ type: 'edit', user: u });
  };

  const openResetPin = (u) => {
    setForm({ name: '', pin: '', role: '' });
    setModal({ type: 'resetPin', user: u });
  };

  const openDelete = (u) => {
    setModal({ type: 'delete', user: u });
  };

  const closeModal = () => {
    setModal(null);
    setForm({ name: '', pin: '', role: 'driver' });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (modal.type === 'add') {
        if (!form.name.trim() || !form.pin) {
          showError('Name and PIN are required');
          setSaving(false);
          return;
        }
        await createUser({ name: form.name.trim(), pin: form.pin, role: form.role });
        showSuccess('User created');
      } else if (modal.type === 'edit') {
        await updateUser(modal.user.id, { name: form.name.trim(), role: form.role });
        showSuccess('User updated');
      } else if (modal.type === 'resetPin') {
        if (!form.pin || !/^\d{4,6}$/.test(form.pin)) {
          showError('PIN must be 4-6 digits');
          setSaving(false);
          return;
        }
        await resetUserPin(modal.user.id, form.pin);
        showSuccess('PIN reset successfully');
      } else if (modal.type === 'delete') {
        await deleteUser(modal.user.id);
        showSuccess('User deleted');
      }
      closeModal();
      fetchUsers();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await updateUser(u.id, { isActive: !u.isActive });
      showSuccess(`${u.name} ${u.isActive ? 'disabled' : 'enabled'}`);
      fetchUsers();
    } catch (err) {
      showError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="page-header">
          <Skeleton className="h-8 w-48 rounded" />
          <Skeleton className="h-4 w-64 rounded mt-2" />
        </div>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-700 dark:text-brand-400" />
            User Management
          </h1>
          <p className="page-subtitle">Manage users and their access</p>
        </div>
        <button onClick={openAdd} className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* User list */}
      <div className="space-y-3">
        {users.map((u) => (
          <div
            key={u.id}
            className={`card p-4 flex items-center justify-between gap-4 ${
              !u.isActive ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`p-2 rounded-lg ${
                  u.role === 'admin'
                    ? 'bg-amber-50 dark:bg-amber-950/50'
                    : 'bg-brand-50 dark:bg-brand-950/50'
                }`}
              >
                {u.role === 'admin' ? (
                  <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Shield className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-gray-50 truncate">
                  {u.name}
                  {u.id === currentUser?.id && (
                    <span className="ml-2 text-xs text-brand-600 dark:text-brand-400">(you)</span>
                  )}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {u.role === 'admin' ? 'Admin' : 'Driver'}
                  {u.lastLoginAt && ` \u00B7 Last login: ${new Date(u.lastLoginAt).toLocaleDateString()}`}
                  {!u.isActive && ' \u00B7 Disabled'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => toggleActive(u)}
                className="btn-icon"
                title={u.isActive ? 'Disable user' : 'Enable user'}
              >
                {u.isActive ? (
                  <UserCheck className="w-4 h-4 text-green-600" />
                ) : (
                  <UserX className="w-4 h-4 text-red-500" />
                )}
              </button>
              <button onClick={() => openResetPin(u)} className="btn-icon" title="Reset PIN">
                <Key className="w-4 h-4" />
              </button>
              <button onClick={() => openEdit(u)} className="btn-icon" title="Edit">
                <Edit2 className="w-4 h-4" />
              </button>
              {u.id !== currentUser?.id && (
                <button onClick={() => openDelete(u)} className="btn-icon text-red-500" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={closeModal} />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-scale-in border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                {modal.type === 'add' && 'Add User'}
                {modal.type === 'edit' && 'Edit User'}
                {modal.type === 'resetPin' && `Reset PIN: ${modal.user.name}`}
                {modal.type === 'delete' && 'Delete User'}
              </h2>
              <button onClick={closeModal} className="btn-icon -mr-2">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {modal.type === 'delete' ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Are you sure you want to delete <strong>{modal.user.name}</strong>? This cannot be undone.
                </p>
              ) : modal.type === 'resetPin' ? (
                <div>
                  <label className="label">New PIN (4-6 digits)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={6}
                    className="input text-center text-lg tracking-widest"
                    value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
                    autoFocus
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="label">Name</label>
                    <input
                      type="text"
                      className="input"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      autoFocus
                    />
                  </div>
                  {modal.type === 'add' && (
                    <div>
                      <label className="label">PIN (4-6 digits)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d*"
                        maxLength={6}
                        className="input text-center text-lg tracking-widest"
                        value={form.pin}
                        onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
                      />
                    </div>
                  )}
                  <div>
                    <label className="label">Role</label>
                    <select
                      className="select"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                      <option value="driver">Driver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-800">
              <button onClick={closeModal} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                  modal.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'btn-primary'
                }`}
              >
                {saving ? (
                  'Saving...'
                ) : modal.type === 'delete' ? (
                  'Delete'
                ) : (
                  <>
                    <Save className="w-4 h-4 inline mr-1" />
                    Save
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
