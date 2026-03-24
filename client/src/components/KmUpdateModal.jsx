import { useState, useRef, useCallback } from 'react';
import { Gauge, Save, Camera, Upload, Keyboard, X, Loader2, ScanLine, RotateCcw } from 'lucide-react';
import { updateKms, analyzeOdometer } from '../api';
import { compressImage } from '../services/imageCompress';
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
  const [selectedFile, setSelectedFile] = useState(null);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrCandidates, setOcrCandidates] = useState([]);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const runOcr = useCallback(
    async (file) => {
      setOcrProcessing(true);
      setOcrCandidates([]);
      setError('');

      try {
        const result = await analyzeOdometer(file, currentKms);

        const candidates = result.candidates || [];
        if (result.reading && !candidates.includes(result.reading)) {
          candidates.unshift(result.reading);
        }

        // Sort: prefer values >= currentKms and closest to it
        candidates.sort((a, b) => {
          const aAbove = a >= currentKms;
          const bAbove = b >= currentKms;
          if (aAbove && !bAbove) return -1;
          if (!aAbove && bAbove) return 1;
          if (aAbove && bAbove) return (a - currentKms) - (b - currentKms);
          return (currentKms - a) - (currentKms - b);
        });

        setOcrCandidates(candidates);

        if (result.reading) {
          setNewKms(result.reading.toString());
        } else if (candidates.length > 0) {
          setNewKms(candidates[0].toString());
        } else {
          setError('Could not detect a reading. Please enter manually.');
        }
      } catch (err) {
        console.error('Odometer OCR error:', err);
        setError('AI analysis failed. Please enter the reading manually.');
      } finally {
        setOcrProcessing(false);
      }
    },
    [currentKms]
  );

  const handleFileSelect = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Show preview immediately
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreview(ev.target.result);
      };
      reader.readAsDataURL(file);

      // Compress and send to server for AI analysis
      const compressed = await compressImage(file);
      setSelectedFile(compressed);
      runOcr(compressed);
    },
    [runOcr]
  );

  const clearImage = () => {
    setImagePreview(null);
    setSelectedFile(null);
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
              <p className="font-semibold text-gray-900 dark:text-gray-50">Photo / AI</p>
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
      title={mode === 'manual' ? 'Manual KM Entry' : 'AI KM Reading'}
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

                  {/* Processing overlay */}
                  {ocrProcessing && (
                    <div className="absolute inset-0 bg-black/50 flex flex-col items-center
                                    justify-center gap-3">
                      <div className="relative">
                        <ScanLine className="w-10 h-10 text-emerald-400 animate-pulse" />
                        <Loader2 className="w-6 h-6 text-white animate-spin absolute -top-1 -right-1" />
                      </div>
                      <p className="text-white text-sm font-medium">Analyzing with AI...</p>
                    </div>
                  )}
                </div>

                {/* Retry button */}
                {!ocrProcessing && selectedFile && (
                  <button
                    type="button"
                    onClick={() => runOcr(selectedFile)}
                    className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Re-analyze image
                  </button>
                )}

                {/* Candidates */}
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
