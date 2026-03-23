const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');
const { arrayUpload } = require('../middleware/upload');
const { processInvoice } = require('../services/ocr');
const { deleteFile, isCloudStorage, UPLOADS_DIR } = require('../services/storage');

const router = express.Router();

/**
 * POST /upload/:serviceRecordId - Upload one or more invoices.
 * Triggers OCR processing in the background for image files.
 */
router.post('/upload/:serviceRecordId', arrayUpload, async (req, res) => {
  try {
    const db = getDb();
    const { serviceRecordId } = req.params;

    // Verify service record exists
    const record = await db.get(
      'SELECT * FROM service_records WHERE id = ?',
      serviceRecordId
    );

    if (!record) {
      // Clean up uploaded files
      if (req.files) {
        for (const file of req.files) {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        }
      }
      return res.status(404).json({ error: 'Service record not found.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const invoices = [];

    for (const file of req.files) {
      const id = uuidv4();
      // If cloud storage, middleware set cloudUrl; otherwise use local path
      const filePath = file.cloudUrl || `/uploads/${file.filename}`;
      const ext = path.extname(file.originalname).toLowerCase();

      await db.run(
        `INSERT INTO invoices (id, "serviceRecordId", "filePath", "originalName", "fileType", "ocrProcessed")
         VALUES (?, ?, ?, ?, ?, 0)`,
        id, serviceRecordId, filePath, file.originalname, ext
      );

      invoices.push({
        id,
        serviceRecordId,
        filePath,
        originalName: file.originalname,
        fileType: ext,
        ocrProcessed: 0,
      });
    }

    // Trigger OCR processing in the background for each uploaded file
    for (const invoice of invoices) {
      // For OCR we need the local file path. If cloud storage, the temp file
      // may have been removed by middleware, so skip OCR in that case.
      const localPath = isCloudStorage
        ? null
        : path.join(UPLOADS_DIR, path.basename(invoice.filePath));

      if (localPath) {
        processInvoice(localPath)
          .then(async (text) => {
            if (text !== null) {
              await db.run(
                'UPDATE invoices SET "ocrText" = ?, "ocrProcessed" = 1 WHERE id = ?',
                text, invoice.id
              );
              console.log(`OCR complete for invoice ${invoice.id}`);
            } else {
              await db.run(
                'UPDATE invoices SET "ocrProcessed" = 1 WHERE id = ?',
                invoice.id
              );
            }
          })
          .catch(async (err) => {
            console.error(`OCR failed for invoice ${invoice.id}:`, err.message);
            await db.run(
              'UPDATE invoices SET "ocrProcessed" = 1 WHERE id = ?',
              invoice.id
            );
          });
      } else {
        // Mark as processed (no local file for OCR)
        db.run(
          'UPDATE invoices SET "ocrProcessed" = 1 WHERE id = ?',
          invoice.id
        ).catch(() => {});
      }
    }

    res.status(201).json({
      message: `${invoices.length} invoice(s) uploaded successfully. OCR processing started.`,
      invoices,
    });
  } catch (error) {
    console.error('Error uploading invoices:', error.message);
    res.status(500).json({ error: 'Failed to upload invoices.' });
  }
});

/**
 * GET /search - Full-text search across OCR text.
 * Query params: q (search query)
 */
router.get('/search', async (req, res) => {
  try {
    const db = getDb();
    const { q, vehicleId } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Search query (q) is required.' });
    }

    const searchTerm = `%${q.trim()}%`;
    let query = `SELECT i.*, sr.date as "serviceDate", sr."vehicleId",
              v.name as "vehicleName", c.name as "categoryName"
       FROM invoices i
       JOIN service_records sr ON i."serviceRecordId" = sr.id
       JOIN vehicles v ON sr."vehicleId" = v.id
       JOIN categories c ON sr."categoryId" = c.id
       WHERE i."ocrText" LIKE ?`;
    const params = [searchTerm];

    if (vehicleId) {
      query += ' AND sr."vehicleId" = ?';
      params.push(vehicleId);
    }

    query += ' ORDER BY i."uploadedAt" DESC';

    const results = await db.all(query, ...params);

    res.json(results);
  } catch (error) {
    console.error('Error searching invoices:', error.message);
    res.status(500).json({ error: 'Failed to search invoices.' });
  }
});

/**
 * GET /service/:serviceRecordId - Get all invoices for a service record.
 */
router.get('/service/:serviceRecordId', async (req, res) => {
  try {
    const db = getDb();

    const invoices = await db.all(
      'SELECT * FROM invoices WHERE "serviceRecordId" = ? ORDER BY "uploadedAt" DESC',
      req.params.serviceRecordId
    );

    res.json(invoices);
  } catch (error) {
    console.error('Error fetching invoices:', error.message);
    res.status(500).json({ error: 'Failed to fetch invoices.' });
  }
});

/**
 * GET /:id/download - Download the original invoice file.
 */
router.get('/:id/download', async (req, res) => {
  try {
    const db = getDb();
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    if (isCloudStorage) {
      // For cloud storage, redirect to the public URL
      return res.redirect(invoice.filePath);
    }

    const fullPath = path.join(UPLOADS_DIR, path.basename(invoice.filePath));

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Invoice file not found on disk.' });
    }

    res.download(fullPath, invoice.originalName || path.basename(invoice.filePath));
  } catch (error) {
    console.error('Error downloading invoice:', error.message);
    res.status(500).json({ error: 'Failed to download invoice.' });
  }
});

/**
 * GET /:id - Get invoice details.
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    res.json(invoice);
  } catch (error) {
    console.error('Error fetching invoice:', error.message);
    res.status(500).json({ error: 'Failed to fetch invoice.' });
  }
});

/**
 * DELETE /:id - Delete an invoice and its file.
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    // Delete file from storage
    await deleteFile('invoices', path.basename(invoice.filePath));

    await db.run('DELETE FROM invoices WHERE id = ?', req.params.id);
    res.json({ message: 'Invoice deleted successfully.' });
  } catch (error) {
    console.error('Error deleting invoice:', error.message);
    res.status(500).json({ error: 'Failed to delete invoice.' });
  }
});

module.exports = router;
