import { useCallback, useMemo, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, FileText, Image as ImageIcon, Camera } from 'lucide-react';
import { showError } from './Toast';

export default function DropZone({
  onFilesSelected,
  maxFiles = 10,
  accept = {
    'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.gif', '.bmp', '.tiff'],
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  },
  files = [],
  onRemove,
  label = 'Drop files here or click to browse',
  compact = false,
}) {
  const onDrop = useCallback(
    (acceptedFiles, fileRejections) => {
      if (fileRejections?.length > 0) {
        const errors = fileRejections.map((r) => {
          const name = r.file?.name || 'file';
          const reasons = r.errors?.map((e) => e.message).join(', ') || 'invalid file';
          return `${name}: ${reasons}`;
        });
        showError(errors.join('; '));
      }
      if (onFilesSelected && acceptedFiles.length > 0) {
        onFilesSelected(acceptedFiles);
      }
    },
    [onFilesSelected]
  );

  const cameraInputRef = useRef(null);

  const handleCameraCapture = (e) => {
    const capturedFiles = Array.from(e.target.files || []);
    if (capturedFiles.length > 0 && onFilesSelected) {
      onFilesSelected(capturedFiles);
    }
    // Reset so the same file can be captured again
    e.target.value = '';
  };

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    maxFiles,
    accept,
    multiple: maxFiles > 1,
  });

  const getFileIcon = (file) => {
    if (file.type?.startsWith('image/')) return ImageIcon;
    return FileText;
  };

  // Memoize preview URLs so they are stable across re-renders and properly
  // revoked when files change or the component unmounts
  const previewUrls = useMemo(
    () =>
      files.map((file) =>
        file.type?.startsWith('image/') ? URL.createObjectURL(file) : null
      ),
    [files]
  );

  const prevUrlsRef = useRef([]);
  useEffect(() => {
    // Revoke previous batch of URLs that are no longer used
    const prev = prevUrlsRef.current;
    prev.forEach((url) => { if (url) URL.revokeObjectURL(url); });
    prevUrlsRef.current = previewUrls;

    return () => {
      // Revoke all on unmount
      previewUrls.forEach((url) => { if (url) URL.revokeObjectURL(url); });
    };
  }, [previewUrls]);

  return (
    <div className="space-y-3">
      {/* Hidden camera input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraCapture}
      />

      {/* Drop zone and camera button */}
      <div className="flex gap-2">
        <div
          {...getRootProps()}
          className={`
            flex-1 relative border-2 border-dashed rounded-xl cursor-pointer
            transition-all duration-200 text-center
            ${compact ? 'p-4' : 'p-6 sm:p-8'}
            ${
              isDragActive && !isDragReject
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                : isDragReject
                ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
                : 'border-gray-300 dark:border-gray-700 hover:border-brand-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }
          `}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2">
            <div
              className={`
                p-3 rounded-full
                ${isDragActive ? 'bg-brand-100 dark:bg-brand-900' : 'bg-gray-100 dark:bg-gray-800'}
              `}
            >
              <Upload
                className={`w-5 h-5 ${
                  isDragActive
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isDragActive ? 'Drop files here' : label}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Images, PDF, Word, Excel{maxFiles > 1 ? ` (up to ${maxFiles} files)` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Camera button */}
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 px-4 border-2 border-dashed
                     border-gray-300 dark:border-gray-700 rounded-xl cursor-pointer
                     hover:border-brand-400 hover:bg-gray-50 dark:hover:bg-gray-800/50
                     transition-all duration-200"
        >
          <div className="p-3 rounded-full bg-gray-100 dark:bg-gray-800">
            <Camera className="w-5 h-5 text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Camera
          </p>
        </button>
      </div>

      {/* File previews */}
      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {files.map((file, index) => {
            const previewUrl = previewUrls[index];
            const FileIcon = getFileIcon(file);

            return (
              <div
                key={`${file.name}-${index}`}
                className="relative group card overflow-hidden"
              >
                {/* Preview */}
                <div className="aspect-square flex items-center justify-center bg-gray-50 dark:bg-gray-800">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={file.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileIcon className="w-10 h-10 text-gray-400" />
                  )}
                </div>

                {/* File name */}
                <div className="px-2 py-1.5">
                  <p className="text-xs text-gray-600 dark:text-gray-400 text-truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>

                {/* Remove button */}
                {onRemove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(index);
                    }}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full
                               flex items-center justify-center shadow-md
                               hover:bg-red-600 active:bg-red-700
                               border-2 border-white dark:border-gray-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
