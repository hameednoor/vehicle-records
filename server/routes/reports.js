const express = require('express');
const { getDb, isPostgres, monthExtract } = require('../db/database');

const router = express.Router();

/**
 * GET /cost-by-vehicle - Cost breakdown by vehicle with optional date range filter.
 * Query params: startDate, endDate
 */
router.get('/cost-by-vehicle', async (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate) {
      dateFilter += ' AND sr.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      dateFilter += ' AND sr.date <= ?';
      params.push(endDate);
    }

    const results = await db.all(
      `SELECT v.id, v.name as "vehicleName", v.type,
              COALESCE(SUM(sr.cost), 0) as "totalCost",
              COUNT(sr.id) as "serviceCount",
              COALESCE(AVG(sr.cost), 0) as "averageCost",
              MIN(sr.date) as "firstService",
              MAX(sr.date) as "lastService"
       FROM vehicles v
       LEFT JOIN service_records sr ON sr."vehicleId" = v.id${dateFilter}
       GROUP BY v.id, v.name, v.type
       ORDER BY "totalCost" DESC`,
      ...params
    );

    const grandTotal = results.reduce((sum, r) => sum + Number(r.totalCost), 0);

    res.json({
      breakdown: results.map((r) => ({
        ...r,
        totalCost: Number(r.totalCost),
        averageCost: Math.round(Number(r.averageCost) * 100) / 100,
        serviceCount: Number(r.serviceCount),
        percentage: grandTotal > 0 ? Math.round((Number(r.totalCost) / grandTotal) * 10000) / 100 : 0,
      })),
      grandTotal,
      filters: { startDate: startDate || null, endDate: endDate || null },
    });
  } catch (error) {
    console.error('Error generating cost-by-vehicle report:', error.message);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

/**
 * GET /cost-by-category - Cost breakdown by category with optional date range filter.
 * Query params: startDate, endDate
 */
router.get('/cost-by-category', async (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate) {
      dateFilter += ' AND sr.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      dateFilter += ' AND sr.date <= ?';
      params.push(endDate);
    }

    const results = await db.all(
      `SELECT c.id, c.name as "categoryName",
              COALESCE(SUM(sr.cost), 0) as "totalCost",
              COUNT(sr.id) as "serviceCount",
              COALESCE(AVG(sr.cost), 0) as "averageCost"
       FROM categories c
       LEFT JOIN service_records sr ON sr."categoryId" = c.id${dateFilter}
       WHERE c."isArchived" = 0
       GROUP BY c.id, c.name
       HAVING COUNT(sr.id) > 0
       ORDER BY "totalCost" DESC`,
      ...params
    );

    const grandTotal = results.reduce((sum, r) => sum + Number(r.totalCost), 0);

    res.json({
      breakdown: results.map((r) => ({
        ...r,
        totalCost: Number(r.totalCost),
        averageCost: Math.round(Number(r.averageCost) * 100) / 100,
        serviceCount: Number(r.serviceCount),
        percentage: grandTotal > 0 ? Math.round((Number(r.totalCost) / grandTotal) * 10000) / 100 : 0,
      })),
      grandTotal,
      filters: { startDate: startDate || null, endDate: endDate || null },
    });
  } catch (error) {
    console.error('Error generating cost-by-category report:', error.message);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

/**
 * GET /monthly-trends - Monthly spend trends.
 * Query params: startDate, endDate, vehicleId
 */
router.get('/monthly-trends', async (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate, vehicleId } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (vehicleId) {
      whereClause += ' AND sr."vehicleId" = ?';
      params.push(vehicleId);
    }
    if (startDate) {
      whereClause += ' AND sr.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND sr.date <= ?';
      params.push(endDate);
    }

    const monthExpr = db.monthExtract('sr.date');

    const results = await db.all(
      `SELECT ${monthExpr} as month,
              COALESCE(SUM(sr.cost), 0) as "totalCost",
              COUNT(*) as "serviceCount"
       FROM service_records sr
       ${whereClause}
       GROUP BY ${monthExpr}
       ORDER BY month ASC`,
      ...params
    );

    res.json({
      trends: results.map((r) => ({
        ...r,
        totalCost: Number(r.totalCost),
        serviceCount: Number(r.serviceCount),
      })),
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        vehicleId: vehicleId || null,
      },
    });
  } catch (error) {
    console.error('Error generating monthly trends:', error.message);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

/**
 * GET /export/csv - Export service records as CSV.
 * Query params: startDate, endDate, vehicleId
 */
router.get('/export/csv', async (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate, vehicleId } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (vehicleId) {
      whereClause += ' AND sr."vehicleId" = ?';
      params.push(vehicleId);
    }
    if (startDate) {
      whereClause += ' AND sr.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND sr.date <= ?';
      params.push(endDate);
    }

    const records = await db.all(
      `SELECT sr.date, v.name as vehicle, c.name as category,
              sr."kmsAtService" as kms, sr.cost, sr.currency,
              sr.provider, sr.notes, sr."nextDueDate", sr."nextDueKms"
       FROM service_records sr
       JOIN vehicles v ON sr."vehicleId" = v.id
       JOIN categories c ON sr."categoryId" = c.id
       ${whereClause}
       ORDER BY sr.date DESC`,
      ...params
    );

    if (records.length === 0) {
      return res.status(404).json({ error: 'No records found for the given filters.' });
    }

    // Use json2csv to convert
    const { Parser } = require('json2csv');
    const fields = [
      'date',
      'vehicle',
      'category',
      'kms',
      'cost',
      'currency',
      'provider',
      'notes',
      'nextDueDate',
      'nextDueKms',
    ];
    const parser = new Parser({ fields });
    const csv = parser.parse(records);

    const filename = `service-records-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting CSV:', error.message);
    res.status(500).json({ error: 'Failed to export CSV.' });
  }
});

/**
 * GET /export/pdf - Export report as PDF using PDFKit.
 * Query params: startDate, endDate, vehicleId
 */
router.get('/export/pdf', async (req, res) => {
  try {
    const db = getDb();
    const PDFDocument = require('pdfkit');
    const { startDate, endDate, vehicleId } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (vehicleId) {
      whereClause += ' AND sr."vehicleId" = ?';
      params.push(vehicleId);
    }
    if (startDate) {
      whereClause += ' AND sr.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND sr.date <= ?';
      params.push(endDate);
    }

    const records = await db.all(
      `SELECT sr.date, v.name as vehicle, c.name as category,
              sr."kmsAtService" as kms, sr.cost, sr.currency,
              sr.provider, sr.notes
       FROM service_records sr
       JOIN vehicles v ON sr."vehicleId" = v.id
       JOIN categories c ON sr."categoryId" = c.id
       ${whereClause}
       ORDER BY sr.date DESC`,
      ...params
    );

    // Cost summary by vehicle
    const vehicleSummary = await db.all(
      `SELECT v.name as "vehicleName",
              COALESCE(SUM(sr.cost), 0) as "totalCost",
              COUNT(sr.id) as "serviceCount"
       FROM vehicles v
       LEFT JOIN service_records sr ON sr."vehicleId" = v.id ${whereClause.replace('WHERE 1=1', '')}
       GROUP BY v.id, v.name
       HAVING COUNT(sr.id) > 0
       ORDER BY "totalCost" DESC`,
      ...params
    );

    const grandTotal = vehicleSummary.reduce((sum, v) => sum + Number(v.totalCost), 0);

    // Get settings for currency
    const settings = await db.get('SELECT currency FROM settings WHERE id = 1');
    const currency = settings ? settings.currency : 'AED';

    // Build PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `vehicle-maintenance-report-${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Header
    doc
      .rect(0, 0, doc.page.width, 80)
      .fill('#1B4F72');

    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor('#FFFFFF')
      .text('Vehicle Maintenance Report', 50, 28);

    doc.moveDown(2);
    doc.y = 100;

    // Subtitle with date range
    doc.fillColor('#333333');
    let subtitle = 'All Time';
    if (startDate && endDate) {
      subtitle = `${startDate} to ${endDate}`;
    } else if (startDate) {
      subtitle = `From ${startDate}`;
    } else if (endDate) {
      subtitle = `Until ${endDate}`;
    }
    doc.fontSize(12).font('Helvetica').text(`Report Period: ${subtitle}`, 50);
    doc.text(`Generated: ${new Date().toISOString().split('T')[0]}`, 50);
    doc.moveDown(1);

    // Summary section
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#1B4F72')
      .text('Cost Summary by Vehicle', 50);
    doc.moveDown(0.5);

    // Draw summary table
    const colWidths = [200, 100, 100, 95];
    const headers = ['Vehicle', 'Services', `Total (${currency})`, 'Avg Cost'];

    // Table header row
    doc.rect(50, doc.y, 495, 22).fill('#1B4F72');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
    let xPos = 55;
    headers.forEach((header, i) => {
      doc.text(header, xPos, doc.y + 5, { width: colWidths[i], align: i === 0 ? 'left' : 'right' });
      xPos += colWidths[i];
    });
    doc.y += 22;

    // Table rows
    doc.fillColor('#333333').font('Helvetica').fontSize(10);
    vehicleSummary.forEach((v, index) => {
      const rowY = doc.y;
      if (index % 2 === 0) {
        doc.rect(50, rowY, 495, 20).fill('#F4F6F7');
      }
      doc.fillColor('#333333');
      const totalCost = Number(v.totalCost);
      const svcCount = Number(v.serviceCount);
      const avgCost = svcCount > 0 ? Math.round(totalCost / svcCount) : 0;

      let x = 55;
      doc.text(v.vehicleName, x, rowY + 5, { width: colWidths[0] });
      x += colWidths[0];
      doc.text(svcCount.toString(), x, rowY + 5, { width: colWidths[1], align: 'right' });
      x += colWidths[1];
      doc.text(totalCost.toLocaleString(), x, rowY + 5, { width: colWidths[2], align: 'right' });
      x += colWidths[2];
      doc.text(avgCost.toLocaleString(), x, rowY + 5, { width: colWidths[3], align: 'right' });
      doc.y = rowY + 20;
    });

    // Grand total
    doc.rect(50, doc.y, 495, 22).fill('#1B4F72');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold');
    doc.text('Grand Total', 55, doc.y + 5, { width: colWidths[0] });
    doc.text(
      grandTotal.toLocaleString(),
      55 + colWidths[0] + colWidths[1],
      doc.y + 5,
      { width: colWidths[2], align: 'right' }
    );
    doc.y += 30;

    // Service records detail
    if (records.length > 0) {
      doc.moveDown(1);

      // Check if we need a new page
      if (doc.y > 650) {
        doc.addPage();
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#1B4F72')
        .text('Service Record Details', 50);
      doc.moveDown(0.5);

      const detailCols = [70, 130, 100, 70, 70, 55];
      const detailHeaders = ['Date', 'Vehicle', 'Category', 'KMs', `Cost`, 'Provider'];

      doc.rect(50, doc.y, 495, 22).fill('#1B4F72');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
      let dx = 55;
      detailHeaders.forEach((header, i) => {
        doc.text(header, dx, doc.y + 5, { width: detailCols[i] });
        dx += detailCols[i];
      });
      doc.y += 22;

      doc.fillColor('#333333').font('Helvetica').fontSize(9);

      // Limit records to avoid excessively long PDFs
      const maxRecords = Math.min(records.length, 100);
      for (let i = 0; i < maxRecords; i++) {
        const r = records[i];

        // New page if needed
        if (doc.y > 740) {
          doc.addPage();
          doc.y = 50;
        }

        const rowY = doc.y;
        if (i % 2 === 0) {
          doc.rect(50, rowY, 495, 18).fill('#F4F6F7');
        }
        doc.fillColor('#333333');

        let rx = 55;
        doc.text(r.date || '', rx, rowY + 4, { width: detailCols[0] });
        rx += detailCols[0];
        doc.text(truncate(r.vehicle, 22), rx, rowY + 4, { width: detailCols[1] });
        rx += detailCols[1];
        doc.text(truncate(r.category, 16), rx, rowY + 4, { width: detailCols[2] });
        rx += detailCols[2];
        doc.text(r.kms ? Number(r.kms).toLocaleString() : '-', rx, rowY + 4, { width: detailCols[3] });
        rx += detailCols[3];
        doc.text(r.cost ? Number(r.cost).toLocaleString() : '0', rx, rowY + 4, { width: detailCols[4] });
        rx += detailCols[4];
        doc.text(truncate(r.provider || '-', 10), rx, rowY + 4, { width: detailCols[5] });

        doc.y = rowY + 18;
      }

      if (records.length > maxRecords) {
        doc.moveDown(0.5);
        doc
          .font('Helvetica-Oblique')
          .fontSize(10)
          .fillColor('#5D6D7E')
          .text(`... and ${records.length - maxRecords} more records (use CSV export for full data).`, 50);
      }
    }

    // Footer
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#999999')
      .text(
        'Generated by Vehicle Maintenance Tracker',
        50,
        doc.page.height - 40,
        { align: 'center', width: doc.page.width - 100 }
      );

    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error.message);
    res.status(500).json({ error: 'Failed to generate PDF report.' });
  }
});

/**
 * Truncate a string to a max length.
 */
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

module.exports = router;
