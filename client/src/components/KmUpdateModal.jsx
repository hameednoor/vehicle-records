import { useState, useRef, useCallback } from 'react';
import { Gauge, Save, Camera, Upload, Keyboard, X, Loader2, ScanLine, RotateCcw } from 'lucide-react';
// Dynamically import tesseract.js only when needed (large ~15MB library)
const loadTesseract = () => import('tesseract.js').then((m) => m.createWorker);
import { updateKms } from '../api';
import Modal from './ui/Modal';
import { showSuccess, showError } from './ui/Toast';
import { format } from 'date-fns';

/**
 * Preprocess an image for digit-only OCR.
 * Applies: resize → grayscale → contrast stretch → Otsu binarization.
 * Returns a PNG Blob optimized for Tesseract digit recognition.
 */
function preprocessForDigits(imageDataUrl, invert = false) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      // Scale to a good size for OCR (not too big, not too small)
      const maxDim = 2000;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;

      // 1) Convert to grayscale
      for (let i = 0; i < d.length; i += 4) {
        const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = gray;
        d[i + 1] = gray;
        d[i + 2] = gray;
      }

      // 2) Auto-contrast: stretch histogram to full 0-255 range
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < min) min = d[i];
        if (d[i] > max) max = d[i];
      }
      const range = max - min || 1;
      for (let i = 0; i < d.length; i += 4) {
        const stretched = Math.round(((d[i] - min) / range) * 255);
        d[i] = stretched;
        d[i + 1] = stretched;
        d[i + 2] = stretched;
      }

      // 3) Otsu's threshold for binarization
      const histogram = new Array(256).fill(0);
      const totalPixels = canvas.width * canvas.height;
      for (let i = 0; i < d.length; i += 4) histogram[d[i]]++;

      let sum = 0;
      for (let t = 0; t < 256; t++) sum += t * histogram[t];

      let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
      for (let t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB === 0) continue;
        const wF = totalPixels - wB;
        if (wF === 0) break;
        sumB += t * histogram[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) {
          maxVar = between;
          threshold = t;
        }
      }

      // 4) Apply threshold (binarize), optionally invert
      for (let i = 0; i < d.length; i += 4) {
        let val = d[i] > threshold ? 255 : 0;
        if (invert) val = 255 - val;
        d[i] = val;
        d[i + 1] = val;
        d[i + 2] = val;
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };
    img.src = imageDataUrl;
  });
}

/**
 * Extract digit-only candidates from OCR text.
 * Finds numbers that look like odometer readings (3-7 digits).
 */
function extractDigitCandidates(text, currentKms) {
  // Remove everything except digits, spaces, commas, periods, newlines
  const cleaned = text.replace(/[^\d,.\s\n]/g, ' ');

  // Find all numeric sequences (may have thousand separators)
  const matches = cleaned.match(/\d[\d,.\s]*\d|\d/g) || [];

  const seen = new Set();
  const candidates = [];

  for (const m of matches) {
    // Remove separators and spaces, keep raw digits
    const digits = m.replace(/[,.\s]/g, '');
    const num = parseInt(digits, 10);
    if (isNaN(num) || seen.has(num)) continue;
    // Odometer readings: 100 to 999999
    if (num >= 100 && num <= 999999) {
      seen.add(num);
      candidates.push(num);
    }
  }

  // Score and sort: prefer values >= currentKms and closest to it
  candidates.sort((a, b) => {
    const aAbove = a >= currentKms;
    const bAbove = b >= currentKms;
    // Prefer values >= current reading
    if (aAbove && !bAbove) return -1;
    if (!aAbove && bAbove) return 1;
    // Among values above, prefer closest
    if (aAbove && bAbove) return (a - currentKms) - (b - currentKms);
    // Among values below, prefer closest
    return (currentKms - a) - (currentKms - b);
  });

  return candidates;
}

