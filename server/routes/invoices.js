const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');
const { arrayUpload, transferToCloud } = require('../middleware/upload');
const { processInvoice, analyzeInvoice, parseInvoiceText } = require('../services/ocr');
const { deleteFile, isCloudStorage, getDrive, extractGoogleDriveFileId, UPLOADS_DIR } = require('../services/storage');
const { upload } = require('../middleware/upload');

const router = express.Router();

/**
 * POST /analyze - Upload a single invoice image and extract data via Gemini AI.
 * Returns { cost, currency, provider, rawText } without creating any DB records.
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
      provider: result.provider || null,
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
      await new Promise((r) => setTimeout(r, 500));
      record = await db.get(
        'SELECT * FROM service_records WHERE id = ?',
        serviceRecordId
      );
    }

    if (!record) {
      console.error(`Invoice upload: service record '${serviceRecordId}' not found in DB`);
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

    // Look up vehicle name for Google Drive folder structure
    const vehicle = await db.get(
      'SELECT name FROM vehicles WHERE id = ?',
      record.vehicleId
    );
    const vehicleName = vehicle?.name || 'General';

    // Run OCR on local temp files BEFORE transferring to cloud
    const ocrResults = {};
    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        try {
          const text = await processInvoice(file.path);
          if (text) {
            const { cost, currency } = parseInvoiceText(text);
            ocrResults[file.filename] = { text, cost, currency };
          }
        } catch (err) {
          console.error(`OCR failed for ${file.originalname}:`, err.message);
        }
      }
    }

    // Transfer to Google Drive (or other cloud) with vehicle name
    await transferToCloud(req.files, 'invoices', vehicleName);

    const invoices = [];

    for (const file of req.files) {
      const id = uuidv4();
      const filePath = file.cloudUrl || `/uploads/${file.filename}`;
      const ext = path.extname(file.originalname).toLowerCase();
      const ocr = ocrResults[file.filename];

      await db.run(
        `INSERT INTO invoices (id, "serviceRecordId", "filePath", "originalName", "fileType",
         "ocrProcessed", "ocrText", "ocrCost", "ocrCurrency")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, serviceRecordId, filePath, file.originalname, ext,
        1,
        ocr?.text || null,
        ocr?.cost || null,
        ocr?.currency || null
      );

      invoices.push({
        id,
        serviceRecordId,
        filePath,
        originalName: file.originalname,
        fileType: ext,
        ocrProcessed: 1,
      });

      if (ocr) {
        console.log(`OCR complete for invoice ${id}: cost=${ocr.cost}, currency=${ocr.currency}`);
      }
    }

    // Auto-populate service record cost from OCR if no manual cost
    try {
      const currentRecord = await db.get(
        'SELECT cost, currency FROM service_records WHERE id = ?',
        serviceRecordId
      );

      if (currentRecord && (!currentRecord.cost || Number(currentRecord.cost) === 0)) {
        const costSum = await db.get(
          `SELECT COALESCE(SUM("ocrCost"), 0) as total FROM invoices
           WHERE "serviceRecordId" = ? AND "ocrCost" IS NOT NULL AND "ocrCost" > 0`,
          serviceRecordId
        );

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
      console.error('Failed to update service record with combined invoice costs:', err.message);
    }

    const ocrCount = Object.keys(ocrResults).length;
    res.status(201).json({
      message: `${invoices.length} invoice(s) uploaded successfully.${ocrCount > 0 ? ` OCR extracted cost from ${ocrCount} file(s).` : ''}`,
      invoices,
    });
  } catch (error) {
    console.error('Error uploading invoices:', error.message);
    res.status(500).json({ error: 'Failed to upload invoices.' });
  }
});

/**
 * GET /search - Full-text search across OCR text.
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
 * For Google Drive: streams file via Drive API to avoid CORS/interstitial issues.
 */
router.get('/:id/download', async (req, res) => {
  try {
    const db = getDb();
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    // Determine MIME type from file extension for proper inline display
    const filename = invoice.originalName || 'invoice';
    const ext = (invoice.fileType || path.extname(filename) || '').toLowerCase().replace(/^\./, '');
    const mimeTypes = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
      bmp: 'image/bmp', tiff: 'image/tiff', pdf: 'application/pdf',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    if (isCloudStorage) {
      const fileId = extractGoogleDriveFileId(invoice.filePath);
      if (fileId) {
        const drive = getDrive();
        const response = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'stream' }
        );
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Type', response.headers['content-type'] || mimeType);
        response.data.pipe(res);
        return;
      }
      // Fallback: redirect to stored URL
      return res.redirect(invoice.filePath);
    }

    const fullPath = path.join(UPLOADS_DIR, path.basename(invoice.filePath));

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Invoice file not found on disk.' });
    }

    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.sendFile(fullPath);
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

    const serviceRecordId = invoice.serviceRecordId;

    // Delete file from storage (pass full URL for Google Drive)
    await deleteFile('invoices', invoice.filePath);

    await db.run('DELETE FROM invoices WHERE id = ?', req.params.id);

    // Recalculate service record cost from remaining invoices
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
