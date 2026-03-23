import { useState, useEffect } from 'react';
import {
  Tags,
  Plus,
  Archive,
  ArchiveRestore,
  Trash2,
  Edit,
  Save,
  X,
  Shield,
  AlertCircle,
} from 'lucide-react';
import {
  getCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  deleteCategory,
} from '../api';
import { Skeleton } from './ui/LoadingSkeleton';
import StatusBadge from './ui/StatusBadge';
import Modal from './ui/Modal';
import { showSuccess, showError } from './ui/Toast';

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editKms, setEditKms] = useState('');
  const [editDays, setEditDays] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await getCategories();
      const list = Array.isArray(data)
        ? data
        : data?.categories || data?.data || [];
      setCategories(list);
    } catch {
      showError('Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setAdding(true);
    try {
      await createCategory({ name: newName.trim() });
      setNewName('');
      showSuccess('Category created');
      fetchCategories();
    } catch (err) {
      showError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (id) => {
    if (!editName.trim()) return;
    try {
      await updateCategory(id, {
        name: editName.trim(),
        defaultKms: editKms ? Number(editKms) : null,
        defaultDays: editDays ? Number(editDays) : null,
      });
      setEditId(null);
      setEditName('');
      setEditKms('');
      setEditDays('');
      showSuccess('Category updated');
      fetchCategories();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleArchive = async (category) => {
    try {
      await archiveCategory(category._id || category.id);
      showSuccess(
        category.archived || category.is_archived
          ? 'Category restored'
          : 'Category archived'
      );
      fetchCategories();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCategory(deleteTarget._id || deleteTarget.id);
      showSuccess('Category deleted');
      setDeleteTarget(null);
      fetchCategories();
    } catch (err) {
      showError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const activeCategories = categories.filter(
    (c) => !c.archived && !c.is_archived
  );
  const archivedCategories = categories.filter(
    (c) => c.archived || c.is_archived
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Tags className="w-6 h-6 text-brand-700 dark:text-brand-400" />
          Categories
        </h1>
        <p className="page-subtitle">Manage service categories for organizing maintenance records</p>
      </div>

      {/* Add new category */}
      <form onSubmit={handleAdd} className="card p-4">
        <div className="flex gap-3">
          <input
            type="text"
            className="input flex-1"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category name..."
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={adding || !newName.trim()}
          >
            <Plus className="w-4 h-4" />
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {/* Active categories */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 px-1">
          Active Categories ({activeCategories.length})
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="card p-4 flex items-center gap-3">
                <Skeleton className="h-5 w-40 rounded" />
                <div className="ml-auto flex gap-2">
                  <Skeleton className="h-8 w-8 rounded" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : activeCategories.length === 0 ? (
          <div className="card p-8 text-center">
            <Tags className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No categories yet. Add one above to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeCategories.map((cat) => {
              const catId = cat._id || cat.id;
              const isEditing = editId === catId;
              const serviceCount =
                cat.serviceCount || cat.service_count || cat.count || 0;
              const isDefault = cat.isDefault || cat.is_default;
              const hasServices = serviceCount > 0;

              return (
                <div
                  key={catId}
                  className="card p-4 flex items-center gap-3 group"
                >
                  {isEditing ? (
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="input flex-1"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdate(catId);
                            if (e.key === 'Escape') setEditId(null);
                          }}
                          placeholder="Category name"
                          autoFocus
                        />
                        <button
                          onClick={() => handleUpdate(catId)}
                          className="btn-primary text-sm"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="btn-ghost text-sm"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <input
                            type="number"
                            className="input text-xs"
                            value={editKms}
                            onChange={(e) => setEditKms(e.target.value)}
                            placeholder="Default KMs interval"
                            min="0"
                          />
                        </div>
                        <div className="flex-1">
                          <input
                            type="number"
                            className="input text-xs"
                            value={editDays}
                            onChange={(e) => setEditDays(e.target.value)}
                            placeholder="Default days interval"
                            min="0"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-50 text-sm">
                            {cat.name}
                          </span>
                          {isDefault && (
                            <StatusBadge status="info" label="Default" />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          {(cat.defaultKms || cat.defaultDays) && (
                            <p className="text-xs text-brand-600 dark:text-brand-400">
                              {cat.defaultKms ? `Every ${Number(cat.defaultKms).toLocaleString()} km` : ''}
                              {cat.defaultKms && cat.defaultDays ? ' / ' : ''}
                              {cat.defaultDays ? `${cat.defaultDays} days` : ''}
                            </p>
                          )}
                          {serviceCount > 0 && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {serviceCount} service{serviceCount !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditId(catId);
                            setEditName(cat.name);
                            setEditKms(cat.defaultKms || '');
                            setEditDays(cat.defaultDays || '');
                          }}
                          className="btn-icon"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleArchive(cat)}
                          className="btn-icon"
                          title="Archive"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        <div className="relative group/delete">
                          <button
                            onClick={() => {
                              if (!hasServices) setDeleteTarget(cat);
                            }}
                            className={`btn-icon ${
                              hasServices
                                ? 'opacity-30 cursor-not-allowed'
                                : 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50'
                            }`}
                            disabled={hasServices}
                            title={
                              hasServices
                                ? 'Cannot delete: has service records'
                                : 'Delete'
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          {hasServices && (
                            <div className="absolute bottom-full right-0 mb-2 w-48 p-2
                                          bg-gray-900 text-white text-xs rounded-lg
                                          opacity-0 group-hover/delete:opacity-100
                                          transition-opacity pointer-events-none z-10">
                              <div className="flex items-start gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                Cannot delete a category that has service records.
                                Archive it instead.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Archived categories */}
      {archivedCategories.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 px-1">
            Archived ({archivedCategories.length})
          </h2>
          <div className="space-y-2">
            {archivedCategories.map((cat) => {
              const catId = cat._id || cat.id;
              return (
                <div
                  key={catId}
                  className="card p-4 flex items-center gap-3 opacity-60 hover:opacity-100 transition-opacity"
                >
                  <div className="flex-1">
                    <span className="text-sm text-gray-600 dark:text-gray-400 line-through">
                      {cat.name}
                    </span>
                  </div>
                  <button
                    onClick={() => handleArchive(cat)}
                    className="btn-icon"
                    title="Restore"
                  >
                    <ArchiveRestore className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Category"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-gray-900 dark:text-gray-50">
              {deleteTarget?.name}
            </span>
            ? This action cannot be undone.
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
