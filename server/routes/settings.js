const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

/**
 * GET / - Get current settings.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    let settings = await db.get('SELECT * FROM settings WHERE id = 1');

    if (!settings) {
      // Create default settings if they don't exist
      await db.run(
        `INSERT INTO settings (id, currency, timezone, emails, "whatsappNumber", "whatsappApiKey", "reminderBufferKms", "reminderBufferDays")
         VALUES (1, 'AED', 'Asia/Dubai', '[]', NULL, NULL, 500, 7)`
      );
      settings = await db.get('SELECT * FROM settings WHERE id = 1');
    }

    res.json({
      ...settings,
      emails: safeParseJson(settings.emails, []),
    });
  } catch (error) {
    console.error('Error fetching settings:', error.message);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

/**
 * PUT / - Update settings.
 */
router.put('/', async (req, res) => {
  try {
    const db = getDb();
    let existing = await db.get('SELECT * FROM settings WHERE id = 1');

    if (!existing) {
      await db.run(
        `INSERT INTO settings (id, currency, timezone, emails, "whatsappNumber", "whatsappApiKey", "reminderBufferKms", "reminderBufferDays")
         VALUES (1, 'AED', 'Asia/Dubai', '[]', NULL, NULL, 500, 7)`
      );
      existing = await db.get('SELECT * FROM settings WHERE id = 1');
    }

    const { currency, timezone, emails, whatsappNumber, whatsappApiKey, reminderBufferKms, reminderBufferDays } =
      req.body;

    const emailsJson =
      emails !== undefined ? JSON.stringify(emails) : existing.emails;

    const now = new Date().toISOString();

    await db.run(
      `UPDATE settings
       SET currency = ?, timezone = ?, emails = ?, "whatsappNumber" = ?,
           "whatsappApiKey" = ?, "reminderBufferKms" = ?, "reminderBufferDays" = ?, "updatedAt" = ?
       WHERE id = 1`,
      currency !== undefined ? currency : existing.currency,
      timezone !== undefined ? timezone : existing.timezone,
      emailsJson,
      whatsappNumber !== undefined ? whatsappNumber : existing.whatsappNumber,
      whatsappApiKey !== undefined ? whatsappApiKey : existing.whatsappApiKey,
      reminderBufferKms !== undefined ? reminderBufferKms : existing.reminderBufferKms,
      reminderBufferDays !== undefined ? reminderBufferDays : existing.reminderBufferDays,
      now
    );

    const updated = await db.get('SELECT * FROM settings WHERE id = 1');
    res.json({
      ...updated,
      emails: safeParseJson(updated.emails, []),
    });
  } catch (error) {
    console.error('Error updating settings:', error.message);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

/**
 * GET /export - Export all data as JSON.
 */
router.get('/export', async (req, res) => {
  try {
    const db = getDb();

    const data = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      vehicles: await db.all('SELECT * FROM vehicles'),
      categories: await db.all('SELECT * FROM categories'),
      serviceRecords: await db.all('SELECT * FROM service_records'),
      invoices: await db.all('SELECT * FROM invoices'),
      reminderConfigs: await db.all('SELECT * FROM reminder_configs'),
      kmLogs: await db.all('SELECT * FROM km_logs'),
      settings: await db.get('SELECT * FROM settings WHERE id = 1'),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="vehicle-tracker-export-${new Date().toISOString().split('T')[0]}.json"`
    );
    res.json(data);
  } catch (error) {
    console.error('Error exporting data:', error.message);
    res.status(500).json({ error: 'Failed to export data.' });
  }
});

/**
 * POST /import - Import data from JSON.
 * Expects the same format as the export endpoint.
 */
router.post('/import', async (req, res) => {
  try {
    const db = getDb();
    const data = req.body;

    if (!data || !data.version) {
      return res.status(400).json({ error: 'Invalid import data format.' });
    }

    const counts = {
      vehicles: 0,
      categories: 0,
      serviceRecords: 0,
      invoices: 0,
      reminderConfigs: 0,
      kmLogs: 0,
    };

    // Wrap the entire import in a transaction for atomicity - if any step
    // fails, the database is left unchanged rather than partially imported.
    await db.transaction(async (tx) => {
      // Import categories (skip existing records — never overwrite user data)
      if (data.categories && Array.isArray(data.categories)) {
        const sql = db.insertIgnoreSql(
          `INSERT OR IGNORE INTO categories (id, name, "isDefault", "isArchived", "defaultKms", "defaultDays", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const cat of data.categories) {
          const result = await tx.run(sql, cat.id, cat.name, cat.isDefault, cat.isArchived,
            cat.defaultKms || null, cat.defaultDays || null, cat.createdAt);
          if (result && result.changes > 0) counts.categories++;
        }
      }

      // Import vehicles (skip existing)
      if (data.vehicles && Array.isArray(data.vehicles)) {
        const sql = db.insertIgnoreSql(
          `INSERT OR IGNORE INTO vehicles
           (id, name, make, model, year, type, plate, vin, "currentKms", photo, notes, "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const v of data.vehicles) {
          const result = await tx.run(
            sql,
            v.id, v.name, v.make, v.model, v.year, v.type, v.plate, v.vin,
            v.currentKms, v.photo, v.notes, v.createdAt, v.updatedAt
          );
          if (result && result.changes > 0) counts.vehicles++;
        }
      }

      // Import service records (skip existing)
      if (data.serviceRecords && Array.isArray(data.serviceRecords)) {
        const sql = db.insertIgnoreSql(
          `INSERT OR IGNORE INTO service_records
           (id, "vehicleId", "categoryId", date, "kmsAtService", cost, currency, provider, notes,
            "nextDueKms", "nextDueDays", "nextDueDate", "originalCost", "originalCurrency", "exchangeRate", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const sr of data.serviceRecords) {
          const result = await tx.run(
            sql,
            sr.id, sr.vehicleId, sr.categoryId, sr.date, sr.kmsAtService,
            sr.cost, sr.currency, sr.provider, sr.notes, sr.nextDueKms,
            sr.nextDueDays, sr.nextDueDate, sr.originalCost || null,
            sr.originalCurrency || null, sr.exchangeRate || null, sr.createdAt
          );
          if (result && result.changes > 0) counts.serviceRecords++;
        }
      }

      // Import invoices (skip existing — metadata only, files must be copied separately)
      if (data.invoices && Array.isArray(data.invoices)) {
        const sql = db.insertIgnoreSql(
          `INSERT OR IGNORE INTO invoices
           (id, "serviceRecordId", "filePath", "originalName", "fileType", "ocrText", "ocrProcessed", "uploadedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const inv of data.invoices) {
          const result = await tx.run(
            sql,
            inv.id, inv.serviceRecordId, inv.filePath, inv.originalName,
            inv.fileType, inv.ocrText, inv.ocrProcessed, inv.uploadedAt
          );
          if (result && result.changes > 0) counts.invoices++;
        }
      }

      // Import reminder configs (skip existing)
      if (data.reminderConfigs && Array.isArray(data.reminderConfigs)) {
        const sql = db.insertIgnoreSql(
          `INSERT OR IGNORE INTO reminder_configs
           (id, "vehicleId", type, channel, frequency, recipients, "isActive", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const rc of data.reminderConfigs) {
          const result = await tx.run(
            sql,
            rc.id, rc.vehicleId, rc.type, rc.channel, rc.frequency,
            rc.recipients, rc.isActive, rc.createdAt
          );
          if (result && result.changes > 0) counts.reminderConfigs++;
        }
      }

      // Import KM logs (skip existing)
      if (data.kmLogs && Array.isArray(data.kmLogs)) {
        const sql = db.insertIgnoreSql(
          `INSERT OR IGNORE INTO km_logs (id, "vehicleId", kms, "loggedAt")
           VALUES (?, ?, ?, ?)`
        );
        for (const log of data.kmLogs) {
          const result = await tx.run(sql, log.id, log.vehicleId, log.kms, log.loggedAt);
          if (result && result.changes > 0) counts.kmLogs++;
        }
      }

      // Import settings (only if no settings exist yet)
      if (data.settings) {
        const existing = await tx.get('SELECT id FROM settings WHERE id = 1');
        if (!existing) {
          const s = data.settings;
          const now = new Date().toISOString();
          await tx.run(
            `INSERT INTO settings
             (id, currency, timezone, emails, "whatsappNumber", "reminderBufferKms", "reminderBufferDays", "createdAt", "updatedAt")
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
            s.currency, s.timezone, s.emails, s.whatsappNumber,
            s.reminderBufferKms, s.reminderBufferDays, s.createdAt, now
          );
        }
      }
    });

    res.json({
      message: 'Data imported successfully.',
      imported: counts,
    });
  } catch (error) {
    console.error('Error importing data:', error.message);
    res.status(500).json({ error: `Failed to import data: ${error.message}` });
  }
});

/**
 * Safely parse a JSON string.
 */
function safeParseJson(str, defaultValue) {
  try {
    return JSON.parse(str || JSON.stringify(defaultValue));
  } catch {
    return defaultValue;
  }
}

module.exports = router;
