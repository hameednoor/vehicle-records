import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// ---------------------------------------------------------------------------
// Simple in-memory cache for GET requests (stale-while-revalidate pattern)
// Shows cached data instantly while refreshing in the background.
// ---------------------------------------------------------------------------
const cache = new Map();
const CACHE_TTL = 120_000; // 2 minutes — max age before cache is discarded
const CACHE_FRESH = 30_000; // 30 seconds — don't background-refresh within this window

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

export function invalidateCache(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

function cachedGet(url, params) {
  const key = url + (params ? JSON.stringify(params) : '');
  const entry = getCached(key);
  if (entry) {
    // Only background-refresh if cache is stale (older than CACHE_FRESH)
    if (Date.now() - entry.time > CACHE_FRESH) {
      api.get(url, { params }).then((r) => setCache(key, r.data)).catch(() => {});
    }
    return Promise.resolve(entry.data);
  }
  return api.get(url, { params }).then((r) => {
    setCache(key, r.data);
    return r.data;
  });
}

// ---------------------------------------------------------------------------
// Auth token management
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'vmt_auth_token';
const USER_KEY = 'vmt_auth_user';

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  cache.clear();
}

// Callback for 401 responses — set by AuthContext
let onUnauthorized = null;
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

// Request interceptor: attach auth token + remove Content-Type for FormData
api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // On 401, trigger logout
    if (error.response?.status === 401 && onUnauthorized) {
      onUnauthorized();
    }

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

// ============ Auth ============
export const login = (name, pin) =>
  api.post('/auth/login', { name, pin }).then((r) => r.data);

export const getMe = () =>
  api.get('/auth/me').then((r) => r.data);

export const changePin = (currentPin, newPin) =>
  api.put('/auth/change-pin', { currentPin, newPin }).then((r) => r.data);

// ============ Users (admin) ============
export const getUsers = () =>
  api.get('/users').then((r) => r.data);

export const createUser = (data) =>
  api.post('/users', data).then((r) => r.data);

export const updateUser = (id, data) =>
  api.put(`/users/${id}`, data).then((r) => r.data);

export const resetUserPin = (id, pin) =>
  api.put(`/users/${id}/reset-pin`, { pin }).then((r) => r.data);

export const deleteUser = (id) =>
  api.delete(`/users/${id}`).then((r) => r.data);

// ============ Vehicles ============
export const getVehicles = () => cachedGet('/vehicles');

export const getVehicle = (id) => cachedGet(`/vehicles/${id}`);

export const createVehicle = (data) => { invalidateCache('/vehicles'); return api.post('/vehicles', data).then((r) => r.data); };

export const updateVehicle = (id, data) => { invalidateCache('/vehicles'); return api.put(`/vehicles/${id}`, data).then((r) => r.data); };

export const deleteVehicle = (id) => { invalidateCache('/vehicles'); return api.delete(`/vehicles/${id}`).then((r) => r.data); };

export const uploadVehiclePhoto = (id, formData) => {
  invalidateCache('/vehicles');
  return api
    .put(`/vehicles/${id}/photo`, formData, {
      headers: { 'Content-Type': undefined },
    })
    .then((r) => r.data);
};

export const getVehicleStats = (id) => cachedGet(`/vehicles/${id}/stats`);

export const updateKms = (id, data) => {
  invalidateCache('/vehicles'); invalidateCache('/km-logs');
  return api.post('/km-logs', { vehicleId: id, kms: data.kms, date: data.date }).then((r) => r.data);
};

// ============ Categories ============
export const getCategories = () => cachedGet('/categories');

export const createCategory = (data) => { invalidateCache('/categories'); return api.post('/categories', data).then((r) => r.data); };

export const updateCategory = (id, data) => { invalidateCache('/categories'); return api.put(`/categories/${id}`, data).then((r) => r.data); };

export const archiveCategory = (id) => { invalidateCache('/categories'); return api.put(`/categories/${id}/archive`).then((r) => r.data); };

export const deleteCategory = (id) => { invalidateCache('/categories'); return api.delete(`/categories/${id}`).then((r) => r.data); };

