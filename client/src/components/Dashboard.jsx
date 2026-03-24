import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Car,
  Wrench,
  AlertTriangle,
  Filter,
  ArrowUpDown,
  ChevronRight,
  X,
  Plus,
} from 'lucide-react';

// Custom AED currency icon to replace DollarSign
const AedIcon = ({ className }) => (
  <span className={`${className} flex items-center justify-center font-bold`} style={{ fontSize: '0.65rem' }}>
    AED
  </span>
);
import { getVehicles, getUpcomingMaintenance } from '../api';
import VehicleCard from './VehicleCard';
import KmUpdateModal from './KmUpdateModal';
import { VehicleCardSkeleton, StatCardSkeleton } from './ui/LoadingSkeleton';
import { showError } from './ui/Toast';
import { format } from 'date-fns';

// Determine if a reminder item is truly overdue (date in the past or KMs exceeded)
function isItemOverdue(item) {
  if (item.nextDueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(item.nextDueDate + 'T00:00:00');
    if (dueDate < today) return true;
  }
  if (item.nextDueKms != null && item.currentKms != null) {
    if (Number(item.nextDueKms) <= Number(item.currentKms)) return true;
  }
  return false;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [kmModalVehicle, setKmModalVehicle] = useState(null);
  const [showReminders, setShowReminders] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  // Lock body scroll when reminders modal is open
  useEffect(() => {
    if (showReminders) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showReminders]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [vehiclesData, upcomingData] = await Promise.allSettled([
        getVehicles(),
        getUpcomingMaintenance(),
      ]);
      if (vehiclesData.status === 'fulfilled') {
        setVehicles(Array.isArray(vehiclesData.value) ? vehiclesData.value :
          (vehiclesData.value?.vehicles || vehiclesData.value?.data || []));
      }
      if (upcomingData.status === 'fulfilled') {
        setUpcoming(Array.isArray(upcomingData.value) ? upcomingData.value :
          (upcomingData.value?.reminders || upcomingData.value?.data || []));
      }
    } catch (err) {
      showError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Compute vehicle statuses based on upcoming maintenance
  const vehicleStatuses = useMemo(() => {
    const statusMap = {};
    if (!Array.isArray(upcoming)) return statusMap;
    upcoming.forEach((item) => {
      const vid = item.vehicleId || item.vehicle_id;
      if (!vid) return;
      const existing = statusMap[vid];
      if (isItemOverdue(item)) {
        statusMap[vid] = 'overdue';
      } else if (existing !== 'overdue') {
        statusMap[vid] = 'due-soon';
      }
    });
    return statusMap;
  }, [upcoming]);

  // Stats computation
  const stats = useMemo(() => {
    const vehicleList = Array.isArray(vehicles) ? vehicles : [];
    const totalVehicles = vehicleList.length;
    const servicesThisMonth = vehicleList.reduce((sum, v) => {
      return sum + Number(v.servicesThisMonth || 0);
    }, 0);
    const totalSpend = vehicleList.reduce((sum, v) => {
      return sum + Math.ceil(Number(v.totalSpend || v.total_spend || 0));
    }, 0);
    const upcomingList = Array.isArray(upcoming) ? upcoming : [];
    const overdueCount = upcomingList.filter(u => isItemOverdue(u)).length;
    const upcomingDue = upcomingList.length;

    return { totalVehicles, servicesThisMonth, totalSpend, upcomingDue, overdueCount };
  }, [vehicles, upcoming]);

  // Filtered and sorted vehicles
  const filteredVehicles = useMemo(() => {
    const list = Array.isArray(vehicles) ? vehicles : [];
    let filtered = list;
    if (filterType !== 'all') {
      filtered = filtered.filter(
        (v) => (v.type || v.vehicleType || '').toLowerCase() === filterType
      );
    }
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'year':
          return (b.year || 0) - (a.year || 0);
        case 'kms':
          return (b.currentKms || b.current_kms || 0) - (a.currentKms || a.current_kms || 0);
        default:
          return 0;
      }
    });
  }, [vehicles, filterType, sortBy]);

  const getVehicleStatus = (vehicle) => {
    const id = vehicle._id || vehicle.id;
    return vehicleStatuses[id] || 'up-to-date';
  };

  const statCards = [
    {
      label: 'Total Vehicles',
      value: stats.totalVehicles,
      icon: Car,
      color: 'text-brand-700 dark:text-brand-400',
      bg: 'bg-brand-50 dark:bg-brand-950/50',
    },
    {
      label: 'Services This Month',
      value: stats.servicesThisMonth,
      icon: Wrench,
      color: 'text-emerald-700 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    },
    {
      label: 'Total Spend (AED)',
      value: stats.totalSpend.toLocaleString(),
      icon: AedIcon,
      color: 'text-violet-700 dark:text-violet-400',
      bg: 'bg-violet-50 dark:bg-violet-950/50',
    },
    {
      label: 'Upcoming Due',
      value: stats.upcomingDue,
      icon: AlertTriangle,
      color: 'text-amber-700 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/50',
      onClick: () => setShowReminders(true),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Overview of your vehicles and maintenance</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {loading
          ? [1, 2, 3, 4].map((i) => <StatCardSkeleton key={i} />)
          : statCards.map((stat) => (
              <div
                key={stat.label}
                className={`stat-card animate-slide-in-up ${stat.onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                onClick={stat.onClick || undefined}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${stat.bg}`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 text-truncate">
                      {stat.label}
                    </p>
                    <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-50">
                      {stat.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
      </div>

      {/* Reminders Section — always visible */}
      {!loading && (() => {
        const list = Array.isArray(upcoming) ? upcoming : [];
        const overdue = list.filter(u => isItemOverdue(u));
        const dueSoon = list.filter(u => !isItemOverdue(u));
        const hasItems = list.length > 0;

        return (
          <div
            onClick={() => setShowReminders(true)}
            className={`card p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 ${
              overdue.length > 0
                ? 'border-l-red-500 bg-red-50 dark:bg-red-950/20'
                : hasItems
                  ? 'border-l-amber-500 bg-amber-50 dark:bg-amber-950/20'
                  : 'border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className={`w-5 h-5 ${
                  overdue.length > 0 ? 'text-red-500' : hasItems ? 'text-amber-500' : 'text-emerald-500'
                }`} />
                <div>
                  <p className="font-semibold text-gray-900 dark:text-gray-50 text-sm">
                    {!hasItems && 'All caught up!'}
                    {overdue.length > 0 && `${overdue.length} overdue`}
                    {overdue.length > 0 && dueSoon.length > 0 && ' \u00b7 '}
                    {dueSoon.length > 0 && `${dueSoon.length} due soon`}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {hasItems
                      ? 'Tap to view all maintenance reminders'
                      : 'No upcoming maintenance reminders. Log a service to set up reminders.'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        );
      })()}

      {/* Filter / Sort controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="select text-sm py-1.5 w-auto"
            >
              <option value="all">All Types</option>
              <option value="car">Cars</option>
              <option value="motorcycle">Motorcycles</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="select text-sm py-1.5 w-auto"
            >
              <option value="name">Name</option>
              <option value="year">Year</option>
              <option value="kms">Kilometers</option>
            </select>
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {filteredVehicles.length} vehicle{filteredVehicles.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Vehicle grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <VehicleCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredVehicles.length === 0 ? (
        <div className="card p-12 text-center">
          <Car className="w-16 h-16 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No vehicles found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {filterType !== 'all'
              ? 'No vehicles match your filter. Try a different type.'
              : 'Add your first vehicle to get started with tracking maintenance.'}
          </p>
          {filterType === 'all' && (
            <Link to="/vehicles/new" className="btn-primary">
              <Plus className="w-4 h-4" />
              Add Your First Vehicle
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {filteredVehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle._id || vehicle.id}
              vehicle={vehicle}
              status={getVehicleStatus(vehicle)}
              onUpdateKms={() => setKmModalVehicle(vehicle)}
            />
          ))}
        </div>
      )}

      {/* Reminders Modal */}
      {showReminders && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
             role="dialog" aria-modal="true" aria-labelledby="reminders-modal-title"
             onKeyDown={(e) => { if (e.key === 'Escape') setShowReminders(false); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
               onClick={() => setShowReminders(false)} aria-hidden="true" />
          <div className="relative w-full max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl
                          animate-scale-in border border-gray-200 dark:border-gray-800 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 id="reminders-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                All Maintenance Reminders
              </h2>
              <button onClick={() => setShowReminders(false)} className="btn-icon -mr-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {upcoming.length === 0 ? (
                <p className="text-center text-gray-500 py-12">No upcoming reminders</p>
              ) : (
                [...upcoming].sort((a, b) => {
                  // Overdue items first, then by date ascending (soonest first)
                  const aOverdue = isItemOverdue(a);
                  const bOverdue = isItemOverdue(b);
                  if (aOverdue && !bOverdue) return -1;
                  if (!aOverdue && bOverdue) return 1;
                  const aDate = a.nextDueDate || '9999-12-31';
                  const bDate = b.nextDueDate || '9999-12-31';
                  return aDate.localeCompare(bDate);
                }).map((item, idx) => {
                  const overdue = isItemOverdue(item);
                  return (
                    <div
                      key={item.id || idx}
                      className={`p-4 rounded-xl border ${
                        overdue
                          ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20'
                          : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20'
                      }`}
                      onClick={() => {
                        setShowReminders(false);
                        navigate(`/vehicles/${item.vehicleId || item.vehicle_id}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setShowReminders(false);
                          navigate(`/vehicles/${item.vehicleId || item.vehicle_id}`);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-gray-900 dark:text-gray-50">
                            {item.categoryName || item.category_name || 'Maintenance'}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                            {item.vehicleName || item.vehicle_name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            Last done: {item.date || '-'}
                            {item.kmsAtService != null && Number(item.kmsAtService) > 0
                              ? ` at ${Number(item.kmsAtService).toLocaleString()} km`
                              : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {item.nextDueDate && (() => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const target = new Date(item.nextDueDate + 'T00:00:00');
                            const daysLeft = Math.round((target - today) / (1000 * 60 * 60 * 24));
                            return (
                              <p className={`text-xs font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {item.nextDueDate}
                                {daysLeft < 0
                                  ? ` (${Math.abs(daysLeft)}d overdue)`
                                  : daysLeft === 0
                                  ? ' (today)'
                                  : ` (${daysLeft}d left)`}
                              </p>
                            );
                          })()}
                          {item.nextDueKms != null && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              Due at {Number(item.nextDueKms).toLocaleString()} km
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* KM Update Modal */}
      {kmModalVehicle && (
        <KmUpdateModal
          vehicle={kmModalVehicle}
          onClose={() => setKmModalVehicle(null)}
          onUpdated={() => {
            setKmModalVehicle(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}
