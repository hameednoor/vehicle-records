import { useState, useRef, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Car,
  Tags,
  BarChart3,
  Settings,
  Sun,
  Moon,
  Menu,
  X,
  Plus,
  Wrench,
  Gauge,
  ChevronDown,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { getVehicles } from '../api';
import KmUpdateModal from './KmUpdateModal';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/vehicles/new', label: 'Add Vehicle', icon: Car },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function QuickActions({ onLogService, onUpdateKms }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const actions = [
    { label: 'Add Vehicle', icon: Plus, action: () => navigate('/vehicles/new') },
    { label: 'Log Service', icon: Wrench, action: onLogService },
    { label: 'Update KMs', icon: Gauge, action: onUpdateKms },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="btn-primary text-xs sm:text-sm"
      >
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">Quick Actions</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 card shadow-lg z-50 py-1 animate-scale-in">
          {actions.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.action();
                setOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700
                         dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <item.icon className="w-4 h-4 text-brand-700 dark:text-brand-400" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VehiclePickerModal({ open, onClose, onSelect, title }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      setLoading(true);
      getVehicles()
        .then((data) => setVehicles(Array.isArray(data) ? data : (data?.vehicles || data?.data || [])))
        .catch(() => setVehicles([]))
        .finally(() => setLoading(false));
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
         role="dialog" aria-modal="true" aria-labelledby="vehicle-picker-title"
         onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl
                      animate-scale-in border border-gray-200 dark:border-gray-800 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 id="vehicle-picker-title" className="text-lg font-semibold text-gray-900 dark:text-gray-50">{title}</h2>
          <button onClick={onClose} className="btn-icon -mr-2"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="text-center text-gray-500 py-8">Loading vehicles...</p>
          ) : vehicles.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No vehicles found</p>
          ) : (
            <div className="space-y-1">
              {vehicles.map((v) => (
                <button
                  key={v._id || v.id}
                  onClick={() => onSelect(v)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left
                             hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="p-2 bg-brand-50 dark:bg-brand-950/50 rounded-lg">
                    {(v.type || '').toLowerCase() === 'motorcycle'
                      ? <Gauge className="w-4 h-4 text-brand-700 dark:text-brand-400" />
                      : <Car className="w-4 h-4 text-brand-700 dark:text-brand-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-gray-50 truncate">{v.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {(v.currentKms || 0).toLocaleString()} km
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-fade-in"
          onClick={onClose}
        />
      )}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-full w-64 bg-brand-700 dark:bg-brand-900
          flex flex-col transition-transform duration-300 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center justify-between px-5 h-16 border-b border-white/10">
          <Link to="/" className="flex items-center gap-3" onClick={onClose}>
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              <Car className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-bold text-sm">VMT</span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-white/70 hover:text-white rounded-lg
                       hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                 transition-all duration-150 group
                 ${
                   isActive
                     ? 'bg-white/20 text-white shadow-sm'
                     : 'text-white/70 hover:text-white hover:bg-white/10'
                 }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-white/40 text-xs">Vehicle Maintenance Tracker</p>
          <p className="text-white/30 text-xs mt-0.5">v1.0.0</p>
        </div>
      </aside>
    </>
  );
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Vehicle picker for quick actions
  const [pickerMode, setPickerMode] = useState(null); // 'service' | 'kms'
  const [kmVehicle, setKmVehicle] = useState(null);

  const handleVehicleSelected = (vehicle) => {
    const vid = vehicle._id || vehicle.id;
    if (pickerMode === 'service') {
      setPickerMode(null);
      navigate(`/vehicles/${vid}/service/new`);
    } else if (pickerMode === 'kms') {
      setPickerMode(null);
      setKmVehicle(vehicle);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center justify-between h-16 px-4 sm:px-6
                          bg-white dark:bg-gray-900 border-b border-gray-200
                          dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden btn-icon"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-50
                           hidden sm:block">
              Vehicle Maintenance Tracker
            </h1>
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-50 sm:hidden">
              VMT
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={toggleTheme}
              className="btn-icon"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <Sun className="w-5 h-5 text-yellow-400" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </button>
            <QuickActions
              onLogService={() => setPickerMode('service')}
              onUpdateKms={() => setPickerMode('kms')}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {/* Vehicle picker modal for quick actions */}
      <VehiclePickerModal
        open={!!pickerMode}
        onClose={() => setPickerMode(null)}
        onSelect={handleVehicleSelected}
        title={pickerMode === 'service' ? 'Select Vehicle for Service' : 'Select Vehicle to Update KMs'}
      />

      {/* KM update modal */}
      {kmVehicle && (
        <KmUpdateModal
          vehicle={kmVehicle}
          onClose={() => setKmVehicle(null)}
          onUpdated={() => setKmVehicle(null)}
        />
      )}
    </div>
  );
}
