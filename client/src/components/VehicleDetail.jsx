import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Car,
  Bike,
  Truck,
  Gauge,
  DollarSign,
  Wrench,
  Calendar,
  Plus,
} from 'lucide-react';
import { getVehicle, getVehicleStats, deleteVehicle, getVehicleKmLogs } from '../api';
import ServiceHistory from './ServiceHistory';
import InvoiceGallery from './InvoiceGallery';
import ReminderConfig from './ReminderConfig';
import KmUpdateModal from './KmUpdateModal';
import StatusBadge from './ui/StatusBadge';
import { DetailSkeleton } from './ui/LoadingSkeleton';
import Modal from './ui/Modal';
import { showSuccess, showError } from './ui/Toast';
import { format } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const typeIcons = { car: Car, motorcycle: Bike, other: Truck };

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'Service History' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'reminders', label: 'Reminders' },
];

export default function VehicleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState(null);
  const [stats, setStats] = useState(null);
  const [kmLogs, setKmLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [deleteStep, setDeleteStep] = useState(0); // 0=hidden, 1/2/3=confirmation steps
  const [deleting, setDeleting] = useState(false);
  const [kmModal, setKmModal] = useState(false);

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  useEffect(() => {
    fetchVehicle();
  }, [id]);

  const fetchVehicle = async () => {
    setLoading(true);
    try {
      const [vehicleData, statsData, kmData] = await Promise.allSettled([
        getVehicle(id),
        getVehicleStats(id),
        getVehicleKmLogs(id),
      ]);

      if (vehicleData.status === 'fulfilled') {
        setVehicle(vehicleData.value?.vehicle || vehicleData.value);
      } else {
        showError('Vehicle not found');
        navigate('/');
        return;
      }

      if (statsData.status === 'fulfilled') {
        setStats(statsData.value?.stats || statsData.value);
      }

      if (kmData.status === 'fulfilled') {
        const logs = kmData.value?.logs || kmData.value?.data || kmData.value || [];
        setKmLogs(Array.isArray(logs) ? logs : []);
      }
    } catch {
      showError('Failed to load vehicle');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteVehicle(id);
      showSuccess('Vehicle deleted successfully');
      navigate('/');
    } catch (err) {
      showError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <button onClick={goBack} className="btn-ghost">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <DetailSkeleton />
      </div>
    );
  }

  if (!vehicle) return null;

  const TypeIcon =
    typeIcons[(vehicle.type || vehicle.vehicleType || 'car').toLowerCase()] || Car;
  const currentKms = vehicle.currentKms || vehicle.current_kms || 0;
  const photoUrl = vehicle.photoUrl || vehicle.photo_url || vehicle.photo;

  // KM chart data
  const kmChartData = kmLogs
    .map((log) => {
      let dateLabel;
      try {
        dateLabel = format(new Date(log.date || log.loggedAt || log.createdAt), 'MMM d');
      } catch {
        dateLabel = 'N/A';
      }
      return { date: dateLabel, kms: log.kms || log.kilometers || log.reading };
    })
    .reverse();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back button */}
      <button onClick={goBack} className="btn-ghost">
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Vehicle header */}
      <div className="card overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Photo */}
          <div className="w-full md:w-64 h-48 md:h-auto bg-gradient-to-br from-brand-50
                         to-brand-100 dark:from-brand-950 dark:to-brand-900 flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={vehicle.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <TypeIcon className="w-20 h-20 text-brand-200 dark:text-brand-800" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-50">
                    {vehicle.name}
                  </h1>
                  <StatusBadge
                    status="info"
                    label={
                      (vehicle.type || vehicle.vehicleType || 'car')
                        .charAt(0)
                        .toUpperCase() +
                      (vehicle.type || vehicle.vehicleType || 'car').slice(1)
                    }
                  />
                </div>
                <p className="text-gray-600 dark:text-gray-400">
                  {[vehicle.year, vehicle.make, vehicle.model]
                    .filter(Boolean)
                    .join(' ')}
                </p>
                <div className="mt-3 space-y-1 text-sm text-gray-500 dark:text-gray-400">
                  {vehicle.plate && (
                    <p>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        Plate:
                      </span>{' '}
                      {vehicle.plate}
                    </p>
                  )}
                  {vehicle.vin && (
                    <p>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        VIN:
                      </span>{' '}
                      {vehicle.vin}
                    </p>
                  )}
                  <p className="flex items-center gap-1">
                    <Gauge className="w-3.5 h-3.5" />
                    <span className="font-semibold text-gray-700 dark:text-gray-300">
                      {currentKms.toLocaleString()} km
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setKmModal(true)}
                  className="btn-secondary text-sm"
                >
                  <Gauge className="w-4 h-4" />
                  Update KMs
                </button>
                <Link
                  to={`/vehicles/${id}/edit`}
                  className="btn-secondary text-sm"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </Link>
                <button
                  onClick={() => setDeleteStep(1)}
                  className="btn-danger text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'tab-active' : 'tab-inactive'}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="animate-fade-in">
        {activeTab === 'overview' && (
          <OverviewTab
            vehicle={vehicle}
            stats={stats}
            kmChartData={kmChartData}
            vehicleId={id}
          />
        )}
        {activeTab === 'history' && <ServiceHistory vehicleId={id} />}
        {activeTab === 'invoices' && <InvoiceGallery vehicleId={id} />}
        {activeTab === 'reminders' && <ReminderConfig vehicleId={id} />}
      </div>

      {/* 3-step delete confirmation modal */}
      <Modal
        open={deleteStep > 0}
        onClose={() => setDeleteStep(0)}
        title={
          deleteStep === 1
            ? 'Delete Vehicle'
            : deleteStep === 2
              ? 'Are You Sure?'
              : 'Final Warning'
        }
        size="sm"
      >
        <div className="space-y-4">
          {deleteStep === 1 && (
            <>
              <p className="text-gray-600 dark:text-gray-400">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-gray-900 dark:text-gray-50">
                  {vehicle.name}
                </span>
                ? This will remove all associated service records, invoices, and reminders.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteStep(0)} className="btn-secondary">
                  Cancel
                </button>
                <button onClick={() => setDeleteStep(2)} className="btn-danger">
                  Yes, Continue
                </button>
              </div>
            </>
          )}
          {deleteStep === 2 && (
            <>
              <p className="text-gray-600 dark:text-gray-400">
                Are you really sure? All data for{' '}
                <span className="font-semibold text-gray-900 dark:text-gray-50">
                  {vehicle.name}
                </span>{' '}
                including service history, invoices, KM logs, and reminders will be
                permanently deleted.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteStep(0)} className="btn-secondary">
                  Cancel
                </button>
                <button onClick={() => setDeleteStep(3)} className="btn-danger">
                  Yes, I'm Sure
                </button>
              </div>
            </>
          )}
          {deleteStep === 3 && (
            <>
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-red-700 dark:text-red-300 font-semibold text-sm">
                  This is your final warning. This action cannot be undone.
                </p>
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                Clicking "Delete Forever" will permanently erase{' '}
                <span className="font-semibold text-gray-900 dark:text-gray-50">
                  {vehicle.name}
                </span>{' '}
                and all its data. There is no recovery.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteStep(0)}
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
                  {deleting ? 'Deleting...' : 'Delete Forever'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* KM update modal */}
      {kmModal && (
        <KmUpdateModal
          vehicle={vehicle}
          onClose={() => setKmModal(false)}
          onUpdated={() => {
            setKmModal(false);
            fetchVehicle();
          }}
        />
      )}
    </div>
  );
}

