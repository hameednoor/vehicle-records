import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Car, Bike, Truck, Save, X, ArrowLeft } from 'lucide-react';
import {
  getVehicle,
  createVehicle,
  updateVehicle,
  uploadVehiclePhoto,
} from '../api';
import DropZone from './ui/DropZone';
import { showSuccess, showError } from './ui/Toast';
import { DetailSkeleton } from './ui/LoadingSkeleton';

const vehicleTypes = [
  { value: 'car', label: 'Car', icon: Car },
  { value: 'motorcycle', label: 'Motorcycle', icon: Bike },
  { value: 'other', label: 'Other', icon: Truck },
];

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 50 }, (_, i) => currentYear - i);

export default function VehicleForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [existingPhoto, setExistingPhoto] = useState(null);
  const [form, setForm] = useState({
    name: '',
    make: '',
    model: '',
    year: currentYear,
    type: 'car',
    plate: '',
    vin: '',
    currentKms: '',
    notes: '',
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isEdit) fetchVehicle();
  }, [id]);

  const fetchVehicle = async () => {
    try {
      const data = await getVehicle(id);
      const v = data.vehicle || data;
      setForm({
        name: v.name || '',
        make: v.make || '',
        model: v.model || '',
        year: v.year || currentYear,
        type: v.type || v.vehicleType || 'car',
        plate: v.plate || '',
        vin: v.vin || '',
        currentKms: v.currentKms || v.current_kms || '',
        notes: v.notes || '',
      });
      setExistingPhoto(v.photoUrl || v.photo_url || v.photo || null);
    } catch {
      showError('Failed to load vehicle');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Vehicle name is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        ...form,
        currentKms: form.currentKms ? Number(form.currentKms) : 0,
        year: Number(form.year),
      };

      let vehicleId = id;
      if (isEdit) {
        await updateVehicle(id, payload);
      } else {
        const result = await createVehicle(payload);
        vehicleId = result.vehicle?._id || result.vehicle?.id || result._id || result.id;
      }

      // Upload photo if selected
      if (photoFiles.length > 0 && vehicleId) {
        const formData = new FormData();
        formData.append('photo', photoFiles[0]);
        try {
          await uploadVehiclePhoto(vehicleId, formData);
        } catch {
          showError('Vehicle saved but photo upload failed');
        }
      }

      showSuccess(isEdit ? 'Vehicle updated!' : 'Vehicle created!');
      navigate(vehicleId ? `/vehicles/${vehicleId}` : '/');
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate(-1)} className="btn-ghost">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <DetailSkeleton />
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
            {isEdit ? 'Edit Vehicle' : 'Add New Vehicle'}
          </h1>
          <p className="page-subtitle">
            {isEdit ? 'Update vehicle information' : 'Enter the details of your vehicle'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-6">
        {/* Vehicle Type Selector */}
        <div>
          <label className="label">Vehicle Type</label>
          <div className="grid grid-cols-3 gap-3">
            {vehicleTypes.map((vt) => (
              <button
                key={vt.value}
                type="button"
                onClick={() => handleChange('type', vt.value)}
                className={`
                  flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all
                  ${
                    form.type === vt.value
                      ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-400'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-500 dark:text-gray-400'
                  }
                `}
              >
                <vt.icon className="w-8 h-8" />
                <span className="text-sm font-medium">{vt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="label" htmlFor="name">
            Vehicle Name *
          </label>
          <input
            id="name"
            type="text"
            className={`input ${errors.name ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`}
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="e.g., My Daily Driver"
          />
          {errors.name && (
            <p className="text-xs text-red-500 mt-1">{errors.name}</p>
          )}
        </div>

        {/* Make, Model, Year row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="make">Make</label>
            <input
              id="make"
              type="text"
              className="input"
              value={form.make}
              onChange={(e) => handleChange('make', e.target.value)}
              placeholder="e.g., Toyota"
            />
          </div>
          <div>
            <label className="label" htmlFor="model">Model</label>
            <input
              id="model"
              type="text"
              className="input"
              value={form.model}
              onChange={(e) => handleChange('model', e.target.value)}
              placeholder="e.g., Camry"
            />
          </div>
          <div>
            <label className="label" htmlFor="year">Year</label>
            <select
              id="year"
              className="select"
              value={form.year}
              onChange={(e) => handleChange('year', e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Plate and VIN */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="plate">License Plate</label>
            <input
              id="plate"
              type="text"
              className="input"
              value={form.plate}
              onChange={(e) => handleChange('plate', e.target.value)}
              placeholder="e.g., A 12345"
            />
          </div>
          <div>
            <label className="label" htmlFor="vin">VIN</label>
            <input
              id="vin"
              type="text"
              className="input"
              value={form.vin}
              onChange={(e) => handleChange('vin', e.target.value)}
              placeholder="Vehicle Identification Number"
            />
          </div>
        </div>

        {/* Current KMs */}
        <div>
          <label className="label" htmlFor="kms">Current Kilometers</label>
          <input
            id="kms"
            type="number"
            className="input"
            value={form.currentKms}
            onChange={(e) => handleChange('currentKms', e.target.value)}
            placeholder="e.g., 50000"
            min="0"
          />
        </div>

        {/* Photo upload */}
        <div>
          <label className="label">Vehicle Photo</label>
          {existingPhoto && photoFiles.length === 0 && (
            <div className="mb-3">
              <img
                src={existingPhoto}
                alt="Current vehicle"
                className="w-32 h-32 rounded-xl object-cover border border-gray-200 dark:border-gray-700"
              />
              <p className="text-xs text-gray-500 mt-1">
                Upload a new photo to replace
              </p>
            </div>
          )}
          <DropZone
            onFilesSelected={(files) => setPhotoFiles(files)}
            files={photoFiles}
            onRemove={(index) =>
              setPhotoFiles((prev) => prev.filter((_, i) => i !== index))
            }
            maxFiles={1}
            accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] }}
            label="Upload vehicle photo"
            compact
          />
        </div>

        {/* Notes */}
        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            className="input min-h-[100px] resize-y"
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            placeholder="Any additional notes about this vehicle..."
            rows={3}
          />
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
            {saving ? 'Saving...' : isEdit ? 'Update Vehicle' : 'Create Vehicle'}
          </button>
        </div>
      </form>
    </div>
  );
}
