require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db/database');
const { seed } = require('./db/seed');
const { startScheduler } = require('./services/scheduler');
const { ensureBuckets, isCloudStorage } = require('./services/storage');

const app = express();
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// CORS - allow requests from the frontend dev server
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, server-to-server)
      if (!origin) return callback(null, true);
      // Allow configured origin, localhost, and any vercel.app domain
      const allowed =
        origin === CORS_ORIGIN ||
        origin.includes('localhost') ||
        origin.endsWith('.vercel.app');
      callback(null, allowed);
    },
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file serving for uploaded files (local mode)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// In production, serve the built frontend
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
}

// ---------------------------------------------------------------------------
// Routes (loaded after DB init below)
// ---------------------------------------------------------------------------

function mountRoutes() {
  const vehicleRoutes = require('./routes/vehicles');
  const categoryRoutes = require('./routes/categories');
  const serviceRecordRoutes = require('./routes/serviceRecords');
  const invoiceRoutes = require('./routes/invoices');
  const kmLogRoutes = require('./routes/kmLogs');
  const reminderRoutes = require('./routes/reminders');
  const settingsRoutes = require('./routes/settings');
  const reportRoutes = require('./routes/reports');
  const exchangeRoutes = require('./routes/exchange');

  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/service-records', serviceRecordRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/km-logs', kmLogRoutes);
  app.use('/api/reminders', reminderRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/exchange', exchangeRoutes);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: process.env.DATABASE_URL ? 'postgresql' : 'sqlite',
      storage: isCloudStorage ? 'supabase' : 'local',
    });
  });

  // In production, serve index.html for client-side routing
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '..', 'client', 'dist');
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // 404 handler for unmatched routes
  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global error handler (must be after 404 handler so it can catch errors from above)
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error.',
      ...(process.env.NODE_ENV === 'development' && { details: err.message }),
    });
  });
}

// ---------------------------------------------------------------------------
// Bootstrap: init DB, seed, mount routes, start server
// ---------------------------------------------------------------------------

let initPromise = null;

async function init() {
  const db = await initDb();
  await ensureBuckets();
  await seed();
  mountRoutes();
  return db;
}

// For Vercel serverless: lazy-init on first request
function ensureInit() {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

// When running as a standalone server (not Vercel)
if (!process.env.VERCEL) {
  ensureInit()
    .then((db) => {
      app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`CORS enabled for: ${CORS_ORIGIN}`);
        console.log(`Storage mode: ${isCloudStorage ? 'Supabase Cloud' : 'Local filesystem'}`);
        console.log(`Database mode: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`);
        startScheduler(db);
      });
    })
    .catch((error) => {
      console.error('Failed to start server:', error);
      process.exit(1);
    });
}

// Export for Vercel serverless
module.exports = app;
module.exports.ensureInit = ensureInit;
