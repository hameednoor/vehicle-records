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
              sr.provider, sr.notes, sr."nextDueDate", sr."nextDueKms"
       FROM service_records sr
       JOIN vehicles v ON sr."vehicleId" = v.id
       JOIN categories c ON sr."categoryId" = c.id
       ${whereClause}
       ORDER BY v.name ASC, sr.date DESC`,
      ...params
    );

    // Cost summary by vehicle
    const vehicleSummary = await db.all(
      `SELECT v.name as "vehicleName", v.make, v.model, v.year, v."currentKms",
              COALESCE(SUM(sr.cost), 0) as "totalCost",
              COUNT(sr.id) as "serviceCount",
              MIN(sr.date) as "firstService",
              MAX(sr.date) as "lastService"
       FROM vehicles v
       LEFT JOIN service_records sr ON sr."vehicleId" = v.id ${whereClause.replace('WHERE 1=1', '')}
       GROUP BY v.id, v.name, v.make, v.model, v.year, v."currentKms"
       HAVING COUNT(sr.id) > 0
       ORDER BY "totalCost" DESC`,
      ...params
    );

    // Cost by category
    const categorySummary = await db.all(
      `SELECT c.name as "categoryName",
              COALESCE(SUM(sr.cost), 0) as "totalCost",
              COUNT(sr.id) as "serviceCount"
       FROM categories c
       JOIN service_records sr ON sr."categoryId" = c.id
       ${whereClause.replace('WHERE 1=1 AND', 'WHERE').replace('WHERE 1=1', '')}
       GROUP BY c.id, c.name
       HAVING COUNT(sr.id) > 0
       ORDER BY "totalCost" DESC`,
      ...params
    );

    const grandTotal = vehicleSummary.reduce((sum, v) => sum + Number(v.totalCost), 0);
    const totalServices = vehicleSummary.reduce((sum, v) => sum + Number(v.serviceCount), 0);

    // Get settings for currency
    const settings = await db.get('SELECT currency FROM settings WHERE id = 1');
    const currency = settings ? settings.currency : 'AED';

    const today = new Date().toISOString().split('T')[0];

    // Build PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const filename = `vehicle-maintenance-report-${today}.pdf`;
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 80; // 40px margin each side

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // ── Helper functions ──
    function drawTableHeader(cols, headers, y) {
      doc.rect(40, y, contentWidth, 26).fill('#1B4F72');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
      let x = 45;
      headers.forEach((header, i) => {
        const align = i === 0 ? 'left' : 'right';
        doc.text(header, x, y + 7, { width: cols[i], align });
        x += cols[i];
      });
      return y + 26;
    }

    function drawTableRow(cols, values, y, striped, aligns) {
      if (striped) {
        doc.rect(40, y, contentWidth, 22).fill('#F0F4F8');
      }
      doc.fillColor('#2C3E50').font('Helvetica').fontSize(10);
      let x = 45;
      values.forEach((val, i) => {
        const align = aligns ? aligns[i] : (i === 0 ? 'left' : 'right');
        doc.text(val, x, y + 6, { width: cols[i], align });
        x += cols[i];
      });
      return y + 22;
    }

    function drawSectionTitle(title, y) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#1B4F72');
      doc.text(title, 40, y);
      // underline
      doc.moveTo(40, y + 20).lineTo(40 + contentWidth, y + 20).strokeColor('#BDC3C7').lineWidth(0.5).stroke();
      return y + 30;
    }

    function checkPage(y, needed) {
      if (y + needed > 760) { doc.addPage(); return 50; }
      return y;
    }

    function addPageFooter() {
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(8).fillColor('#95A5A6');
        doc.text(
          `Vehicle Maintenance Tracker  |  Generated ${today}  |  Page ${i + 1} of ${pages.count}`,
          40, doc.page.height - 30,
          { align: 'center', width: contentWidth }
        );
      }
    }

    // ══════════════════════════════════════════════════════════
    // PAGE 1: HEADER
    // ══════════════════════════════════════════════════════════

    // Dark header band
    doc.rect(0, 0, pageWidth, 100).fill('#1B4F72');

    doc.font('Helvetica-Bold').fontSize(26).fillColor('#FFFFFF');
    doc.text('Vehicle Maintenance Report', 40, 25);

    // Subtitle line
    let subtitle = 'Report Period: All Time';
    if (startDate && endDate) {
      subtitle = `Report Period: ${startDate} to ${endDate}`;
    } else if (startDate) {
      subtitle = `Report Period: From ${startDate}`;
    } else if (endDate) {
      subtitle = `Report Period: Until ${endDate}`;
    }
    doc.font('Helvetica').fontSize(12).fillColor('#AED6F1');
    doc.text(subtitle, 40, 60);
    doc.text(`Generated: ${today}`, 40, 76);

    let y = 120;

    // ── Summary boxes ──
    const boxW = (contentWidth - 20) / 3;
    const boxes = [
      { label: 'Total Vehicles', value: vehicleSummary.length.toString() },
      { label: 'Total Services', value: totalServices.toString() },
      { label: `Total Spend (${currency})`, value: grandTotal.toLocaleString() },
    ];

    boxes.forEach((box, i) => {
      const bx = 40 + i * (boxW + 10);
      doc.rect(bx, y, boxW, 55).lineWidth(1).strokeColor('#D5D8DC').fillAndStroke('#FAFBFC', '#D5D8DC');
      doc.font('Helvetica').fontSize(9).fillColor('#7F8C8D');
      doc.text(box.label, bx + 10, y + 10, { width: boxW - 20 });
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#1B4F72');
      doc.text(box.value, bx + 10, y + 28, { width: boxW - 20 });
    });
    y += 75;

    // ══════════════════════════════════════════════════════════
    // SECTION 1: COST SUMMARY BY VEHICLE
    // ══════════════════════════════════════════════════════════
    y = drawSectionTitle('Cost Summary by Vehicle', y);

    const sumCols = [150, 55, 70, 85, 85, 50];
    y = drawTableHeader(sumCols, ['Vehicle', 'Services', `Avg (${currency})`, `Total (${currency})`, 'Last Service', '%'], y);

    vehicleSummary.forEach((v, index) => {
      y = checkPage(y, 22);
      const totalCost = Number(v.totalCost);
      const svcCount = Number(v.serviceCount);
      const avgCost = svcCount > 0 ? Math.round(totalCost / svcCount) : 0;
      const pct = grandTotal > 0 ? Math.round((totalCost / grandTotal) * 100) : 0;
      const lastSvc = v.lastService || '-';

      y = drawTableRow(sumCols, [
        truncate(v.vehicleName, 28),
        svcCount.toString(),
        avgCost.toLocaleString(),
        totalCost.toLocaleString(),
        lastSvc,
        `${pct}%`,
      ], y, index % 2 === 0);
    });

    // Grand total row
    doc.rect(40, y, contentWidth, 26).fill('#1B4F72');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11);
    doc.text('Grand Total', 45, y + 7, { width: sumCols[0] });
    doc.text(totalServices.toString(), 45 + sumCols[0], y + 7, { width: sumCols[1], align: 'right' });
    doc.text(grandTotal.toLocaleString(), 45 + sumCols[0] + sumCols[1] + sumCols[2], y + 7, { width: sumCols[3], align: 'right' });
    y += 40;

    // ══════════════════════════════════════════════════════════
    // SECTION 2: COST BY CATEGORY
    // ══════════════════════════════════════════════════════════
    if (categorySummary.length > 0) {
      y = checkPage(y, 80);
      y = drawSectionTitle('Cost Breakdown by Category', y);

      const catCols = [200, 100, 110, 105];
      y = drawTableHeader(catCols, ['Category', 'Services', `Total (${currency})`, '% of Total'], y);

      categorySummary.forEach((c, index) => {
        y = checkPage(y, 22);
        const totalCost = Number(c.totalCost);
        const svcCount = Number(c.serviceCount);
        const pct = grandTotal > 0 ? ((totalCost / grandTotal) * 100).toFixed(1) : '0.0';

        y = drawTableRow(catCols, [
          c.categoryName,
          svcCount.toString(),
          totalCost.toLocaleString(),
          `${pct}%`,
        ], y, index % 2 === 0);
      });
      y += 20;
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 3: SERVICE RECORD DETAILS (grouped by vehicle)
    // ══════════════════════════════════════════════════════════
    if (records.length > 0) {
      y = checkPage(y, 80);
      y = drawSectionTitle('Service Record Details', y);

      // Group records by vehicle
      const grouped = {};
      for (const r of records) {
        if (!grouped[r.vehicle]) grouped[r.vehicle] = [];
        grouped[r.vehicle].push(r);
      }

      const detailCols = [72, 110, 65, 80, 90, 98];
      const detailAligns = ['left', 'left', 'right', 'right', 'left', 'left'];

      for (const [vehicleName, vehicleRecords] of Object.entries(grouped)) {
        y = checkPage(y, 60);

        // Vehicle sub-header
        doc.rect(40, y, contentWidth, 22).fill('#2C3E50');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11);
        doc.text(`${vehicleName}  (${vehicleRecords.length} records)`, 45, y + 5);
        y += 22;

        y = drawTableHeader(detailCols, ['Date', 'Category', 'KMs', `Cost (${currency})`, 'Provider', 'Notes / Next Due'], y);

        const maxRecords = Math.min(vehicleRecords.length, 50);
        for (let i = 0; i < maxRecords; i++) {
          y = checkPage(y, 22);
          const r = vehicleRecords[i];
          const cost = r.cost ? Number(r.cost).toLocaleString() : '0';
          let extra = '';
          if (r.nextDueDate) extra = `Due: ${r.nextDueDate}`;
          else if (r.nextDueKms) extra = `Due: ${Number(r.nextDueKms).toLocaleString()} km`;
          else if (r.notes) extra = truncate(r.notes, 16);
          else extra = '-';

          y = drawTableRow(detailCols, [
            r.date || '-',
            truncate(r.category, 18),
            r.kms ? Number(r.kms).toLocaleString() : '-',
            cost,
            truncate(r.provider || '-', 14),
            extra,
          ], y, i % 2 === 0, detailAligns);
        }

        if (vehicleRecords.length > maxRecords) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#7F8C8D');
          doc.text(`... and ${vehicleRecords.length - maxRecords} more records`, 45, y + 4);
          y += 18;
        }

        // Vehicle subtotal
        const vehicleTotal = vehicleRecords.reduce((sum, r) => sum + Number(r.cost || 0), 0);
        doc.rect(40, y, contentWidth, 20).fill('#EBF5FB');
        doc.fillColor('#1B4F72').font('Helvetica-Bold').fontSize(10);
        doc.text(`Subtotal: ${currency} ${vehicleTotal.toLocaleString()}`, 45, y + 5, { width: contentWidth - 10, align: 'right' });
        y += 30;
      }
    }

    // ── Page footers ──
    addPageFooter();

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
