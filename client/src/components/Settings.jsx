import { useState, useEffect, useRef } from 'react';
import {
  Settings as SettingsIcon,
  Globe,
  Clock,
  Mail,
  MessageSquare,
  Gauge,
  Calendar,
  Download,
  Upload,
  Save,
  X,
  Plus,
  Info,
  HelpCircle,
} from 'lucide-react';
import { getSettings, updateSettings, exportData, importData } from '../api';
import { Skeleton } from './ui/LoadingSkeleton';
import { showSuccess, showError, showLoading, dismissToast } from './ui/Toast';

const currencies = [
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'OMR', name: 'Omani Rial' },
];

const timezones = [
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Riyadh',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const importRef = useRef(null);

  const [settings, setSettings] = useState({
    currency: 'AED',
    timezone: 'Asia/Dubai',
    notificationEmails: [],
    whatsappNumber: '',
    reminderBufferKms: 1000,
    reminderBufferDays: 30,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      const s = data?.settings || data || {};
      setSettings((prev) => ({
        ...prev,
        currency: s.currency || prev.currency,
        timezone: s.timezone || prev.timezone,
        notificationEmails: s.notificationEmails || s.notification_emails || prev.notificationEmails,
        whatsappNumber: s.whatsappNumber || s.whatsapp_number || prev.whatsappNumber,
        reminderBufferKms: s.reminderBufferKms ?? s.reminder_buffer_kms ?? prev.reminderBufferKms,
        reminderBufferDays: s.reminderBufferDays ?? s.reminder_buffer_days ?? prev.reminderBufferDays,
      }));
    } catch {
      // Use defaults if settings not yet configured
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddEmail = () => {
    const email = emailInput.trim();
    if (!email || !/\S+@\S+\.\S+/.test(email)) return;
    if (settings.notificationEmails.includes(email)) return;
    handleChange('notificationEmails', [
      ...settings.notificationEmails,
      email,
    ]);
    setEmailInput('');
  };

  const handleRemoveEmail = (index) => {
    handleChange(
      'notificationEmails',
      settings.notificationEmails.filter((_, i) => i !== index)
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(settings);
      showSuccess('Settings saved');
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    const toastId = showLoading('Exporting data...');
    try {
      const blob = await exportData();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vehicle-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      dismissToast(toastId);
      showSuccess('Data exported successfully');
    } catch {
      dismissToast(toastId);
      showError('Export failed');
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = showLoading('Importing data...');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importData(data);
      dismissToast(toastId);
      showSuccess('Data imported successfully');
      fetchSettings();
    } catch (err) {
      dismissToast(toastId);
      showError(err.message || 'Import failed');
    }
    // Reset input
    if (importRef.current) importRef.current.value = '';
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="page-header">
          <Skeleton className="h-8 w-40 rounded" />
          <Skeleton className="h-4 w-60 rounded mt-2" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-6 space-y-4">
            <Skeleton className="h-5 w-32 rounded" />
            <Skeleton className="h-10 w-full rounded" />
            <Skeleton className="h-10 w-full rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-brand-700 dark:text-brand-400" />
          Settings
        </h1>
        <p className="page-subtitle">Configure your app preferences</p>
      </div>

      {/* General Settings */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
          <Globe className="w-4 h-4 text-brand-600 dark:text-brand-400" />
          General
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select
              id="currency"
              className="select"
              value={settings.currency}
              onChange={(e) => handleChange('currency', e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="timezone">
              <Clock className="inline w-3.5 h-3.5 mr-1" />
              Timezone
            </label>
            <select
              id="timezone"
              className="select"
              value={settings.timezone}
              onChange={(e) => handleChange('timezone', e.target.value)}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
          <Mail className="w-4 h-4 text-brand-600 dark:text-brand-400" />
          Notifications
        </h2>

        {/* Email addresses */}
        <div>
          <label className="label">Notification Email Addresses</label>
          {settings.notificationEmails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {settings.notificationEmails.map((email, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                           bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-400
                           border border-brand-200 dark:border-brand-800"
                >
                  {email}
                  <button
                    onClick={() => handleRemoveEmail(i)}
                    className="hover:text-red-500 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="email"
              className="input flex-1"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="email@example.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddEmail();
                }
              }}
            />
            <button onClick={handleAddEmail} className="btn-secondary text-sm">
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>

      </div>

      {/* WhatsApp Configuration */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-brand-600 dark:text-brand-400" />
          WhatsApp Configuration
        </h2>

        <div>
          <label className="label" htmlFor="whatsapp">
            <MessageSquare className="inline w-3.5 h-3.5 mr-1" />
            WhatsApp Number
          </label>
          <input
            id="whatsapp"
            type="tel"
            className="input"
            value={settings.whatsappNumber}
            onChange={(e) => handleChange('whatsappNumber', e.target.value)}
            placeholder="+971 50 123 4567"
          />
        </div>

        <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
          <HelpCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            WhatsApp notifications are powered by <strong>Twilio</strong> (Meta-approved).
            Ensure the number above has joined the Twilio sandbox by sending <strong>"join show-two"</strong> to <strong>+1 415 523 8886</strong> on WhatsApp.
          </p>
        </div>
      </div>

      {/* Reminder Buffer */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-brand-600 dark:text-brand-400" />
          Reminder Buffer
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
          How far in advance to send reminders before maintenance is due.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bufferKms">
              <Gauge className="inline w-3.5 h-3.5 mr-1" />
              KMs Before Due
            </label>
            <input
              id="bufferKms"
              type="number"
              className="input"
              value={settings.reminderBufferKms}
              onChange={(e) =>
                handleChange('reminderBufferKms', Number(e.target.value))
              }
              min="0"
              step="100"
            />
          </div>
          <div>
            <label className="label" htmlFor="bufferDays">
              <Calendar className="inline w-3.5 h-3.5 mr-1" />
              Days Before Due
            </label>
            <input
              id="bufferDays"
              type="number"
              className="input"
              value={settings.reminderBufferDays}
              onChange={(e) =>
                handleChange('reminderBufferDays', Number(e.target.value))
              }
              min="0"
            />
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button onClick={handleSave} className="btn-primary" disabled={saving}>
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Data Management */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
          <Download className="w-4 h-4 text-brand-600 dark:text-brand-400" />
          Data Management
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-50 mb-1">
              Export All Data
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Download all vehicles, services, and settings as a JSON file.
            </p>
            <button onClick={handleExport} className="btn-secondary text-sm w-full">
              <Download className="w-4 h-4" />
              Export JSON
            </button>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-50 mb-1">
              Import Data
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Restore data from a previously exported JSON file.
            </p>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={() => importRef.current?.click()}
              className="btn-secondary text-sm w-full"
            >
              <Upload className="w-4 h-4" />
              Import JSON
            </button>
          </div>
        </div>
      </div>

      {/* App info */}
      <div className="text-center py-4 border-t border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-center gap-1 text-xs text-gray-400">
          <Info className="w-3 h-3" />
          Vehicle Maintenance Tracker v1.0.0
        </div>
      </div>
    </div>
  );
}