// ============ Service Records ============
export const getServiceRecords = (params) => cachedGet('/service-records', params);

export const getServiceRecord = (id) => cachedGet(`/service-records/${id}`);

export const createServiceRecord = (data) => { invalidateCache('/service-records'); invalidateCache('/vehicles'); return api.post('/service-records', data).then((r) => r.data); };

export const updateServiceRecord = (id, data) => { invalidateCache('/service-records'); invalidateCache('/vehicles'); return api.put(`/service-records/${id}`, data).then((r) => r.data); };

export const deleteServiceRecord = (id) => { invalidateCache('/service-records'); invalidateCache('/vehicles'); return api.delete(`/service-records/${id}`).then((r) => r.data); };

export const getVehicleServiceRecords = (vehicleId, params) =>
  cachedGet(`/service-records/vehicle/${vehicleId}`, params);

export const getUpcomingMaintenance = () => cachedGet('/service-records/upcoming');

// ============ Invoices ============
export const uploadInvoices = (serviceRecordId, formData) => {
  invalidateCache('/invoices'); invalidateCache('/service-records'); invalidateCache('/vehicles');
  return api
    .post(`/invoices/upload/${serviceRecordId}`, formData, {
      headers: { 'Content-Type': undefined },
    })
    .then((r) => r.data);
};

export const getInvoice = (id) => cachedGet(`/invoices/${id}`);

export const getServiceInvoices = (serviceRecordId) =>
  cachedGet(`/invoices/service/${serviceRecordId}`);

export const deleteInvoice = (id) => { invalidateCache('/invoices'); return api.delete(`/invoices/${id}`).then((r) => r.data); };

export const downloadInvoice = (id) =>
  api
    .get(`/invoices/${id}/download`, { responseType: 'blob' })
    .then((r) => r.data);

export const searchInvoices = (params) => cachedGet('/invoices/search', params);

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
export const logKm = (vehicleId, data) => {
  invalidateCache('/km-logs');
  return api.post('/km-logs', { vehicleId, ...data }).then((r) => r.data);
};

export const getVehicleKmLogs = (vehicleId) => cachedGet(`/km-logs/vehicle/${vehicleId}`);

export const analyzeOdometer = (file, currentKms) => {
  const formData = new FormData();
  formData.append('photo', file);
  formData.append('currentKms', String(currentKms || 0));
  return api
    .post('/km-logs/analyze-odometer', formData, {
      headers: { 'Content-Type': undefined },
      timeout: 60000,
    })
    .then((r) => r.data);
};

// ============ Reminders ============
export const getReminders = () => cachedGet('/reminders');

export const getVehicleReminders = (vehicleId) => cachedGet(`/reminders/vehicle/${vehicleId}`);

export const createReminder = (data) => { invalidateCache('/reminders'); return api.post('/reminders', data).then((r) => r.data); };

export const updateReminder = (id, data) => { invalidateCache('/reminders'); return api.put(`/reminders/${id}`, data).then((r) => r.data); };

export const deleteReminder = (id) => { invalidateCache('/reminders'); return api.delete(`/reminders/${id}`).then((r) => r.data); };

// ============ Settings ============
export const getSettings = () => cachedGet('/settings');

export const updateSettings = (data) => { invalidateCache('/settings'); return api.put('/settings', data).then((r) => r.data); };

export const exportData = () =>
  api.get('/settings/export', { responseType: 'blob' }).then((r) => r.data);

export const importData = (data) => { invalidateCache(''); return api.post('/settings/import', data).then((r) => r.data); };

// ============ Reports ============
export const getCostByVehicle = (params) => cachedGet('/reports/cost-by-vehicle', params);

export const getCostByCategory = (params) => cachedGet('/reports/cost-by-category', params);

export const getMonthlyTrends = (params) => cachedGet('/reports/monthly-trends', params);

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
  cachedGet('/exchange/rate', { from, to, date });

export const getCurrencies = () => cachedGet('/exchange/currencies');

export const getServiceIntervals = () => cachedGet('/service-records/intervals');

export default api;
