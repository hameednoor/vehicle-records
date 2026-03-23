import toast from 'react-hot-toast';

// Custom styled toast functions
export const showSuccess = (message) =>
  toast.success(message);

export const showError = (message) =>
  toast.error(message || 'Something went wrong');

export const showLoading = (message = 'Loading...') =>
  toast.loading(message);

export const dismissToast = (id) => toast.dismiss(id);

export const showPromise = (promise, messages) =>
  toast.promise(promise, {
    loading: messages?.loading || 'Processing...',
    success: messages?.success || 'Done!',
    error: (err) =>
      messages?.error || err?.message || 'Something went wrong',
  });

export default toast;
