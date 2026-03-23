import { useNavigate } from 'react-router-dom';
import { Car, Bike, Truck, Wrench, Gauge, Eye } from 'lucide-react';
import StatusBadge from './ui/StatusBadge';
import { format } from 'date-fns';

const typeIcons = {
  car: Car,
  motorcycle: Bike,
  other: Truck,
};

const statusConfig = {
  'up-to-date': { status: 'success', label: 'Up to Date' },
  'due-soon': { status: 'warning', label: 'Due Soon' },
  overdue: { status: 'danger', label: 'Overdue', pulse: true },
};

export default function VehicleCard({ vehicle, status = 'up-to-date', onUpdateKms }) {
  const navigate = useNavigate();
  const vehicleId = vehicle._id || vehicle.id;
  const TypeIcon = typeIcons[(vehicle.type || vehicle.vehicleType || 'car').toLowerCase()] || Car;
  const statusInfo = statusConfig[status] || statusConfig['up-to-date'];
  const currentKms = vehicle.currentKms || vehicle.current_kms || 0;
  const lastServiceDate = vehicle.lastServiceDate || vehicle.last_service_date;
  const photoUrl = vehicle.photoUrl || vehicle.photo_url || vehicle.photo;

  return (
    <div
      className="card-hover cursor-pointer overflow-hidden group"
      onClick={() => navigate(`/vehicles/${vehicleId}`)}
    >
      {/* Photo / Placeholder */}
      <div className="relative h-40 bg-gradient-to-br from-brand-50 to-brand-100
                      dark:from-brand-950 dark:to-brand-900 overflow-hidden">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={vehicle.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <TypeIcon className="w-16 h-16 text-brand-200 dark:text-brand-800" />
          </div>
        )}
        {/* Status badge overlay */}
        <div className="absolute top-3 right-3">
          <StatusBadge
            status={statusInfo.status}
            label={statusInfo.label}
            pulse={statusInfo.pulse}
          />
        </div>
        {/* Type badge */}
        <div className="absolute top-3 left-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                         font-medium bg-white/90 dark:bg-gray-900/90 text-gray-700
                         dark:text-gray-300 backdrop-blur-sm">
            <TypeIcon className="w-3 h-3" />
            {(vehicle.type || vehicle.vehicleType || 'car').charAt(0).toUpperCase() +
              (vehicle.type || vehicle.vehicleType || 'car').slice(1)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Name and details */}
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-50 text-truncate">
            {vehicle.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-truncate">
            {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
          </p>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
            <Gauge className="w-3.5 h-3.5" />
            <span>{currentKms.toLocaleString()} km</span>
          </div>
          {lastServiceDate && (
            <span className="text-gray-500 dark:text-gray-400 text-xs">
              Last: {format(new Date(lastServiceDate), 'MMM d, yyyy')}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 pt-1 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/vehicles/${vehicleId}/service/new`);
            }}
            className="flex-1 btn-ghost text-xs py-1.5 px-1 gap-1 min-w-0"
          >
            <Wrench className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">Service</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdateKms?.();
            }}
            className="flex-1 btn-ghost text-xs py-1.5 px-1 gap-1 min-w-0"
          >
            <Gauge className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">KMs</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/vehicles/${vehicleId}`);
            }}
            className="flex-1 btn-ghost text-xs py-1.5 px-1 gap-1 min-w-0"
          >
            <Eye className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">View</span>
          </button>
        </div>
      </div>
    </div>
  );
}
