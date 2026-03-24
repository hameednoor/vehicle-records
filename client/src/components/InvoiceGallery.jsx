import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Filter,
  FileText,
  Image as ImageIcon,
  Calendar,
  Tag,
  Trash2,
} from 'lucide-react';
import {
  getVehicleServiceRecords,
  searchInvoices,
  deleteInvoice,
} from '../api';
import InvoiceViewer from './InvoiceViewer';
import { Skeleton } from './ui/LoadingSkeleton';
import { showSuccess, showError } from './ui/Toast';
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
  const [deletingId, setDeletingId] = useState(null);

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

      // Invoices are now embedded in each service record — no extra API calls needed
      for (const record of records) {
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

        const recordInvoices = record.invoices || [];
        recordInvoices.forEach((inv) => {
          allInvoices.push({
            ...inv,
            serviceDate: record.date || record.serviceDate,
            categoryName,
            categoryId,
            serviceId: record._id || record.id,
          });
        });
      }

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
      const resultList = Array.isArray(results)
        ? results
        : results?.invoices || results?.data || [];
      setSearchResults(
        resultList.map((inv) => ({ ...inv, url: inv.url || inv.filePath }))
      );
    } catch {
      showError('Search failed');
    } finally {
      setSearching(false);
    }
  };

  const displayInvoices = useMemo(() => {
    const list = searchResults || invoices;
    if (filterCategory === 'all') {
      return list;
    }
    return list.filter((inv) => inv.categoryId === filterCategory);
  }, [invoices, searchResults, filterCategory]);

  const handleDeleteFromGallery = async (event, invoice) => {
    event.stopPropagation();
    event.preventDefault();

    const invoiceId = invoice._id || invoice.id;
    if (deletingId === invoiceId) {
      return;
    }

    const confirmed = window.confirm('Delete this invoice?');
    if (!confirmed) {
      return;
    }

    setDeletingId(invoiceId);
    try {
      await deleteInvoice(invoiceId);
      showSuccess('Invoice deleted');

      // Remove from both lists
      setInvoices((prev) =>
        prev.filter((inv) => (inv._id || inv.id) !== invoiceId)
      );
      if (searchResults) {
        setSearchResults((prev) =>
          prev.filter((inv) => (inv._id || inv.id) !== invoiceId)
        );
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleInvoiceDeletedFromViewer = (invoiceId) => {
    setInvoices((prev) =>
      prev.filter((inv) => (inv._id || inv.id) !== invoiceId)
    );
    if (searchResults) {
      setSearchResults((prev) =>
        prev.filter((inv) => (inv._id || inv.id) !== invoiceId)
      );
    }
    setSelectedIndex(null);
  };

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
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

      {/* Search results info bar */}
      {searchResults && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {displayInvoices.length} result
            {displayInvoices.length !== 1 ? 's' : ''} for &quot;{searchQuery}
            &quot;
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
          const invoiceId = invoice._id || invoice.id;
          const url = invoiceId
            ? `/api/invoices/${invoiceId}/download`
            : null;
          const fileType = invoice.fileType || invoice.type || '';
          const isImage =
            (invoice.mimeType || '').toLowerCase().startsWith('image') ||
            /^\.(jpg|jpeg|png|webp|gif|heic)$/i.test(fileType);
          const isDeleting = deletingId === invoiceId;

          return (
            <div
              key={invoiceId || index}
              className="card-hover overflow-hidden cursor-pointer relative"
            >
              {/* Main clickable area — opens viewer */}
              <div onClick={() => setSelectedIndex(index)}>
                <div className="aspect-square bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                  {url ? (
                    <img
                      src={url}
                      alt="Invoice"
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      onError={(e) => {
                        e.target.replaceWith(
                          Object.assign(document.createElement('div'), {
                            className:
                              'w-full h-full flex items-center justify-center',
                            innerHTML:
                              '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
                          })
                        );
                      }}
                    />
                  ) : (
                    <FileText className="w-10 h-10 text-gray-400" />
                  )}
                </div>
                <div className="p-2 space-y-0.5">
                  <p className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {(() => {
                      try {
                        return invoice.serviceDate
                          ? format(new Date(invoice.serviceDate), 'MMM d, yyyy')
                          : 'N/A';
                      } catch {
                        return 'N/A';
                      }
                    })()}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 flex items-center gap-1 text-truncate">
                    <Tag className="w-3 h-3 flex-shrink-0" />
                    {invoice.categoryName || 'N/A'}
                  </p>
                  {(invoice.ocrCost || invoice.ocrCurrency) && (
                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {invoice.ocrCurrency || ''}{' '}
                      {invoice.ocrCost
                        ? Number(invoice.ocrCost).toLocaleString()
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* Always-visible delete button on top-right corner */}
              <button
                onClick={(e) => handleDeleteFromGallery(e, invoice)}
                disabled={isDeleting}
                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full
                           bg-red-500 text-white flex items-center justify-center
                           hover:bg-red-600 active:bg-red-700
                           shadow-md z-10 border-2 border-white dark:border-gray-900"
                title="Delete invoice"
              >
                {isDeleting ? (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
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
          onDeleted={handleInvoiceDeletedFromViewer}
        />
      )}
    </div>
  );
}