export default function KmUpdateModal({ vehicle, onClose, onUpdated }) {
  const currentKms = vehicle.currentKms || vehicle.current_kms || 0;
  const [mode, setMode] = useState(null); // null = chooser, 'manual', 'photo'
  const [newKms, setNewKms] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Photo/OCR state
  const [imagePreview, setImagePreview] = useState(null);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState('');
  const [ocrCandidates, setOcrCandidates] = useState([]);
  const [ocrRawText, setOcrRawText] = useState('');
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const runOcr = useCallback(
    async (dataUrl) => {
      setOcrProcessing(true);
      setOcrCandidates([]);
      setOcrRawText('');
      setError('');

      const allCandidates = new Set();
      const allRawTexts = [];

      try {
        // Run OCR in multiple passes for robustness:
        // Pass 1: Preprocessed (normal threshold) + digits-only whitelist
        // Pass 2: Preprocessed (inverted) for digital displays with light text on dark
        // Pass 3: Original image with digits-only (catches what preprocessing might miss)
        const passes = [
          { label: 'Processing (pass 1/3)...', blob: await preprocessForDigits(dataUrl, false) },
          { label: 'Processing (pass 2/3)...', blob: await preprocessForDigits(dataUrl, true) },
          { label: 'Processing (pass 3/3)...', blob: dataUrl }, // original
        ];

        for (const pass of passes) {
          setOcrProgress(pass.label);
          try {
            const createWorker = await loadTesseract();
            const worker = await createWorker('eng', 1); // OEM 1 = LSTM only
            await worker.setParameters({
              tessedit_char_whitelist: '0123456789 .,',
            });
            const { data: { text } } = await worker.recognize(pass.blob);
            await worker.terminate();

            if (text && text.trim()) {
              allRawTexts.push(text.trim());
              const candidates = extractDigitCandidates(text, currentKms);
              candidates.forEach((c) => allCandidates.add(c));
            }
          } catch (e) {
            console.warn('OCR pass failed:', e.message);
          }
        }

        const finalCandidates = [...allCandidates];
        // Re-sort merged results
        finalCandidates.sort((a, b) => {
          const aAbove = a >= currentKms;
          const bAbove = b >= currentKms;
          if (aAbove && !bAbove) return -1;
          if (!aAbove && bAbove) return 1;
          if (aAbove && bAbove) return (a - currentKms) - (b - currentKms);
          return (currentKms - a) - (currentKms - b);
        });

        setOcrCandidates(finalCandidates);
        setOcrRawText(allRawTexts.join('\n---\n'));

        if (finalCandidates.length > 0) {
          setNewKms(finalCandidates[0].toString());
        } else {
          setError('Could not detect a reading. Please enter manually.');
        }
      } catch (err) {
        console.error('OCR error:', err);
        setError('OCR failed. Please enter the reading manually.');
      } finally {
        setOcrProcessing(false);
        setOcrProgress('');
      }
    },
    [currentKms]
  );

  const handleFileSelect = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        setImagePreview(dataUrl);
        runOcr(dataUrl);
      };
      reader.readAsDataURL(file);
    },
    [runOcr]
  );

  const clearImage = () => {
    setImagePreview(null);
    setOcrCandidates([]);
    setOcrRawText('');
    setNewKms('');
    setError('');
    setOcrProgress('');
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
                      <p className="text-white text-sm font-medium">{ocrProgress || 'Reading...'}</p>
                    </div>
                  )}
                </div>

                {/* Retry button */}
                {!ocrProcessing && (
                  <button
                    type="button"
                    onClick={() => runOcr(imagePreview)}
                    className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Re-scan image
                  </button>
                )}

                {/* OCR candidates */}
                {!ocrProcessing && ocrCandidates.length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      Detected readings — tap to select:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ocrCandidates.slice(0, 8).map((km) => (
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
                {!ocrProcessing && ocrRawText && (
                  <details className="text-xs">
                    <summary className="text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                      Raw OCR output
                    </summary>
                    <pre className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-gray-500
                                    dark:text-gray-400 whitespace-pre-wrap max-h-24 overflow-y-auto font-mono">
                      {ocrRawText}
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
