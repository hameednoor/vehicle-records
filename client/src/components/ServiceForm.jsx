import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  X,
  Plus,
  Loader2,
  ScanLine,
  FileText,
  Trash2,
} from 'lucide-react';
import {
  getVehicles,
  getVehicle,
  getCategories,
  createCategory,
  createServiceRecord,
  updateServiceRecord,
  uploadInvoices,
  getExchangeRate,
  getServiceRecord,
  deleteInvoice,
} from '../api';
import DropZone from './ui/DropZone';
import { showSuccess, showError } from './ui/Toast';
import { format } from 'date-fns';

export default function ServiceForm() {
  const { id: vehicleId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const editRecord = location.state?.editRecord || null;
  const isEditing = !!editRecord;

  const [vehicles, setVehicles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [invoiceFiles, setInvoiceFiles] = useState([]);

  // Existing invoices (when editing)
  const [existingInvoices, setExistingInvoices] = useState([]);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState(null);

  const [currency, setCurrency] = useState(
    editRecord?.originalCurrency || editRecord?.currency || 'AED'
  );
  const [exchangeRate, setExchangeRate] = useState(
    editRecord?.exchangeRate || 1
  );
  const [convertedCost, setConvertedCost] = useState('');
  const [loadingRate, setLoadingRate] = useState(false);
  const [analyzingInvoice, setAnalyzingInvoice] = useState(false);
  const [invoiceDetected, setInvoiceDetected] = useState(null);
  const analysisCostRef = useRef(0);

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
    vehicleId:
      vehicleId || editRecord?.vehicleId || editRecord?.vehicle_id || '',
    categoryId: editRecord?.categoryId || editRecord?.category_id || '',
    date: editRecord?.date
      ? editRecord.date.substring(0, 10)
      : format(new Date(), 'yyyy-MM-dd'),
    kms:
      editRecord?.kmsAtService ||
      editRecord?.kms_at_service ||
      editRecord?.kms ||
      '',
    cost: editRecord?.originalCost || editRecord?.cost || '',
    provider: editRecord?.provider || '',
    notes: editRecord?.notes || '',
    nextDueKms: editRecord?.nextDueKms || editRecord?.next_due_kms || '',
    nextDueDays: editRecord?.nextDueDays || editRecord?.next_due_days || '',
  });

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      const fetches = [getVehicles(), getCategories()];

      // If editing, also fetch the full record (which includes invoices)
      if (isEditing) {
        const editId = editRecord._id || editRecord.id;
        fetches.push(getServiceRecord(editId));
      }

      const results = await Promise.allSettled(fetches);

      if (results[0].status === 'fulfilled') {
        const vList = Array.isArray(results[0].value)
          ? results[0].value
          : results[0].value?.vehicles || results[0].value?.data || [];
        setVehicles(vList);
      }

      if (results[1].status === 'fulfilled') {
        const cList = Array.isArray(results[1].value)
          ? results[1].value
          : results[1].value?.categories || results[1].value?.data || [];
        setCategories(cList.filter((c) => !c.archived && !c.is_archived));
      }

      // Load existing invoices from the full record
      if (isEditing && results[2]?.status === 'fulfilled') {
        const fullRecord = results[2].value;
        const invList = fullRecord?.invoices || [];
        setExistingInvoices(invList);
      }

      // If creating (not editing) and we have a vehicle ID, load its current KMs
      if (!isEditing && vehicleId) {
        try {
          const vData = await getVehicle(vehicleId);
          const v = vData.vehicle || vData;
          setForm((prev) => ({
            ...prev,
            kms: String(v.currentKms || v.current_kms || ''),
          }));
        } catch {
          // ignore
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
      .catch(() => setConvertedCost(''))
      .finally(() => setLoadingRate(false));
  }, [currency, form.cost, form.date]);

  const handleCategoryChange = (categoryId) => {
    handleChange('categoryId', categoryId);
    if (!isEditing && categoryId) {
      const cat = categories.find((c) => (c._id || c.id) === categoryId);
      if (cat) {
        if (cat.defaultKms && !form.nextDueKms) {
          const currentKms = Number(form.kms) || 0;
          handleChange(
            'nextDueKms',
            String(currentKms + Number(cat.defaultKms))
          );
        }
        if (cat.defaultDays && !form.nextDueDays) {
          handleChange('nextDueDays', String(cat.defaultDays));
        }
      }
    }
  };

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

  const handleDeleteExistingInvoice = async (inv) => {
    const invId = inv._id || inv.id;
    if (deletingInvoiceId === invId) return;
    if (!window.confirm('Delete this invoice?')) return;

    setDeletingInvoiceId(invId);
    try {
      await deleteInvoice(invId);
      setExistingInvoices((prev) =>
        prev.filter((i) => (i._id || i.id) !== invId)
      );
      showSuccess('Invoice deleted');
    } catch (err) {
      showError(err.message);
    } finally {
      setDeletingInvoiceId(null);
    }
  };

  // Gemini AI analysis for uploaded invoice files (images and PDFs)
  const runOcrOnFiles = async (files) => {
    const analyzableFiles = files.filter(
      (f) =>
        f.type?.startsWith('image/') ||
        f.type === 'application/pdf' ||
        /\.(jpg|jpeg|png|webp|heic|bmp|gif|pdf)$/i.test(f.name)
    );
    if (analyzableFiles.length === 0) return;

    setAnalyzingInvoice(true);
    setInvoiceDetected(null);

    try {
      const { analyzeInvoiceBrowser } = await import('../services/ocr');

      const results = await Promise.all(
        analyzableFiles.map((file) =>
          analyzeInvoiceBrowser(file).catch((err) => {
            console.error('[Gemini] Failed for', file.name, err);
            return null;
          })
        )
      );

      console.log('[Gemini] Results:', results);

      let batchCost = 0;
      let detectedCurrency = null;
      let detectedProvider = null;
      let anyResult = false;

      for (const result of results) {
        if (!result) continue;
        anyResult = true;
        if (result.cost) batchCost += result.cost;
        if (result.currency && !detectedCurrency) {
          const validCode = currencies.find(
            (c) => c.code === result.currency
          );
          if (validCode) detectedCurrency = result.currency;
        }
        if (result.provider && !detectedProvider) {
          detectedProvider = result.provider;
        }
      }

      if (batchCost > 0 || detectedCurrency || detectedProvider) {
        const newTotal = analysisCostRef.current + batchCost;
        analysisCostRef.current = newTotal;

        setInvoiceDetected({
          cost: newTotal,
          currency: detectedCurrency,
          provider: detectedProvider,
        });

        if (newTotal > 0) {
          handleChange('cost', String(newTotal));
        }
        if (detectedCurrency) {
          setCurrency(detectedCurrency);
        }
        if (detectedProvider && !form.provider) {
          handleChange('provider', detectedProvider);
        }

        const parts = [];
        if (detectedCurrency) parts.push(detectedCurrency);
        if (newTotal) parts.push(newTotal.toLocaleString());
        if (detectedProvider) parts.push(`from ${detectedProvider}`);
        if (parts.length > 0) {
          showSuccess(
            `Detected from invoice${analyzableFiles.length > 1 ? 's' : ''}: ${parts.join(' ')}`
          );
        }
      } else if (!anyResult) {
        showError('Could not read invoice. Try a clearer photo.');
      } else {
        showSuccess('Invoice scanned but no cost found. Enter cost manually.');
      }
    } catch (err) {
      console.error('[Gemini] Analysis failed:', err);
      showError('Invoice scanning failed. Enter cost manually.');
    } finally {
      setAnalyzingInvoice(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.vehicleId) {
      showError('Please select a vehicle');
      return;
    }

    if (!form.categoryId) {
      showError('Please select a category');
      return;
    }

    if (!form.date) {
      showError('Please select a service date');
      return;
    }

    if (loadingRate) {
      showError('Please wait for exchange rate to load');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        vehicleId: form.vehicleId,
        categoryId: form.categoryId,
        date: form.date,
        kmsAtService: form.kms ? Number(form.kms) : null,
        cost:
          currency !== 'AED' && convertedCost
            ? Number(convertedCost)
            : form.cost
            ? Number(form.cost)
            : 0,
        originalCost: form.cost ? Number(form.cost) : null,
        originalCurrency: currency,
        exchangeRate: exchangeRate,
        provider: form.provider || null,
        notes: form.notes || null,
        nextDueKms: form.nextDueKms ? Number(form.nextDueKms) : null,
        nextDueDays: form.nextDueDays ? Number(form.nextDueDays) : null,
      };

      let recordId;
      if (isEditing) {
        const editId = editRecord._id || editRecord.id;
        const updated = await updateServiceRecord(editId, payload);
        recordId = updated.id || updated._id || editId;
        showSuccess('Service record updated!');
      } else {
        const record = await createServiceRecord(payload);
        recordId = record.id || record._id;
        showSuccess('Service record created!');
      }

      // Upload new invoices if any
      if (invoiceFiles.length > 0 && recordId) {
        const invoiceFormData = new FormData();
        invoiceFiles.forEach((file) => {
          invoiceFormData.append('invoices', file);
        });
        await uploadInvoices(recordId, invoiceFormData);
      }

      navigate(vehicleId ? `/vehicles/${vehicleId}` : '/');
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loadingData) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="btn-icon">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="page-title">
              {isEditing ? 'Edit Service' : 'Log Service'}
            </h1>
            <p className="page-subtitle">Loading form data...</p>
          </div>
        </div>
        <div className="card p-6 space-y-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton h-10 w-full rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="btn-icon">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">
            {isEditing ? 'Edit Service' : 'Log Service'}
          </h1>
          <p className="page-subtitle">
            {isEditing
              ? 'Update this maintenance entry'
              : 'Record a maintenance or service entry'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-6">
        {/* Vehicle selector */}
        <div>
          <label className="label" htmlFor="vehicle">
            Vehicle *
          </label>
          <select
            id="vehicle"
            className="select"
            value={form.vehicleId}
            onChange={(e) => handleChange('vehicleId', e.target.value)}
            disabled={loadingData || isEditing}
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
            <label className="label mb-0" htmlFor="category">
              Category
            </label>
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
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  (e.preventDefault(), handleAddCategory())
                }
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="btn-primary text-sm"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewCategory(false);
                  setNewCategoryName('');
                }}
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
            onChange={(e) => handleCategoryChange(e.target.value)}
            disabled={loadingData}
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c._id || c.id} value={c._id || c.id}>
                {c.name}
                {c.defaultKms || c.defaultDays
                  ? ` (${
                      c.defaultKms
                        ? c.defaultKms.toLocaleString() + ' km'
                        : ''
                    }${c.defaultKms && c.defaultDays ? ' / ' : ''}${
                      c.defaultDays ? c.defaultDays + ' days' : ''
                    })`
                  : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Date and KMs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="date">
              Service Date
            </label>
            <input
              id="date"
              type="date"
              className="input"
              value={form.date}
              onChange={(e) => handleChange('date', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="kms">
              Kilometers at Service
            </label>
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
            <label className="label" htmlFor="cost">
              Cost
            </label>
            <div className="flex gap-2">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="select w-28 flex-shrink-0"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
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
                {loadingRate ? (
                  'Fetching rate...'
                ) : (
                  <>
                    {'\u2248'} AED {convertedCost}{' '}
                    <span className="text-gray-400">
                      (1 {currency} = {exchangeRate} AED)
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="provider">
              Service Provider
            </label>
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
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            className="input min-h-[80px] resize-y"
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            placeholder="Additional details about the service..."
            rows={3}
          />
        </div>

        {/* Existing invoices (when editing) */}
        {isEditing && existingInvoices.length > 0 && (
          <div>
            <label className="label">
              Existing Invoices ({existingInvoices.length})
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {existingInvoices.map((inv) => {
                const invId = inv._id || inv.id;
                const invUrl =
                  inv.thumbnailUrl || inv.url || inv.filePath;
                const isImage =
                  /\.(jpg|jpeg|png|webp)$/i.test(
                    inv.originalName || ''
                  ) ||
                  (inv.fileType || '').match(/\.(jpg|jpeg|png|webp)$/i);
                const isDeleting = deletingInvoiceId === invId;

                return (
                  <div
                    key={invId}
                    className="relative card overflow-hidden"
                  >
                    <div className="aspect-square flex items-center justify-center bg-gray-50 dark:bg-gray-800">
                      {invUrl && isImage ? (
                        <img
                          src={invUrl}
                          alt={inv.originalName || 'Invoice'}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      ) : (
                        <FileText className="w-10 h-10 text-gray-400" />
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                        {inv.originalName || 'Invoice'}
                      </p>
                    </div>
                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => handleDeleteExistingInvoice(inv)}
                      disabled={isDeleting}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full
                                 bg-red-500 text-white flex items-center justify-center
                                 hover:bg-red-600 active:bg-red-700
                                 shadow-md z-10 border-2 border-white dark:border-gray-900"
                      title="Delete invoice"
                    >
                      {isDeleting ? (
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upload new invoices */}
        <div>
          <label className="label">
            {isEditing ? 'Add More Invoices' : 'Invoices / Receipts'}
          </label>
          <DropZone
            onFilesSelected={(files) => {
              setInvoiceFiles((prev) => [...prev, ...files]);
              runOcrOnFiles(files);
            }}
            files={invoiceFiles}
            onRemove={(index) => {
              setInvoiceFiles((prev) => {
                const next = prev.filter((_, i) => i !== index);
                if (next.length === 0) {
                  analysisCostRef.current = 0;
                  setInvoiceDetected(null);
                }
                return next;
              });
            }}
            maxFiles={10}
            label="Upload invoices or receipts"
          />
          {analyzingInvoice && (
            <div className="flex items-center gap-2 mt-2 text-sm text-brand-600 dark:text-brand-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <ScanLine className="w-4 h-4 animate-pulse" />
              <span>Analyzing invoice with AI...</span>
            </div>
          )}
          {invoiceDetected && !analyzingInvoice && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
              AI detected: {invoiceDetected.currency || ''}{' '}
              {invoiceDetected.cost?.toLocaleString() || '\u2014'}
              {invoiceDetected.provider ? ` — ${invoiceDetected.provider}` : ''}{' '}
              <span className="text-gray-400">(edit above if needed)</span>
            </p>
          )}
        </div>

        {/* Next Due Section */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Next Service Due (Optional)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="nextKms">
                Next Due at KMs
              </label>
              <input
                id="nextKms"
                type="number"
                className="input"
                value={form.nextDueKms}
                onChange={(e) => handleChange('nextDueKms', e.target.value)}
                placeholder="e.g., 62000"
                min="0"
              />
              <p className="text-xs text-gray-500 mt-1">
                Odometer reading when next service is due
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
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || analyzingInvoice || loadingRate}
          >
            <Save className="w-4 h-4" />
            {saving
              ? 'Saving...'
              : analyzingInvoice
              ? 'Analyzing...'
              : loadingRate
              ? 'Loading rate...'
              : isEditing
              ? 'Update Record'
              : 'Save Service Record'}
          </button>
        </div>
      </form>
    </div>
  );
}