function OverviewTab({ vehicle, stats, kmChartData, vehicleId }) {
  const totalSpend = stats?.totalSpend || stats?.total_spend || 0;
  const last12Months = stats?.last12Months || stats?.last_12_months || 0;
  const totalServices = stats?.totalServices || stats?.total_services || 0;

  const statCards = [
    {
      label: 'Total Spend (All-time)',
      value: `AED ${Math.ceil(Number(totalSpend)).toLocaleString()}`,
      icon: DollarSign,
      color: 'text-violet-600 dark:text-violet-400',
      bg: 'bg-violet-50 dark:bg-violet-950/50',
    },
    {
      label: 'Last 12 Months',
      value: `AED ${Math.ceil(Number(last12Months)).toLocaleString()}`,
      icon: Calendar,
      color: 'text-brand-600 dark:text-brand-400',
      bg: 'bg-brand-50 dark:bg-brand-950/50',
    },
    {
      label: 'Total Services',
      value: totalServices,
      icon: Wrench,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {stat.label}
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-50">
                  {stat.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* KM Log Chart */}
      {kmChartData.length > 1 && (
        <div className="card p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Kilometer History
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={kmChartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="kms"
                  stroke="#1B4F72"
                  strokeWidth={2}
                  dot={{ fill: '#1B4F72', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Quick action */}
      <div className="flex gap-3">
        <Link
          to={`/vehicles/${vehicleId}/service/new`}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Log New Service
        </Link>
      </div>

      {/* Notes */}
      {vehicle.notes && (
        <div className="card p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Notes
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
            {vehicle.notes}
          </p>
        </div>
      )}
    </div>
  );
}
