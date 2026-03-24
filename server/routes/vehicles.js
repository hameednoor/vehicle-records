const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');
const { singleUpload, transferToCloud } = require('../middleware/upload');
const { deleteFile, isCloudStorage, UPLOADS_DIR } = require('../services/storage');

const router = express.Router();

/**
 * GET / - List all vehicles with last service date and upcoming maintenance info.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();

    const vehicles = await db.all(
      `SELECT v.*,
        (SELECT MAX(sr.date) FROM service_records sr WHERE sr."vehicleId" = v.id) as "lastServiceDate",
        (SELECT c.name FROM service_records sr
         JOIN categories c ON sr."categoryId" = c.id
         WHERE sr."vehicleId" = v.id
         ORDER BY sr.date DESC LIMIT 1) as "lastServiceCategory",
        (SELECT MIN(sr."nextDueDate") FROM service_records sr
         WHERE sr."vehicleId" = v.id AND sr."nextDueDate" IS NOT NULL) as "nextMaintenanceDate",
        (SELECT MIN(sr."nextDueKms") FROM service_records sr
         WHERE sr."vehicleId" = v.id AND sr."nextDueKms" IS NOT NULL) as "nextMaintenanceKms",
        (SELECT COUNT(*) FROM service_records sr WHERE sr."vehicleId" = v.id) as "totalServices",
        (SELECT COALESCE(SUM(sr.cost), 0) FROM service_records sr WHERE sr."vehicleId" = v.id) as "totalSpend"
       FROM vehicles v
       ORDER BY v."updatedAt" DESC`
    );

    res.json(vehicles);
  } catch (error) {
    console.error('Error fetching vehicles:', error.message);
    res.status(500).json({ error: 'Failed to fetch vehicles.' });
  }
});

/**
 * GET /:id - Get a single vehicle with full details.
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', req.params.id);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    // Get recent service records
    const recentServices = await db.all(
      `SELECT sr.*, c.name as "categoryName"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       WHERE sr."vehicleId" = ?
       ORDER BY sr.date DESC
       LIMIT 10`,
      req.params.id
    );

    // Get upcoming maintenance
    const upcomingMaintenance = await db.all(
      `SELECT sr.*, c.name as "categoryName"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       WHERE sr."vehicleId" = ?
         AND (sr."nextDueDate" IS NOT NULL OR sr."nextDueKms" IS NOT NULL)
       ORDER BY sr."nextDueDate" ASC`,
      req.params.id
    );

    // Get KM log history
    const kmLogs = await db.all(
      'SELECT * FROM km_logs WHERE "vehicleId" = ? ORDER BY "loggedAt" DESC LIMIT 20',
      req.params.id
    );

    res.json({
      ...vehicle,
      recentServices,
      upcomingMaintenance,
      kmLogs,
    });
  } catch (error) {
    console.error('Error fetching vehicle:', error.message);
    res.status(500).json({ error: 'Failed to fetch vehicle.' });
  }
});

/**
 * POST / - Create a new vehicle.
 */
