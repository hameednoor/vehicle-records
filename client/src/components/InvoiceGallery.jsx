import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Filter,
  FileText,
  Image as ImageIcon,
  Calendar,
  Tag,
} from 'lucide-react';
import { getVehicleServiceRecords, searchInvoices } from '../api';
import InvoiceViewer from './InvoiceViewer';
import { Skeleton } from './ui/LoadingSkeleton';
import { showError } from './ui/Toast';
import { format } from 'date-fns';

export default function InvoiceGallery({ vehicleId }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    fetchInvoices();
  }, [vehicleId]);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const data = await getVehicleServiceRecords(vehicleId);
      const records = Array.isArray(data)
        ? data
        : data?.services || data?.records || data?.data || [];

      const allInvoices = [];
      const catSet = new Map();

      records.forEach((record) => {
        const recordInvoices = record.invoices || [];
        const categoryName =
          typeof record.category === 'object'
            ? record.category?.name
            : record.categoryName || 'Uncategorized';
        const categoryId =
          typeof record.category === 'object'
            ? record.category?._id || record.category?.id
            : record.categoryId || record.category_id || 'uncategorized';

        if (!catSet.has(categoryId)) {
          catSet.set(categoryId, categoryName);
        }

        recordInvoices.forEach((inv) => {
          allInvoices.push({
            ...inv,
            serviceDate: record.date || record.serviceDate,
            categoryName,
            categoryId,
            serviceId: record._id || record.id,
          });
        });
      });

      setInvoices(allInvoices);
      setCategories(
        Array.from(catSet.entries()).map(([id, name]) => ({ id, name }))
      );
    } catch {
      showError('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const results = await searchInvoices({
        q: searchQuery,
        vehicleId,
      });
      setSearchResults(
        Array.isArray(results)
          ? results
          : results?.invoices || results?.data || []
      );
    } catch {
      showError('Search failed');
    } finally {
      setSearching(false);
    }
  };

  const displayInvoices = useMemo(() => {
    const list = searchResults || invoices;
    if (filterCategory === 'all') return list;
    return list.filter((inv) => inv.categoryId === filterCategory);
  }, [invoices, searchResults, filterCategory]);

  const handleInvoiceDeleted = (invoiceId) => {
    setInvoices((prev) =>
      prev.filter((inv) => (inv._id || inv.id) !== invoiceId)
    );
    setSelectedIndex(null);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="card overflow-hidden">
            <Skeleton className="aspect-square w-full" />
            <div className="p-2 space-y-1">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-3 w-16 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="card p-12 text-center">
        <FileText className="w-16 h-16 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
          No invoices yet
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Invoices will appear here when you upload them with service records.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            className="input pl-10 pr-20"
            placeholder="Search invoice text (OCR)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 btn-primary text-xs py-1 px-3"
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="select text-sm py-1.5 w-auto"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {searchResults && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {displayInvoices.length} result{displayInvoices.length !== 1 ? 's' : ''} for
            &quot;{searchQuery}&quot;
          </p>
          <button
            onClick={() => {
              setSearchResults(null);
              setSearchQuery('');
            }}
            className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {/* Gallery grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {displayInvoices.map((invoice, index) => {
          const url = invoice.thumbnailUrl || invoice.url || invoice.fileUrl;
          const isImage = (invoice.mimeType || invoice.type || '')
            .toLowerCase()
            .startsWith('image');

          return (
            <div
              key={invoice._id || invoice.id || index}
              onClick={() => setSelectedIndex(index)}
              className="card-hover overflow-hidden cursor-pointer group"
            >
              <div className="aspect-square bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                {url && isImage ? (
                  <img
                    src={url}
                    alt="Invoice"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : url ? (
                  <img
                    src={url}
                    alt="Invoice"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling?.classList.remove('hidden');
                    }}
                  />
                ) : (
                  <FileText className="w-10 h-10 text-gray-400" />
                )}
                {url && !isImage && (
                  <FileText className="w-10 h-10 text-gray-400 hidden" />
                )}
              </div>
              <div className="p-2 space-y-0.5">
                <p className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {invoice.serviceDate
                    ? format(new Date(invoice.serviceDate), 'MMM d, yyyy')
                    : 'N/A'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 flex items-center gap-1 text-truncate">
                  <Tag className="w-3 h-3 flex-shrink-0" />
                  {invoice.categoryName || 'N/A'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Invoice Viewer */}
      {selectedIndex !== null && displayInvoices[selectedIndex] && (
        <InvoiceViewer
          invoice={displayInvoices[selectedIndex]}
          invoices={displayInvoices}
          currentIndex={selectedIndex}
          onClose={() => setSelectedIndex(null)}
          onNavigate={setSelectedIndex}
          onDeleted={handleInvoiceDeleted}
        />
      )}
    </div>
  );
}
