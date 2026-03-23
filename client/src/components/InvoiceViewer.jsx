import { useState, useEffect, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  ZoomIn,
  ZoomOut,
  FileText,
  Eye,
  EyeOff,
} from 'lucide-react';
import { downloadInvoice, deleteInvoice } from '../api';
import { showSuccess, showError } from './ui/Toast';

export default function InvoiceViewer({
  invoice,
  invoices = [],
  currentIndex = 0,
  onClose,
  onNavigate,
  onDeleted,
}) {
  const [zoom, setZoom] = useState(1);
  const [showOcr, setShowOcr] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < invoices.length - 1;

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(currentIndex - 1);
      if (e.key === 'ArrowRight' && hasNext) onNavigate(currentIndex + 1);
    },
    [onClose, hasPrev, hasNext, currentIndex, onNavigate]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Reset zoom on navigation
  useEffect(() => {
    setZoom(1);
    setConfirmDelete(false);
  }, [currentIndex]);

  const handleDownload = async () => {
    try {
      const invoiceId = invoice._id || invoice.id;
      const blob = await downloadInvoice(invoiceId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = invoice.filename || invoice.originalName || 'invoice';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      const imageUrl = invoice.url || invoice.filePath || invoice.fileUrl || invoice.thumbnailUrl;
      if (imageUrl) {
        window.open(imageUrl, '_blank');
      } else {
        showError('Download failed');
      }
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteInvoice(invoice._id || invoice.id);
      showSuccess('Invoice deleted');
      onDeleted?.(invoice._id || invoice.id);
    } catch (err) {
      showError(err.message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const imageUrl = invoice.url || invoice.filePath || invoice.fileUrl || invoice.thumbnailUrl;
  const ocrText = invoice.ocrText || invoice.ocr_text || '';
  const ocrCost = invoice.ocrCost || invoice.ocr_cost;
  const ocrCurrency = invoice.ocrCurrency || invoice.ocr_currency;

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex animate-fade-in">
      {/* Top toolbar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between
                      px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-2">
          <span className="text-white/70 text-sm">
            {currentIndex + 1} / {invoices.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg
                       transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-white/70 text-sm w-14 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg
                       transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <div className="w-px h-6 bg-white/20 mx-1" />
          <button
            onClick={() => setShowOcr(!showOcr)}
            className={`p-2 rounded-lg transition-colors ${
              showOcr
                ? 'text-brand-400 bg-white/10'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
            title={showOcr ? 'Hide OCR text' : 'Show OCR text'}
          >
            {showOcr ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
          <button
            onClick={handleDownload}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg
                       transition-colors"
            title="Download"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`p-2 rounded-lg transition-colors ${
              confirmDelete
                ? 'text-red-400 bg-red-500/20'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
            title={confirmDelete ? 'Click again to confirm' : 'Delete'}
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <div className="w-px h-6 bg-white/20 mx-1" />
          <button
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg
                       transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Navigation arrows */}
      {hasPrev && (
        <button
          onClick={() => onNavigate(currentIndex - 1)}
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10
                     p-2 sm:p-3 bg-white/10 hover:bg-white/20 rounded-full
                     text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      )}
      {hasNext && (
        <button
          onClick={() => onNavigate(currentIndex + 1)}
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10
                     p-2 sm:p-3 bg-white/10 hover:bg-white/20 rounded-full
                     text-white transition-colors"
        >
          <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Image area */}
        <div
          className={`flex-1 flex items-center justify-center overflow-auto p-4 pt-16 ${
            showOcr ? 'sm:mr-80' : ''
          }`}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Invoice"
              className="max-w-full max-h-full object-contain transition-transform duration-200"
              style={{ transform: `scale(${zoom})` }}
              draggable={false}
            />
          ) : (
            <div className="text-center">
              <FileText className="w-20 h-20 text-white/30 mx-auto mb-4" />
              <p className="text-white/50">No preview available</p>
            </div>
          )}
        </div>

        {/* OCR sidebar */}
        {showOcr && (
          <div className="fixed right-0 top-0 bottom-0 w-full sm:w-80 bg-gray-900
                         border-l border-gray-800 z-20 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-white">
                Extracted Text (OCR)
              </h3>
              <button
                onClick={() => setShowOcr(false)}
                className="sm:hidden p-1 text-white/70 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {/* Detected cost/currency */}
              {(ocrCost || ocrCurrency) && (
                <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
                  <p className="text-xs font-medium text-gray-400 mb-1">Detected from Invoice</p>
                  <p className="text-lg font-semibold text-emerald-400">
                    {ocrCurrency || ''} {ocrCost ? Number(ocrCost).toLocaleString() : '--'}
                  </p>
                </div>
              )}
              {ocrText ? (
                <p className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {ocrText}
                </p>
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">
                    No OCR text available for this invoice.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
