const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { getDb } = require('../db/database');
const { upload } = require('../middleware/upload');
const { analyzeOdometer } = require('../services/ocr');

const router = express.Router();

/**
 * POST /analyze-odometer - Upload an odometer photo and extract the reading via Gemini AI.
 * Returns { reading, candidates }
 */
router.post('/analyze-odometer', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const currentKms = Number(req.body.currentKms) || 0;
    const result = await analyzeOdometer(req.file.path, currentKms);

    // Clean up temp file
    try {
      fs.unlinkSync(req.file.path);
    } catch { /* ignore */ }

    res.json({
      reading: result.reading,
      candidates: result.candidates,
    });
  } catch (error) {
    console.error('Error analyzing odometer:', error.message);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    res.status(500).json({ error: 'Failed to analyze odometer image.' });
  }
});

/**
 * POST / - Log a new KM reading for a vehicle.
 * Also updates the vehicle's currentKms to the new reading.
 */
router.post(
  '/',
  [
    body('vehicleId').trim().notEmpty().withMessage('Vehicle ID is required.'),
    body('kms')
      .isNumeric()
      .withMessage('KMs must be a number.')
      .custom((value) => value > 0)
      .withMessage('KMs must be greater than 0.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const db = getDb();
      const { vehicleId, kms } = req.body;

      // Verify vehicle exists
      const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: 'Vehicle not found.' });
      }

      const id = uuidv4();

      await db.run(
        'INSERT INTO km_logs (id, "vehicleId", kms) VALUES (?, ?, ?)',
        id, vehicleId, kms
      );

      // Update vehicle currentKms only if the new reading is higher
      const now = new Date().toISOString();
      if (kms > (vehicle.currentKms || 0)) {
        await db.run(
          `UPDATE vehicles SET "currentKms" = ?, "updatedAt" = ? WHERE id = ?`,
          kms, now, vehicleId
        );
      }

      const log = await db.get('SELECT * FROM km_logs WHERE id = ?', id);

      res.status(201).json({
        ...log,
        vehicleName: vehicle.name,
        previousKms: vehicle.currentKms,
      });
    } catch (error) {
      console.error('Error logging KMs:', error.message);
      res.status(500).json({ error: 'Failed to log KM reading.' });
    }
  }
);

/**
 * GET /vehicle/:vehicleId - Get KM log history for a vehicle.
 */
router.get('/vehicle/:vehicleId', async (req, res) => {
  try {
    const db = getDb();

    // Verify vehicle exists
    const vehicle = await db.get(
      'SELECT id, name, "currentKms" FROM vehicles WHERE id = ?',
      req.params.vehicleId
    );

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    const logs = await db.all(
      'SELECT * FROM km_logs WHERE "vehicleId" = ? ORDER BY "loggedAt" DESC',
      req.params.vehicleId
    );

    res.json({
      vehicle,
      logs,
    });
  } catch (error) {
    console.error('Error fetching KM logs:', error.message);
    res.status(500).json({ error: 'Failed to fetch KM logs.' });
  }
});

module.exports = router;
