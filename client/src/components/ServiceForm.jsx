import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, X, Plus } from 'lucide-react';
import {
  getVehicles,
  getVehicle,
  getCategories,
  createCategory,
  createServiceRecord,
  uploadInvoices,
  getExchangeRate,
} from '../api';
import DropZone from './ui/DropZone';
import { showSuccess, showError } from './ui/Toast';
import { format } from 'date-fns';

export default function ServiceForm() {
  const { id: vehicleId } = useParams();
  const navigate = useNavigate();

  const [vehicles, setVehicles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [invoiceFiles, setInvoiceFiles] = useState([]);

  const [currency, setCurrency] = useState('AED');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [convertedCost, setConvertedCost] = useState('');
  const [loadingRate, setLoadingRate] = useState(false);

  const currencies = [
    { code: 'AED', name: 'AED - UAE Dirham' },
    { code: 'USD', name: 'USD - US Dollar' },
    { code: 'EUR', name: 'EUR - Euro' },
    { code: 'GBP', name: 'GBP - British Pound' },
    { code: 'INR', name: 'INR - Indian Rupee' },
    { code: 'SAR', name: 'SAR - Saudi Riyal' },
    { code: 'KWD', name: 'KWD - Kuwaiti Dinar' },
    { code: 'BHD', name: 'BHD - Bahraini Dinar' },
    { code: 'OMR', name: 'OMR - Omani Rial' },
    { code: 'QAR', name: 'QAR - Qatari Riyal' },
    { code: 'PKR', name: 'PKR - Pakistani Rupee' },
    { code: 'EGP', name: 'EGP - Egyptian Pound' },
    { code: 'JPY', name: 'JPY - Japanese Yen' },
    { code: 'CNY', name: 'CNY - Chinese Yuan' },
    { code: 'CAD', name: 'CAD - Canadian Dollar' },
    { code: 'AUD', name: 'AUD - Australian Dollar' },
    { code: 'CHF', name: 'CHF - Swiss Franc' },
    { code: 'SGD', name: 'SGD - Singapore Dollar' },
    { code: 'MYR', name: 'MYR - Malaysian Ringgit' },
    { code: 'PHP', name: 'PHP - Philippine Peso' },
  ];

  const [form, setForm] = useState({
    vehicleId: vehicleId || '',
    categoryId: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    kms: '',
    cost: '',
    provider: '',
    notes: '',
    nextDueKms: '',
    nextDueDays: '',
  });

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      const [vehiclesRes, categoriesRes] = await Promise.allSettled([
        getVehicles(),
        getCategories(),
      ]);

      if (vehiclesRes.status === 'fulfilled') {
        const vList = Array.isArray(vehiclesRes.value)
          ? vehiclesRes.value
          : vehiclesRes.value?.vehicles || vehiclesRes.value?.data || [];
        setVehicles(vList);
      }

      if (categoriesRes.status === 'fulfilled') {
        const cList = Array.isArray(categoriesRes.value)
          ? categoriesRes.value
          : categoriesRes.value?.categories || categoriesRes.value?.data || [];
        setCategories(cList.filter((c) => !c.archived && !c.is_archived));
      }

      // If we have a vehicle ID, load its current KMs as default
      if (vehicleId) {
        try {
          const vData = await getVehicle(vehicleId);
          const v = vData.vehicle || vData;
          setForm((prev) => ({
            ...prev,
            kms: String(v.currentKms || v.current_kms || ''),
          }));
        } catch {
          // ignore, user can fill in manually
        }
      }
    } catch {
      showError('Failed to load form data');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (currency === 'AED') {
      setExchangeRate(1);
      setConvertedCost(form.cost);
      return;
    }
    if (!form.cost) {
      setConvertedCost('');
      return;
    }
    setLoadingRate(true);
    getExchangeRate(currency, 'AED', form.date)
      .then((data) => {
        setExchangeRate(data.rate);
        setConvertedCost((Number(form.cost) * data.rate).toFixed(2));
      })
      .catch(() => {
        // fallback
        setConvertedCost('');
      })
      .finally(() => setLoadingRate(false));
  }, [currency, form.cost, form.date]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const result = await createCategory({ name: newCategoryName.trim() });
      const newCat = result.category || result;
      setCategories((prev) => [...prev, newCat]);
      setForm((prev) => ({
        ...prev,
        categoryId: newCat._id || newCat.id,
      }));
      setNewCategoryName('');
      setShowNewCategory(false);
      showSuccess('Category created');
    } catch (err) {
      showError(err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.vehicleId) {
      showError('Please select a vehicle');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        vehicleId: form.vehicleId,
        categoryId: form.categoryId,
        date: form.date,
        kmsAtService: form.kms ? Number(form.kms) : null,
        cost: currency !== 'AED' ? Number(convertedCost) : (form.cost ? Number(form.cost) : 0),
        originalCost: form.cost ? Number(form.cost) : null,
        originalCurrency: currency,
        exchangeRate: exchangeRate,
        provider: form.provider || null,
        notes: form.notes || null,
        nextDueKms: form.nextDueKms ? Number(form.nextDueKms) : null,
        nextDueDays: form.nextDueDays ? Number(form.nextDueDays) : null,
      };

      const record = await createServiceRecord(payload);
      const recordId = record.id || record._id;

      // Upload invoices separately if any
      if (invoiceFiles.length > 0 && recordId) {
        const invoiceFormData = new FormData();
        invoiceFiles.forEach((file) => {
          invoiceFormData.append('invoices', file);
        });
        await uploadInvoices(recordId, invoiceFormData);
      }

      showSuccess('Service record created!');
      navigate(vehicleId ? `/vehicles/${vehicleId}` : '/');
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="btn-icon">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">Log Service</h1>
          <p className="page-subtitle">Record a maintenance or service entry</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-6">
        {/* Vehicle selector */}
        <div>
          <label className="label" htmlFor="vehicle">Vehicle *</label>
          <select
            id="vehicle"
            className="select"
            value={form.vehicleId}
            onChange={(e) => handleChange('vehicleId', e.target.value)}
            disabled={loadingData}
          >
            <option value="">Select a vehicle</option>
            {vehicles.map((v) => (
              <option key={v._id || v.id} value={v._id || v.id}>
                {v.name} {v.make ? `(${v.make} ${v.model || ''})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0" htmlFor="category">Category</label>
            <button
              type="button"
              onClick={() => setShowNewCategory(!showNewCategory)}
              className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>

          {showNewCategory && (
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                className="input flex-1"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Category name"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCategory())}
              />
              <button type="button" onClick={handleAddCategory} className="btn-primary text-sm">
                Add
              </button>
              <button
                type="button"
                onClick={() => { setShowNewCategory(false); setNewCategoryName(''); }}
                className="btn-ghost text-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <select
            id="category"
            className="select"
            value={form.categoryId}
            onChange={(e) => handleChange('categoryId', e.target.value)}
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c._id || c.id} value={c._id || c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Date and KMs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="date">Service Date</label>
            <input
              id="date"
              type="date"
              className="input"
              value={form.date}
              onChange={(e) => handleChange('date', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="kms">Kilometers at Service</label>
            <input
              id="kms"
              type="number"
              className="input"
              value={form.kms}
              onChange={(e) => handleChange('kms', e.target.value)}
              placeholder="e.g., 52000"
              min="0"
            />
          </div>
        </div>

        {/* Cost and Currency */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="cost">Cost</label>
            <div className="flex gap-2">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="select w-28 flex-shrink-0"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
                ))}
              </select>
              <input
                id="cost"
                type="number"
                className="input flex-1"
                value={form.cost}
                onChange={(e) => handleChange('cost', e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            {currency !== 'AED' && form.cost && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {loadingRate ? 'Fetching rate...' : (
                  <>{'\u2248'} AED {convertedCost} <span className="text-gray-400">(1 {currency} = {exchangeRate} AED)</span></>
                )}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="provider">Service Provider</label>
            <input
              id="provider"
              type="text"
              className="input"
              value={form.provider}
              onChange={(e) => handleChange('provider', e.target.value)}
              placeholder="e.g., Al Futtaim Service Center"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            className="input min-h-[80px] resize-y"
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            placeholder="Additional details about the service..."
            rows={3}
          />
        </div>

        {/* Invoice upload */}
        <div>
          <label className="label">Invoices / Receipts</label>
          <DropZone
            onFilesSelected={(files) =>
              setInvoiceFiles((prev) => [...prev, ...files])
            }
            files={invoiceFiles}
            onRemove={(index) =>
              setInvoiceFiles((prev) => prev.filter((_, i) => i !== index))
            }
            maxFiles={10}
            label="Upload invoices or receipts"
          />
        </div>

        {/* Next Due Section */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Next Service Due (Optional)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="nextKms">
                Due in Kilometers
              </label>
              <input
                id="nextKms"
                type="number"
                className="input"
                value={form.nextDueKms}
                onChange={(e) => handleChange('nextDueKms', e.target.value)}
                placeholder="e.g., 10000"
                min="0"
              />
              <p className="text-xs text-gray-500 mt-1">
                KMs from now until next service
              </p>
            </div>
            <div>
              <label className="label" htmlFor="nextDays">
                Due in Days
              </label>
              <input
                id="nextDays"
                type="number"
                className="input"
                value={form.nextDueDays}
                onChange={(e) => handleChange('nextDueDays', e.target.value)}
                placeholder="e.g., 180"
                min="0"
              />
              <p className="text-xs text-gray-500 mt-1">
                Days from now until next service
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary"
            disabled={saving}
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Service Record'}
          </button>
        </div>
      </form>
    </div>
  );
}
