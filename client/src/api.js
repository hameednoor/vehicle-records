import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: automatically remove Content-Type for FormData
// so the browser sets the correct multipart boundary
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error.response?.data;
    let message;

    if (data?.errors && Array.isArray(data.errors)) {
      // express-validator format: { errors: [{ msg: "..." }, ...] }
      message = data.errors.map((e) => e.msg || e.message).join('. ');
    } else {
      message =
        data?.error ||
        data?.message ||
        error.message ||
        'An unexpected error occurred';
    }

    return Promise.reject(new Error(message));
  }
);

// ============ Vehicles ============
export const getVehicles = () => api.get('/vehicles').then((r) => r.data);

export const getVehicle = (id) => api.get(`/vehicles/${id}`).then((r) => r.data);

export const createVehicle = (data) => api.post('/vehicles', data).then((r) => r.data);

export const updateVehicle = (id, data) =>
  api.put(`/vehicles/${id}`, data).then((r) => r.data);

export const deleteVehicle = (id) =>
  api.delete(`/vehicles/${id}`).then((r) => r.data);

export const uploadVehiclePhoto = (id, formData) =>
  api
    .put(`/vehicles/${id}/photo`, formData, {
      headers: { 'Content-Type': undefined },
    })
    .then((r) => r.data);

export const getVehicleStats = (id) =>
  api.get(`/vehicles/${id}/stats`).then((r) => r.data);

export const updateKms = (id, data) =>
  api.post('/km-logs', { vehicleId: id, kms: data.kms, date: data.date }).then((r) => r.data);

// ============ Categories ============
export const getCategories = () => api.get('/categories').then((r) => r.data);

export const createCategory = (data) =>
  api.post('/categories', data).then((r) => r.data);

export const updateCategory = (id, data) =>
  api.put(`/categories/${id}`, data).then((r) => r.data);

export const archiveCategory = (id) =>
  api.put(`/categories/${id}/archive`).then((r) => r.data);

export const deleteCategory = (id) =>
  api.delete(`/categories/${id}`).then((r) => r.data);

// ============ Service Records ============
export const getServiceRecords = (params) =>
  api.get('/service-records', { params }).then((r) => r.data);

export const getServiceRecord = (id) =>
  api.get(`/service-records/${id}`).then((r) => r.data);

export const createServiceRecord = (data) =>
  api.post('/service-records', data).then((r) => r.data);

export const updateServiceRecord = (id, data) =>
  api.put(`/service-records/${id}`, data).then((r) => r.data);

export const deleteServiceRecord = (id) =>
  api.delete(`/service-records/${id}`).then((r) => r.data);

export const getVehicleServiceRecords = (vehicleId, params) =>
  api.get(`/service-records/vehicle/${vehicleId}`, { params }).then((r) => r.data);

export const getUpcomingMaintenance = () =>
  api.get('/service-records/upcoming').then((r) => r.data);

// ============ Invoices ============
export const uploadInvoices = (serviceRecordId, formData) =>
  api
    .post(`/invoices/upload/${serviceRecordId}`, formData, {
      headers: { 'Content-Type': undefined },
    })
    .then((r) => r.data);

export const getInvoice = (id) =>
  api.get(`/invoices/${id}`).then((r) => r.data);

export const getServiceInvoices = (serviceRecordId) =>
  api.get(`/invoices/service/${serviceRecordId}`).then((r) => r.data);

export const deleteInvoice = (id) =>
  api.delete(`/invoices/${id}`).then((r) => r.data);

export const downloadInvoice = (id) =>
  api
    .get(`/invoices/${id}/download`, { responseType: 'blob' })
    .then((r) => r.data);

export const searchInvoices = (params) =>
  api.get('/invoices/search', { params }).then((r) => r.data);

export const analyzeInvoice = (file) => {
  const formData = new FormData();
  formData.append('invoice', file);
  return api
    .post('/invoices/analyze', formData, {
      headers: { 'Content-Type': undefined },
      timeout: 120000, // 2 min for OCR processing
    })
    .then((r) => r.data);
};

// ============ KM Logs ============
export const logKm = (vehicleId, data) =>
  api.post('/km-logs', { vehicleId, ...data }).then((r) => r.data);

export const getVehicleKmLogs = (vehicleId) =>
  api.get(`/km-logs/vehicle/${vehicleId}`).then((r) => r.data);

// ============ Reminders ============
export const getReminders = () => api.get('/reminders').then((r) => r.data);

export const getVehicleReminders = (vehicleId) =>
  api.get(`/reminders/vehicle/${vehicleId}`).then((r) => r.data);

export const createReminder = (data) =>
  api.post('/reminders', data).then((r) => r.data);

export const updateReminder = (id, data) =>
  api.put(`/reminders/${id}`, data).then((r) => r.data);

export const deleteReminder = (id) =>
  api.delete(`/reminders/${id}`).then((r) => r.data);

// ============ Settings ============
export const getSettings = () => api.get('/settings').then((r) => r.data);

export const updateSettings = (data) =>
  api.put('/settings', data).then((r) => r.data);

export const exportData = () =>
  api.get('/settings/export', { responseType: 'blob' }).then((r) => r.data);

export const importData = (data) =>
  api.post('/settings/import', data).then((r) => r.data);

// ============ Reports ============
export const getCostByVehicle = (params) =>
  api.get('/reports/cost-by-vehicle', { params }).then((r) => r.data);

export const getCostByCategory = (params) =>
  api.get('/reports/cost-by-category', { params }).then((r) => r.data);

export const getMonthlyTrends = (params) =>
  api.get('/reports/monthly-trends', { params }).then((r) => r.data);

export const exportCsv = (params) =>
  api
    .get('/reports/export/csv', { params, responseType: 'blob' })
    .then((r) => r.data);

export const exportPdf = (params) =>
  api
    .get('/reports/export/pdf', { params, responseType: 'blob' })
    .then((r) => r.data);

// ============ Exchange Rates ============
export const getExchangeRate = (from, to = 'AED', date) =>
  api.get('/exchange/rate', { params: { from, to, date } }).then((r) => r.data);

export const getCurrencies = () =>
  api.get('/exchange/currencies').then((r) => r.data);

export const getServiceIntervals = () =>
  api.get('/service-records/intervals').then((r) => r.data);

export default api;
