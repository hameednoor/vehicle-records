const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');
const { arrayUpload } = require('../middleware/upload');
const { processInvoice, analyzeInvoice, parseInvoiceText } = require('../services/ocr');
const { deleteFile, isCloudStorage, UPLOADS_DIR } = require('../services/storage');
const { upload } = require('../middleware/upload');

const router = express.Router();

/**
 * POST /analyze - Upload a single invoice image and extract cost + currency via OCR.
 * Returns { cost, currency, rawText } without creating any DB records.
 */
router.post('/analyze', upload.single('invoice'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const result = await analyzeInvoice(req.file.path);

    // Clean up the temp file
    try {
      fs.unlinkSync(req.file.path);
    } catch { /* ignore */ }

    res.json({
      cost: result.cost,
      currency: result.currency,
      rawText: result.rawText,
    });
  } catch (error) {
    console.error('Error analyzing invoice:', error.message);
    // Clean up on error
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    res.status(500).json({ error: 'Failed to analyze invoice.' });
  }
});

/**
 * POST /upload/:serviceRecordId - Upload one or more invoices.
 * Triggers OCR processing in the background for image files.
 */
router.post('/upload/:serviceRecordId', arrayUpload, async (req, res) => {
  try {
    const db = getDb();
    const { serviceRecordId } = req.params;

    // Verify service record exists (retry once after short delay for DB pooling)
    let record = await db.get(
      'SELECT * FROM service_records WHERE id = ?',
      serviceRecordId
    );

    if (!record) {
      // Retry after a brief delay (connection pooling can cause momentary invisibility)
      await new Promise((r) => setTimeout(r, 500));
      record = await db.get(
        'SELECT * FROM service_records WHERE id = ?',
        serviceRecordId
      );
    }

    if (!record) {
      console.error(`Invoice upload: service record '${serviceRecordId}' not found in DB`);
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

    // Track how many invoices need OCR so we can update the service record
    // with combined totals after all are processed.
    let pendingOcr = 0;
    let completedOcr = 0;

    /**
     * After all invoices in this batch have been OCR-processed,
     * sum their extracted costs and update the service record
     * (only if the service record has no manually-entered cost).
     */
    async function onAllOcrComplete() {
      try {
        // Re-fetch the service record to check current cost
        const currentRecord = await db.get(
          'SELECT cost, currency FROM service_records WHERE id = ?',
          serviceRecordId
        );

        // Only auto-populate if cost is 0 or null (user hasn't manually entered a cost)
        if (currentRecord && (!currentRecord.cost || Number(currentRecord.cost) === 0)) {
          // Sum all OCR-extracted costs for invoices in this service record
          const costSum = await db.get(
            `SELECT COALESCE(SUM("ocrCost"), 0) as total FROM invoices
             WHERE "serviceRecordId" = ? AND "ocrCost" IS NOT NULL AND "ocrCost" > 0`,
            serviceRecordId
          );

          // Use the currency from the first invoice that has one detected
          const currencyRow = await db.get(
            `SELECT "ocrCurrency" FROM invoices
             WHERE "serviceRecordId" = ? AND "ocrCurrency" IS NOT NULL
             ORDER BY "uploadedAt" ASC LIMIT 1`,
            serviceRecordId
          );

          const totalCost = Number(costSum.total);
          if (totalCost > 0) {
            const currency = currencyRow ? currencyRow.ocrCurrency : null;
            const updateFields = ['cost = ?'];
            const updateParams = [totalCost];

            if (currency) {
              updateFields.push('currency = ?');
              updateParams.push(currency);
            }

            updateParams.push(serviceRecordId);
            await db.run(
              `UPDATE service_records SET ${updateFields.join(', ')} WHERE id = ?`,
              ...updateParams
            );
            console.log(`Auto-populated service record ${serviceRecordId}: cost=${totalCost}, currency=${currency || 'unchanged'}`);
          }
        }
      } catch (err) {
        console.error(`Failed to update service record with combined invoice costs:`, err.message);
      }
    }

    // Trigger OCR processing in the background for each uploaded file
    for (const invoice of invoices) {
      // For OCR we need the local file path. If cloud storage, the temp file
      // may have been removed by middleware, so skip OCR in that case.
      const localPath = isCloudStorage
        ? null
        : path.join(UPLOADS_DIR, path.basename(invoice.filePath));

      if (localPath) {
        pendingOcr++;
        processInvoice(localPath)
          .then(async (text) => {
            if (text !== null) {
              // Parse the OCR text to extract cost and currency
              const { cost, currency } = parseInvoiceText(text);

              await db.run(
                `UPDATE invoices SET "ocrText" = ?, "ocrProcessed" = 1,
                 "ocrCost" = ?, "ocrCurrency" = ? WHERE id = ?`,
                text, cost, currency, invoice.id
              );
              console.log(`OCR complete for invoice ${invoice.id}: cost=${cost}, currency=${currency}`);
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
          })
          .finally(async () => {
            completedOcr++;
            if (completedOcr >= pendingOcr) {
              await onAllOcrComplete();
            }
          });
      } else {
        // Mark as processed (no local file for OCR)
        db.run(
          'UPDATE invoices SET "ocrProcessed" = 1 WHERE id = ?',
          invoice.id
        ).catch(() => {});
      }
    }

    // If no invoices needed OCR (e.g., all PDFs), still respond immediately
    res.status(201).json({
      message: `${invoices.length} invoice(s) uploaded successfully.${pendingOcr > 0 ? ' OCR processing started - cost will be auto-populated.' : ''}`,
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
 * After deletion, recalculates the service record cost from remaining invoices.
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    const serviceRecordId = invoice.serviceRecordId;

    // Delete file from storage
    await deleteFile('invoices', path.basename(invoice.filePath));

    await db.run('DELETE FROM invoices WHERE id = ?', req.params.id);

    // Recalculate service record cost from remaining invoices with OCR data
    try {
      const remaining = await db.all(
        'SELECT "ocrCost" FROM invoices WHERE "serviceRecordId" = ? AND "ocrCost" IS NOT NULL AND "ocrCost" > 0',
        serviceRecordId
      );
      if (remaining.length > 0) {
        const newTotal = remaining.reduce((sum, inv) => sum + inv.ocrCost, 0);
        await db.run(
          'UPDATE service_records SET cost = ? WHERE id = ?',
          Math.round(newTotal * 100) / 100, serviceRecordId
        );
      }
    } catch { /* ignore recalculation errors */ }

    res.json({ message: 'Invoice deleted successfully.' });
  } catch (error) {
    console.error('Error deleting invoice:', error.message);
    res.status(500).json({ error: 'Failed to delete invoice.' });
  }
});

module.exports = router;
