const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');
const { deleteFile, UPLOADS_DIR } = require('../services/storage');

const router = express.Router();

/**
 * GET /upcoming - Get upcoming/overdue maintenance across all vehicles.
 * Must be defined before /:id to avoid route conflict.
 */
router.get('/upcoming', async (req, res) => {
  try {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    // Show all services with a due date within the next 90 days (or already overdue)
    const displayDate = new Date();
    displayDate.setDate(displayDate.getDate() + 90);
    const displayDateStr = displayDate.toISOString().split('T')[0];

    // Display window for KMs: current + 5000
    const displayBufferKms = 5000;

    // Date-based: overdue + upcoming within 90 days
    const dateRecords = await db.all(
      `SELECT sr.*, c.name as "categoryName", v.name as "vehicleName", v."currentKms",
              CASE WHEN sr."nextDueDate" < ? THEN 1 ELSE 0 END as "isOverdue"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       JOIN vehicles v ON sr."vehicleId" = v.id
       WHERE sr."nextDueDate" IS NOT NULL AND sr."nextDueDate" <= ?
       ORDER BY sr."nextDueDate" ASC`,
      today, displayDateStr
    );

    // KM-based: overdue + upcoming within 5000 km
    const kmsRecords = await db.all(
      `SELECT sr.*, c.name as "categoryName", v.name as "vehicleName", v."currentKms",
              CASE WHEN sr."nextDueKms" <= v."currentKms" THEN 1 ELSE 0 END as "isOverdue"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       JOIN vehicles v ON sr."vehicleId" = v.id
       WHERE sr."nextDueKms" IS NOT NULL AND sr."nextDueKms" <= (v."currentKms" + ?)`,
      displayBufferKms
    );

    // Merge and deduplicate (keep overdue status if either source marks it)
    const seen = new Map();
    const combined = [];

    for (const record of [...dateRecords, ...kmsRecords]) {
      if (seen.has(record.id)) {
        const existing = seen.get(record.id);
        if (Number(record.isOverdue) === 1 && Number(existing.isOverdue) !== 1) {
          existing.isOverdue = 1;
        }
      } else {
        seen.set(record.id, record);
        combined.push(record);
      }
    }

    // Sort: overdue first, then by date
    combined.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return b.isOverdue - a.isOverdue;
      if (a.nextDueDate && b.nextDueDate) return a.nextDueDate.localeCompare(b.nextDueDate);
      return 0;
    });

    res.json(combined);
  } catch (error) {
    console.error('Error fetching upcoming maintenance:', error.message);
    res.status(500).json({ error: 'Failed to fetch upcoming maintenance.' });
  }
});

/**
 * GET /vehicle/:vehicleId - Get all service records for a vehicle.
 */
router.get('/vehicle/:vehicleId', async (req, res) => {
  try {
    const db = getDb();

    const records = await db.all(
      `SELECT sr.*, c.name as "categoryName"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       WHERE sr."vehicleId" = ?
       ORDER BY sr.date DESC`,
      req.params.vehicleId
    );

    // Fetch all invoices for this vehicle in one query (avoids N+1)
    const invoices = await db.all(
      `SELECT i.* FROM invoices i
       JOIN service_records sr ON i."serviceRecordId" = sr.id
       WHERE sr."vehicleId" = ?
       ORDER BY i."uploadedAt" DESC`,
      req.params.vehicleId
    );

    // Group invoices by service record
    const invoiceMap = {};
    for (const inv of invoices) {
      const key = inv.serviceRecordId;
      if (!invoiceMap[key]) invoiceMap[key] = [];
      invoiceMap[key].push(inv);
    }

    // Attach invoices and count to each record
    for (const record of records) {
      record.invoices = invoiceMap[record.id] || [];
      record.invoiceCount = record.invoices.length;
    }

    res.json(records);
  } catch (error) {
    console.error('Error fetching vehicle service records:', error.message);
    res.status(500).json({ error: 'Failed to fetch service records.' });
  }
});

/**
 * GET / - List all service records with vehicle and category info.
 * Query params: vehicleId, categoryId, startDate, endDate
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { vehicleId, categoryId, startDate, endDate } = req.query;

    let query = `
      SELECT sr.*, c.name as "categoryName", v.name as "vehicleName",
             (SELECT COUNT(*) FROM invoices i WHERE i."serviceRecordId" = sr.id) as "invoiceCount"
      FROM service_records sr
      JOIN categories c ON sr."categoryId" = c.id
      JOIN vehicles v ON sr."vehicleId" = v.id
      WHERE 1=1
    `;
    const params = [];

    if (vehicleId) {
      query += ' AND sr."vehicleId" = ?';
      params.push(vehicleId);
    }
    if (categoryId) {
      query += ' AND sr."categoryId" = ?';
      params.push(categoryId);
    }
    if (startDate) {
      query += ' AND sr.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND sr.date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY sr.date DESC';

    const records = await db.all(query, ...params);
    res.json(records);
  } catch (error) {
    console.error('Error fetching service records:', error.message);
    res.status(500).json({ error: 'Failed to fetch service records.' });
  }
});

/**
 * GET /intervals - Get default service intervals by category
 */
