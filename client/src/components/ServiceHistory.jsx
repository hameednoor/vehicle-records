import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  DollarSign,
  Wrench,
  ChevronDown,
  ChevronUp,
  Edit,
  Trash2,
  Gauge,
  User,
  FileText,
  Filter,
  ArrowUpDown,
  ClipboardList,
} from 'lucide-react';
import {
  getVehicleServiceRecords,
  getCategories,
  deleteServiceRecord,
} from '../api';
import Modal from './ui/Modal';
import { Skeleton } from './ui/LoadingSkeleton';
import { showSuccess, showError } from './ui/Toast';
import { format } from 'date-fns';

export default function ServiceHistory({ vehicleId }) {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [sortBy, setSortBy] = useState('date-desc');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [vehicleId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [recordsRes, catsRes] = await Promise.allSettled([
        getVehicleServiceRecords(vehicleId),
        getCategories(),
      ]);

      if (recordsRes.status === 'fulfilled') {
        const data = recordsRes.value;
        setRecords(
          Array.isArray(data)
            ? data
            : data?.services || data?.records || data?.data || []
        );
      }

      if (catsRes.status === 'fulfilled') {
        const data = catsRes.value;
        setCategories(
          Array.isArray(data)
            ? data
            : data?.categories || data?.data || []
        );
      }
    } catch {
      showError('Failed to load service history');
    } finally {
      setLoading(false);
    }
  };

  const getCategoryName = (record) => {
    const catId = record.categoryId || record.category_id || record.category;
    if (typeof catId === 'object' && catId?.name) return catId.name;
    const cat = categories.find((c) => (c._id || c.id) === catId);
    return cat?.name || 'Uncategorized';
  };

  const filteredRecords = useMemo(() => {
    let list = [...records];
    if (filterCategory !== 'all') {
      list = list.filter((r) => {
        const catId = r.categoryId || r.category_id || r.category;
        const id = typeof catId === 'object' ? catId?._id || catId?.id : catId;
        return id === filterCategory;
      });
    }
    list.sort((a, b) => {
      const dateA = new Date(a.date || a.serviceDate);
      const dateB = new Date(b.date || b.serviceDate);
      switch (sortBy) {
        case 'date-asc':
          return dateA - dateB;
        case 'cost-desc':
          return (b.cost || 0) - (a.cost || 0);
        case 'cost-asc':
          return (a.cost || 0) - (b.cost || 0);
        case 'date-desc':
        default:
          return dateB - dateA;
      }
    });
    return list;
  }, [records, filterCategory, sortBy, categories]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteServiceRecord(deleteTarget._id || deleteTarget.id);
      showSuccess('Service record deleted');
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      showError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-4 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-32 rounded" />
              <Skeleton className="h-5 w-20 rounded" />
            </div>
            <Skeleton className="h-4 w-48 rounded" />
            <Skeleton className="h-4 w-36 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="card p-12 text-center">
        <ClipboardList className="w-16 h-16 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
          No service records yet
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Start tracking maintenance by logging your first service.
        </p>
        <button
          onClick={() => navigate(`/vehicles/${vehicleId}/service/new`)}
          className="btn-primary"
        >
          <Wrench className="w-4 h-4" />
          Log First Service
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="select text-sm py-1.5 w-auto"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c._id || c.id} value={c._id || c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="select text-sm py-1.5 w-auto"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="cost-desc">Highest Cost</option>
            <option value="cost-asc">Lowest Cost</option>
          </select>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400 sm:ml-auto">
          {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-800 hidden sm:block" />

        <div className="space-y-3">
          {filteredRecords.map((record) => {
            const id = record._id || record.id;
            const isExpanded = expandedId === id;
            const date = record.date || record.serviceDate;
            const invoices = record.invoices || [];

            return (
              <div key={id} className="relative sm:pl-12">
                {/* Timeline dot */}
                <div className="absolute left-3.5 top-5 w-3 h-3 rounded-full bg-brand-600
                               border-2 border-white dark:border-gray-900 hidden sm:block z-10" />

                <div className="card overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50
                               dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-gray-50 text-sm">
                          {getCategoryName(record)}
                        </span>
                        {record.cost > 0 && (
                          <span className="text-sm font-semibold text-brand-700 dark:text-brand-400">
                            AED {record.cost?.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {(() => { try { return date ? format(new Date(date), 'MMM d, yyyy') : 'N/A'; } catch { return 'N/A'; } })()}
                        </span>
                        {(record.kmsAtService || record.kms_at_service || record.kms) && (
                          <span className="flex items-center gap-1">
                            <Gauge className="w-3 h-3" />
                            {Number(record.kmsAtService || record.kms_at_service || record.kms).toLocaleString()} km
                          </span>
                        )}
                        {record.provider && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {record.provider}
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-100
                                   dark:border-gray-800 pt-3 animate-fade-in">
                      {record.notes && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                            Notes
                          </p>
                          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {record.notes}
                          </p>
                        </div>
                      )}

                      {/* Invoice thumbnails */}
                      {invoices.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                            Invoices ({invoices.length})
                          </p>
                          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                            {invoices.map((inv, i) => (
                              <div
                                key={inv._id || inv.id || i}
                                className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100
                                         dark:bg-gray-800 flex-shrink-0 border border-gray-200
                                         dark:border-gray-700"
                              >
                                {inv.thumbnailUrl || inv.url ? (
                                  <img
                                    src={inv.thumbnailUrl || inv.url}
                                    alt="Invoice"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <FileText className="w-6 h-6 text-gray-400" />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Next due info */}
                      {(record.nextDueKms || record.nextDueDays) && (
                        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                            Next Service Due
                          </p>
                          <div className="flex gap-4 text-sm text-amber-800 dark:text-amber-300">
                            {record.nextDueKms && (
                              <span>At {Number(record.nextDueKms).toLocaleString()} km</span>
                            )}
                            {record.nextDueDate && (
                              <span>By {record.nextDueDate}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() =>
                            navigate(`/vehicles/${vehicleId}/service/new`, {
                              state: { editRecord: record },
                            })
                          }
                          className="btn-ghost text-xs"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteTarget(record)}
                          className="btn-ghost text-xs text-red-600 dark:text-red-400
                                     hover:bg-red-50 dark:hover:bg-red-950/50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Service Record"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            Are you sure you want to delete this service record? This action cannot
            be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
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
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
