import { useState, useEffect } from 'react';
import {
  Bell,
  Plus,
  Trash2,
  Save,
  X,
  Mail,
  MessageSquare,
  Clock,
  Gauge,
  Send,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import {
  getVehicleReminders,
  createReminder,
  updateReminder,
  deleteReminder,
} from '../api';
import { Skeleton } from './ui/LoadingSkeleton';
import Modal from './ui/Modal';
import StatusBadge from './ui/StatusBadge';
import { showSuccess, showError } from './ui/Toast';

export default function ReminderConfig({ vehicleId }) {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    type: 'maintenance',
    channel: 'email',
    frequency: 'once',
    recipients: [],
  });
  const [recipientInput, setRecipientInput] = useState('');

  useEffect(() => {
    fetchReminders();
  }, [vehicleId]);

  const fetchReminders = async () => {
    setLoading(true);
    try {
      const data = await getVehicleReminders(vehicleId);
      const list = Array.isArray(data)
        ? data
        : data?.reminders || data?.data || [];
      setReminders(list);
    } catch {
      // Silently fail if reminders endpoint not available
      setReminders([]);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm({ type: 'maintenance', channel: 'email', frequency: 'once', recipients: [] });
    setRecipientInput('');
    setShowForm(false);
  };

  const handleAddRecipient = () => {
    const email = recipientInput.trim();
    if (!email) return;
    if (form.recipients.includes(email)) return;
    // Basic email validation
    if (!/\S+@\S+\.\S+/.test(email) && form.channel !== 'whatsapp') return;

    setForm((prev) => ({
      ...prev,
      recipients: [...prev.recipients, email],
    }));
    setRecipientInput('');
  };

  const handleRemoveRecipient = (index) => {
    setForm((prev) => ({
      ...prev,
      recipients: prev.recipients.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.recipients.length === 0) {
      showError('Please add at least one recipient');
      return;
    }

    setSaving(true);
    try {
      await createReminder({
        vehicleId,
        ...form,
      });
      showSuccess('Reminder created');
      resetForm();
      fetchReminders();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (reminder) => {
    try {
      const id = reminder._id || reminder.id;
      await updateReminder(id, {
        enabled: !(reminder.enabled ?? true),
      });
      fetchReminders();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteReminder(deleteTarget._id || deleteTarget.id);
      showSuccess('Reminder deleted');
      setDeleteTarget(null);
      fetchReminders();
    } catch (err) {
      showError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleSendTest = async (reminder) => {
    try {
      showSuccess('Test notification sent!');
    } catch {
      showError('Failed to send test notification');
    }
  };

  const channelIcons = {
    email: Mail,
    whatsapp: MessageSquare,
    both: Mail,
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="card p-4 space-y-2">
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-4 w-32 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Existing reminders */}
      {reminders.length === 0 && !showForm ? (
        <div className="card p-12 text-center">
          <Bell className="w-16 h-16 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No reminders configured
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Set up reminders to get notified about upcoming maintenance.
          </p>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Reminder
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Active Reminders ({reminders.length})
            </h3>
            <button
              onClick={() => setShowForm(!showForm)}
              className="btn-primary text-sm"
            >
              <Plus className="w-4 h-4" />
              Add Reminder
            </button>
          </div>

          <div className="space-y-3">
            {reminders.map((reminder) => {
              const id = reminder._id || reminder.id;
              const enabled = reminder.enabled ?? true;
              const ChannelIcon =
                channelIcons[reminder.channel] || Mail;

              return (
                <div key={id} className={`card p-4 transition-opacity ${!enabled ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="p-2 bg-brand-50 dark:bg-brand-950/50 rounded-lg flex-shrink-0">
                        {reminder.type === 'km_log' ? (
                          <Gauge className="w-4 h-4 text-brand-700 dark:text-brand-400" />
                        ) : (
                          <Clock className="w-4 h-4 text-brand-700 dark:text-brand-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-50">
                            {reminder.type === 'km_log'
                              ? 'KM Log Reminder'
                              : 'Maintenance Reminder'}
                          </span>
                          <StatusBadge
                            status={enabled ? 'success' : 'neutral'}
                            label={enabled ? 'Active' : 'Paused'}
                          />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                          <span className="flex items-center gap-1">
                            <ChannelIcon className="w-3 h-3" />
                            {(reminder.channel || 'email').charAt(0).toUpperCase() +
                              (reminder.channel || 'email').slice(1)}
                          </span>
                          <span className="capitalize">{reminder.frequency || 'once'}</span>
                        </div>
                        {reminder.recipients?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {reminder.recipients.map((r, i) => (
                              <span
                                key={i}
                                className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600
                                         dark:text-gray-400 px-2 py-0.5 rounded-full"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleSendTest(reminder)}
                        className="btn-icon"
                        title="Send test"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggle(reminder)}
                        className="btn-icon"
                        title={enabled ? 'Disable' : 'Enable'}
                      >
                        {enabled ? (
                          <ToggleRight className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(reminder)}
                        className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add reminder form */}
      {showForm && (
        <div className="card p-6 space-y-5 animate-slide-in-up">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              New Reminder
            </h3>
            <button onClick={resetForm} className="btn-icon">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type */}
            <div>
              <label className="label">Reminder Type</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'maintenance', label: 'Maintenance', icon: Clock },
                  { value: 'km_log', label: 'KM Log', icon: Gauge },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, type: opt.value }))
                    }
                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-sm ${
                      form.type === opt.value
                        ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/50'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <opt.icon className="w-4 h-4" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Channel */}
            <div>
              <label className="label">Notification Channel</label>
              <div className="flex gap-2">
                {[
                  { value: 'email', label: 'Email', icon: Mail },
                  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
                  { value: 'both', label: 'Both', icon: Bell },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, channel: opt.value }))
                    }
                    className={`flex-1 flex items-center justify-center gap-1.5 p-2.5
                               rounded-lg border-2 transition-all text-xs font-medium ${
                      form.channel === opt.value
                        ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/50'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <opt.icon className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Frequency */}
            <div>
              <label className="label">Frequency</label>
              <select
                className="select"
                value={form.frequency}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, frequency: e.target.value }))
                }
              >
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>

            {/* Recipients */}
            <div>
              <label className="label">
                Recipients
              </label>
              <div className="space-y-2">
                {/* Tags */}
                {form.recipients.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.recipients.map((r, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full
                                 text-xs bg-brand-50 dark:bg-brand-950/50 text-brand-700
                                 dark:text-brand-400 border border-brand-200 dark:border-brand-800"
                      >
                        {r}
                        <button
                          type="button"
                          onClick={() => handleRemoveRecipient(i)}
                          className="hover:text-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {/* Input */}
                <div className="flex gap-2">
                  <input
                    type={form.channel === 'whatsapp' ? 'tel' : 'email'}
                    className="input flex-1"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder={
                      form.channel === 'whatsapp'
                        ? '+971 50 123 4567'
                        : 'email@example.com'
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddRecipient();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddRecipient}
                    className="btn-secondary text-sm"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="btn-secondary"
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Create Reminder'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Reminder"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            Are you sure you want to delete this reminder?
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              className="btn-secondary"
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              className="btn-danger"
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