router.get('/intervals', async (req, res) => {
  const { SERVICE_INTERVALS } = require('../db/seed');
  res.json(SERVICE_INTERVALS);
});

/**
 * GET /:id - Get a single service record with invoices.
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();

    const record = await db.get(
      `SELECT sr.*, c.name as "categoryName", v.name as "vehicleName"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       JOIN vehicles v ON sr."vehicleId" = v.id
       WHERE sr.id = ?`,
      req.params.id
    );

    if (!record) {
      return res.status(404).json({ error: 'Service record not found.' });
    }

    const invoices = await db.all(
      'SELECT * FROM invoices WHERE "serviceRecordId" = ? ORDER BY "uploadedAt" DESC',
      req.params.id
    );

    res.json({ ...record, invoices });
  } catch (error) {
    console.error('Error fetching service record:', error.message);
    res.status(500).json({ error: 'Failed to fetch service record.' });
  }
});

/**
 * POST / - Create a new service record.
 */
router.post(
  '/',
  [
    body('vehicleId').trim().notEmpty().withMessage('Vehicle ID is required.'),
    body('categoryId').trim().notEmpty().withMessage('Category ID is required.'),
    body('date').trim().notEmpty().withMessage('Service date is required.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const db = getDb();
      const id = uuidv4();
      const {
        vehicleId,
        categoryId,
        date,
        kmsAtService,
        cost,
        currency,
        provider,
        notes,
        nextDueKms,
        nextDueDays,
        nextDueDate,
        originalCost,
        originalCurrency,
        exchangeRate,
      } = req.body;

      // Verify vehicle exists
      const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: 'Vehicle not found.' });
      }

      // Verify category exists
      const category = await db.get('SELECT * FROM categories WHERE id = ?', categoryId);
      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }

      // Auto-populate from category defaults when user didn't provide values
      let usedNextDueKms = nextDueKms || null;
      let usedNextDueDays = nextDueDays || null;

      if (!usedNextDueKms && !usedNextDueDays && category) {
        if (category.defaultKms && kmsAtService) {
          usedNextDueKms = Number(kmsAtService) + Number(category.defaultKms);
        }
        if (category.defaultDays) {
          usedNextDueDays = Number(category.defaultDays);
        }
      }

      // Calculate nextDueDate from nextDueDays if provided and nextDueDate is not
      let calculatedNextDueDate = nextDueDate || null;
      if (!calculatedNextDueDate && usedNextDueDays) {
        const serviceDate = new Date(date);
        serviceDate.setDate(serviceDate.getDate() + parseInt(usedNextDueDays, 10));
        calculatedNextDueDate = serviceDate.toISOString().split('T')[0];
      }

      // Get default currency from settings if not provided
      let usedCurrency = currency;
      if (!usedCurrency) {
        const settings = await db.get('SELECT currency FROM settings WHERE id = 1');
        usedCurrency = settings ? settings.currency : 'AED';
      }

      await db.run(
        `INSERT INTO service_records
         (id, "vehicleId", "categoryId", date, "kmsAtService", cost, currency, provider, notes,
          "nextDueKms", "nextDueDays", "nextDueDate", "originalCost", "originalCurrency", "exchangeRate")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        vehicleId,
        categoryId,
        date,
        kmsAtService || null,
        cost || 0,
        usedCurrency,
        provider || null,
        notes || null,
        usedNextDueKms,
        usedNextDueDays,
        calculatedNextDueDate,
        originalCost || null,
        originalCurrency || null,
        exchangeRate || null
      );

      // Update vehicle currentKms if kmsAtService is greater
      if (kmsAtService && kmsAtService > (vehicle.currentKms || 0)) {
        const now = new Date().toISOString();
        await db.run(
          `UPDATE vehicles SET "currentKms" = ?, "updatedAt" = ? WHERE id = ?`,
          kmsAtService, now, vehicleId
        );
      }

      const record = await db.get(
        `SELECT sr.*, c.name as "categoryName", v.name as "vehicleName"
         FROM service_records sr
         JOIN categories c ON sr."categoryId" = c.id
         JOIN vehicles v ON sr."vehicleId" = v.id
         WHERE sr.id = ?`,
        id
      );

      console.log(`Service record created: ${id} for vehicle ${vehicleId}`);
      res.status(201).json(record);
    } catch (error) {
      console.error('Error creating service record:', error.message);
      res.status(500).json({ error: 'Failed to create service record.' });
    }
  }
);

/**
 * PUT /:id - Update a service record.
 */
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const existing = await db.get('SELECT * FROM service_records WHERE id = ?', req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Service record not found.' });
    }

    const {
      categoryId,
      date,
      kmsAtService,
      cost,
      currency,
      provider,
      notes,
      nextDueKms,
      nextDueDays,
      nextDueDate,
      originalCost,
      originalCurrency,
      exchangeRate,
    } = req.body;

    // Calculate nextDueDate from nextDueDays if provided
    let calculatedNextDueDate = nextDueDate !== undefined ? nextDueDate : existing.nextDueDate;
    const usedDate = date || existing.date;
    const usedNextDueDays = nextDueDays !== undefined ? nextDueDays : existing.nextDueDays;

    if (nextDueDays !== undefined && nextDueDate === undefined) {
      if (usedNextDueDays) {
        const serviceDate = new Date(usedDate);
        serviceDate.setDate(serviceDate.getDate() + parseInt(usedNextDueDays, 10));
        calculatedNextDueDate = serviceDate.toISOString().split('T')[0];
      } else {
        calculatedNextDueDate = null;
      }
    }

    await db.run(
      `UPDATE service_records
       SET "categoryId" = ?, date = ?, "kmsAtService" = ?, cost = ?, currency = ?,
           provider = ?, notes = ?, "nextDueKms" = ?, "nextDueDays" = ?, "nextDueDate" = ?,
           "originalCost" = ?, "originalCurrency" = ?, "exchangeRate" = ?
       WHERE id = ?`,
      categoryId !== undefined ? categoryId : existing.categoryId,
      date !== undefined ? date : existing.date,
      kmsAtService !== undefined ? kmsAtService : existing.kmsAtService,
      cost !== undefined ? cost : existing.cost,
      currency !== undefined ? currency : existing.currency,
      provider !== undefined ? provider : existing.provider,
      notes !== undefined ? notes : existing.notes,
      nextDueKms !== undefined ? nextDueKms : existing.nextDueKms,
      usedNextDueDays,
      calculatedNextDueDate,
      originalCost !== undefined ? originalCost : existing.originalCost,
      originalCurrency !== undefined ? originalCurrency : existing.originalCurrency,
      exchangeRate !== undefined ? exchangeRate : existing.exchangeRate,
      req.params.id
    );

    // Update vehicle currentKms if kmsAtService is greater
    if (kmsAtService) {
      const vehicle = await db.get(
        'SELECT * FROM vehicles WHERE id = ?',
        existing.vehicleId
      );
      if (vehicle && kmsAtService > (vehicle.currentKms || 0)) {
        const now = new Date().toISOString();
        await db.run(
          `UPDATE vehicles SET "currentKms" = ?, "updatedAt" = ? WHERE id = ?`,
          kmsAtService, now, existing.vehicleId
        );
      }
    }

    const record = await db.get(
      `SELECT sr.*, c.name as "categoryName", v.name as "vehicleName"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       JOIN vehicles v ON sr."vehicleId" = v.id
       WHERE sr.id = ?`,
      req.params.id
    );

    res.json(record);
  } catch (error) {
    console.error('Error updating service record:', error.message);
    res.status(500).json({ error: 'Failed to update service record.' });
  }
});

/**
 * DELETE /:id - Delete a service record and associated invoices (including files).
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const record = await db.get('SELECT * FROM service_records WHERE id = ?', req.params.id);

    if (!record) {
      return res.status(404).json({ error: 'Service record not found.' });
    }

    // Delete associated invoice files
    const invoices = await db.all(
      'SELECT "filePath" FROM invoices WHERE "serviceRecordId" = ?',
      req.params.id
    );

    for (const invoice of invoices) {
      await deleteFile('invoices', path.basename(invoice.filePath));
    }

    // CASCADE will handle invoices deletion in DB
    await db.run('DELETE FROM service_records WHERE id = ?', req.params.id);

    res.json({ message: 'Service record deleted successfully.' });
  } catch (error) {
    console.error('Error deleting service record:', error.message);
    res.status(500).json({ error: 'Failed to delete service record.' });
  }
});

module.exports = router;