router.post(
  '/',
  [body('name').trim().notEmpty().withMessage('Vehicle name is required.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const db = getDb();
      const id = uuidv4();
      const { name, make, model, year, type, plate, vin, currentKms, notes } = req.body;

      await db.run(
        `INSERT INTO vehicles (id, name, make, model, year, type, plate, vin, "currentKms", notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        name,
        make || null,
        model || null,
        year || null,
        type || 'car',
        plate || null,
        vin || null,
        currentKms || 0,
        notes || null
      );

      const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', id);
      res.status(201).json(vehicle);
    } catch (error) {
      console.error('Error creating vehicle:', error.message);
      res.status(500).json({ error: 'Failed to create vehicle.' });
    }
  }
);

/**
 * PUT /:id - Update a vehicle.
 */
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const existing = await db.get('SELECT * FROM vehicles WHERE id = ?', req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    const { name, make, model, year, type, plate, vin, currentKms, notes } = req.body;
    const now = new Date().toISOString();

    await db.run(
      `UPDATE vehicles
       SET name = ?, make = ?, model = ?, year = ?, type = ?, plate = ?, vin = ?,
           "currentKms" = ?, notes = ?, "updatedAt" = ?
       WHERE id = ?`,
      name !== undefined ? name : existing.name,
      make !== undefined ? make : existing.make,
      model !== undefined ? model : existing.model,
      year !== undefined ? year : existing.year,
      type !== undefined ? type : existing.type,
      plate !== undefined ? plate : existing.plate,
      vin !== undefined ? vin : existing.vin,
      currentKms !== undefined ? currentKms : existing.currentKms,
      notes !== undefined ? notes : existing.notes,
      now,
      req.params.id
    );

    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', req.params.id);
    res.json(vehicle);
  } catch (error) {
    console.error('Error updating vehicle:', error.message);
    res.status(500).json({ error: 'Failed to update vehicle.' });
  }
});

/**
 * DELETE /:id - Delete a vehicle and cascade delete related records.
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', req.params.id);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    // Delete associated invoice files
    const invoices = await db.all(
      `SELECT i."filePath" FROM invoices i
       JOIN service_records sr ON i."serviceRecordId" = sr.id
       WHERE sr."vehicleId" = ?`,
      req.params.id
    );

    for (const invoice of invoices) {
      await deleteFile('invoices', invoice.filePath);
    }

    // Delete vehicle photo
    if (vehicle.photo) {
      await deleteFile('vehicle-photos', vehicle.photo);
    }

    // CASCADE will handle service_records, invoices, reminder_configs, km_logs
    await db.run('DELETE FROM vehicles WHERE id = ?', req.params.id);

    res.json({ message: 'Vehicle deleted successfully.' });
  } catch (error) {
    console.error('Error deleting vehicle:', error.message);
    res.status(500).json({ error: 'Failed to delete vehicle.' });
  }
});

/**
 * PUT /:id/photo - Upload a vehicle photo.
 */
router.put('/:id/photo', singleUpload, async (req, res) => {
  try {
    const db = getDb();
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', req.params.id);

    if (!vehicle) {
      // Clean up uploaded file if vehicle not found
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided.' });
    }

    // Delete old photo if it exists
    if (vehicle.photo) {
      await deleteFile('vehicle-photos', vehicle.photo);
    }

    // Transfer to cloud with vehicle name for folder structure
    await transferToCloud([req.file], 'vehicle-photos', vehicle.name);

    const photoPath = req.file.cloudUrl || `/uploads/${req.file.filename}`;
    const now = new Date().toISOString();

    await db.run(
      `UPDATE vehicles SET photo = ?, "updatedAt" = ? WHERE id = ?`,
      photoPath, now, req.params.id
    );

    const updated = await db.get('SELECT * FROM vehicles WHERE id = ?', req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Error uploading photo:', error.message);
    res.status(500).json({ error: 'Failed to upload photo.' });
  }
});

/**
 * GET /:id/stats - Get vehicle statistics.
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const db = getDb();
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', req.params.id);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    const totalSpend = await db.get(
      'SELECT COALESCE(SUM(cost), 0) as total FROM service_records WHERE "vehicleId" = ?',
      req.params.id
    );

    const serviceCount = await db.get(
      'SELECT COUNT(*) as count FROM service_records WHERE "vehicleId" = ?',
      req.params.id
    );

    const avgCost = await db.get(
      'SELECT COALESCE(AVG(cost), 0) as average FROM service_records WHERE "vehicleId" = ? AND cost > 0',
      req.params.id
    );

    const costByCategory = await db.all(
      `SELECT c.name, COALESCE(SUM(sr.cost), 0) as total, COUNT(*) as count
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       WHERE sr."vehicleId" = ?
       GROUP BY c.id, c.name
       ORDER BY total DESC`,
      req.params.id
    );

    const recentServices = await db.all(
      `SELECT sr.date, sr.cost, c.name as "categoryName"
       FROM service_records sr
       JOIN categories c ON sr."categoryId" = c.id
       WHERE sr."vehicleId" = ?
       ORDER BY sr.date DESC
       LIMIT 5`,
      req.params.id
    );

    const firstService = await db.get(
      'SELECT MIN(date) as date FROM service_records WHERE "vehicleId" = ?',
      req.params.id
    );

    const lastService = await db.get(
      'SELECT MAX(date) as date FROM service_records WHERE "vehicleId" = ?',
      req.params.id
    );

    const last12Months = await db.get(
      `SELECT COALESCE(SUM(cost), 0) as total FROM service_records
       WHERE "vehicleId" = ? AND date >= date('now', '-12 months')`,
      req.params.id
    );

    res.json({
      vehicleId: req.params.id,
      vehicleName: vehicle.name,
      totalSpend: totalSpend.total,
      last12Months: last12Months.total,
      serviceCount: serviceCount.count,
      averageCost: Math.round(avgCost.average * 100) / 100,
      costByCategory,
      recentServices,
      firstServiceDate: firstService.date,
      lastServiceDate: lastService.date,
      currentKms: vehicle.currentKms,
    });
  } catch (error) {
    console.error('Error fetching vehicle stats:', error.message);
    res.status(500).json({ error: 'Failed to fetch vehicle statistics.' });
  }
});

module.exports = router;
