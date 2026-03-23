import { useState, useRef, useCallback } from 'react';
import { Gauge, Save, Camera, Upload, Keyboard, X, Loader2, ScanLine } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { updateKms } from '../api';
import Modal from './ui/Modal';
import { showSuccess, showError } from './ui/Toast';
import { format } from 'date-fns';

export default function KmUpdateModal({ vehicle, onClose, onUpdated }) {
  const currentKms = vehicle.currentKms || vehicle.current_kms || 0;
  const [mode, setMode] = useState(null); // null = chooser, 'manual', 'photo'
  const [newKms, setNewKms] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Photo/OCR state
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrCandidates, setOcrCandidates] = useState([]);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Extract numbers that look like odometer readings from OCR text
  const extractKmCandidates = useCallback(
    (text) => {
      // Find all number sequences (with possible commas/periods as thousand separators)
      const matches = text.match(/[\d][,.\d]*[\d]/g) || [];
      const candidates = matches
        .map((m) => {
          // Remove thousand separators, keep as integer
          const cleaned = m.replace(/[,.\s]/g, '');
          return parseInt(cleaned, 10);
        })
        .filter((n) => {
          // Filter to reasonable odometer values (100 to 999999)
          return !isNaN(n) && n >= 100 && n <= 999999;
        })
        // Remove duplicates
        .filter((v, i, a) => a.indexOf(v) === i)
        // Sort by likelihood — closest to but >= current KMs first
        .sort((a, b) => {
          const aDiff = a >= currentKms ? a - currentKms : Infinity;
          const bDiff = b >= currentKms ? b - currentKms : Infinity;
          return aDiff - bDiff;
        });
      return candidates;
    },
    [currentKms]
  );

  const runOcr = useCallback(
    async (file) => {
      setOcrProcessing(true);
      setOcrText('');
      setOcrCandidates([]);
      setError('');

      try {
        const worker = await createWorker('eng');
        const {
          data: { text },
        } = await worker.recognize(file);
        await worker.terminate();

        setOcrText(text);
        const candidates = extractKmCandidates(text);
        setOcrCandidates(candidates);

        if (candidates.length > 0) {
          setNewKms(candidates[0].toString());
        } else {
          setError('Could not find a KM reading. Try entering manually.');
        }
      } catch (err) {
        console.error('OCR error:', err);
        setError('OCR failed. Please enter the reading manually.');
      } finally {
        setOcrProcessing(false);
      }
    },
    [extractKmCandidates]
  );

  const handleFileSelect = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target.result);
      reader.readAsDataURL(file);

      // Auto-run OCR
      runOcr(file);
    },
    [runOcr]
  );

  const clearImage = () => {
    setImagePreview(null);
    setImageFile(null);
    setOcrText('');
    setOcrCandidates([]);
    setNewKms('');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const kmsValue = Number(newKms);
    if (!newKms || isNaN(kmsValue)) {
      setError('Please enter a valid number');
      return;
    }
    if (kmsValue < currentKms) {
      setError(`New reading must be at least ${currentKms.toLocaleString()} km`);
      return;
    }

    setSaving(true);
    try {
      const vehicleId = vehicle._id || vehicle.id;
      await updateKms(vehicleId, {
        kms: kmsValue,
        date: new Date(date).toISOString(),
      });
      showSuccess('Kilometers updated!');
      onUpdated?.();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Mode chooser screen
  if (mode === null) {
    return (
      <Modal open={true} onClose={onClose} title="Update Kilometers" size="sm">
        <div className="space-y-4">
          {/* Vehicle info */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 flex items-center gap-3">
            <div className="p-2 bg-brand-50 dark:bg-brand-950/50 rounded-lg">
              <Gauge className="w-5 h-5 text-brand-700 dark:text-brand-400" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-50 text-sm">
                {vehicle.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Current: {currentKms.toLocaleString()} km
              </p>
            </div>
          </div>

          {/* Mode buttons */}
          <button
            onClick={() => setMode('manual')}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200
                       dark:border-gray-700 hover:border-brand-500 dark:hover:border-brand-500
                       hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all group"
          >
            <div className="p-3 bg-brand-50 dark:bg-brand-950/50 rounded-xl
                            group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 transition-colors">
              <Keyboard className="w-6 h-6 text-brand-700 dark:text-brand-400" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900 dark:text-gray-50">Manual Entry</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Type in the odometer reading
              </p>
            </div>
          </button>

          <button
            onClick={() => setMode('photo')}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200
                       dark:border-gray-700 hover:border-emerald-500 dark:hover:border-emerald-500
                       hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all group"
          >
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl
                            group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50 transition-colors">
              <Camera className="w-6 h-6 text-emerald-700 dark:text-emerald-400" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900 dark:text-gray-50">Photo / OCR</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Take a photo or upload an image of the odometer
              </p>
            </div>
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={mode === 'manual' ? 'Manual KM Entry' : 'OCR KM Reading'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Vehicle info */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-brand-50 dark:bg-brand-950/50 rounded-lg">
            <Gauge className="w-5 h-5 text-brand-700 dark:text-brand-400" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-50 text-sm">
              {vehicle.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Current: {currentKms.toLocaleString()} km
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setMode(null);
              clearImage();
            }}
            className="ml-auto text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            Change mode
          </button>
        </div>

        {/* Photo/OCR mode */}
        {mode === 'photo' && (
          <div className="space-y-4">
            {!imagePreview ? (
              <div className="space-y-3">
                {/* Camera capture */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-3 p-6 rounded-xl
                             border-2 border-dashed border-emerald-300 dark:border-emerald-700
                             hover:border-emerald-500 hover:bg-emerald-50
                             dark:hover:bg-emerald-950/30 transition-all"
                >
                  <Camera className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    Take Photo of Odometer
                  </span>
                </button>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileSelect}
                />

                {/* Upload image */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-3 p-4 rounded-xl
                             border-2 border-dashed border-gray-300 dark:border-gray-600
                             hover:border-brand-500 hover:bg-gray-50
                             dark:hover:bg-gray-800 transition-all"
                >
                  <Upload className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  <span className="font-medium text-gray-600 dark:text-gray-400">
                    Upload Image
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Image preview */}
                <div className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                  <img
                    src={imagePreview}
                    alt="Odometer"
                    className="w-full max-h-48 object-contain bg-gray-100 dark:bg-gray-800"
                  />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full
                               text-white hover:bg-black/80 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>

                  {/* OCR processing overlay */}
                  {ocrProcessing && (
                    <div className="absolute inset-0 bg-black/50 flex flex-col items-center
                                    justify-center gap-3">
                      <div className="relative">
                        <ScanLine className="w-10 h-10 text-emerald-400 animate-pulse" />
                        <Loader2 className="w-6 h-6 text-white animate-spin absolute -top-1 -right-1" />
                      </div>
                      <p className="text-white text-sm font-medium">Reading odometer...</p>
                    </div>
                  )}
                </div>

                {/* OCR candidates */}
                {!ocrProcessing && ocrCandidates.length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      Detected readings — tap to select:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ocrCandidates.map((km) => (
                        <button
                          key={km}
                          type="button"
                          onClick={() => {
                            setNewKms(km.toString());
                            setError('');
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm font-mono font-semibold
                                     transition-all ${
                                       Number(newKms) === km
                                         ? 'bg-brand-700 text-white ring-2 ring-brand-400'
                                         : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                                     }`}
                        >
                          {km.toLocaleString()} km
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* OCR raw text (collapsible) */}
                {!ocrProcessing && ocrText && (
                  <details className="text-xs">
                    <summary className="text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                      Raw OCR text
                    </summary>
                    <pre className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-gray-500
                                    dark:text-gray-400 whitespace-pre-wrap max-h-24 overflow-y-auto">
                      {ocrText}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* KMs input — shown in both modes */}
        <div>
          <label className="label" htmlFor="newKms">
            {mode === 'photo' && ocrCandidates.length > 0
              ? 'Detected Reading (edit if needed)'
              : 'New Odometer Reading (km)'}
          </label>
          <input
            id="newKms"
            type="number"
            className={`input text-lg font-semibold font-mono ${
              error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''
            }`}
            value={newKms}
            onChange={(e) => {
              setNewKms(e.target.value);
              setError('');
            }}
            placeholder={`${currentKms.toLocaleString()} or more`}
            min={currentKms}
            autoFocus={mode === 'manual'}
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>

        {/* Date */}
        <div>
          <label className="label" htmlFor="date">
            Date of Reading
          </label>
          <input
            id="date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || ocrProcessing || !newKms}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Update'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
