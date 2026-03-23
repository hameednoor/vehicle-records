const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { sendEmail } = require('../services/email');
const { sendTestWhatsApp } = require('../services/whatsapp');

const router = express.Router();

/**
 * GET / - List all reminder configs.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();

    const reminders = await db.all(
      `SELECT rc.*, v.name as "vehicleName"
       FROM reminder_configs rc
       JOIN vehicles v ON rc."vehicleId" = v.id
       ORDER BY rc."createdAt" DESC`
    );

    // Parse recipients JSON for each reminder
    const parsed = reminders.map((r) => ({
      ...r,
      recipients: safeParseJson(r.recipients, []),
    }));

    res.json(parsed);
  } catch (error) {
    console.error('Error fetching reminders:', error.message);
    res.status(500).json({ error: 'Failed to fetch reminders.' });
  }
});

/**
 * GET /vehicle/:vehicleId - Get reminders for a specific vehicle.
 */
router.get('/vehicle/:vehicleId', async (req, res) => {
  try {
    const db = getDb();

    const reminders = await db.all(
      `SELECT rc.*, v.name as "vehicleName"
       FROM reminder_configs rc
       JOIN vehicles v ON rc."vehicleId" = v.id
       WHERE rc."vehicleId" = ?
       ORDER BY rc."createdAt" DESC`,
      req.params.vehicleId
    );

    const parsed = reminders.map((r) => ({
      ...r,
      recipients: safeParseJson(r.recipients, []),
    }));

    res.json(parsed);
  } catch (error) {
    console.error('Error fetching vehicle reminders:', error.message);
    res.status(500).json({ error: 'Failed to fetch reminders.' });
  }
});

/**
 * POST / - Create a new reminder config.
 */
router.post(
  '/',
  [
    body('vehicleId').trim().notEmpty().withMessage('Vehicle ID is required.'),
    body('type')
      .isIn(['maintenance', 'kmLog'])
      .withMessage('Type must be "maintenance" or "kmLog".'),
    body('channel')
      .optional()
      .isIn(['email', 'whatsapp', 'both'])
      .withMessage('Channel must be "email", "whatsapp", or "both".'),
    body('frequency')
      .optional()
      .isIn(['once', 'daily', 'weekly'])
      .withMessage('Frequency must be "once", "daily", or "weekly".'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const db = getDb();
      const { vehicleId, type, channel, frequency, recipients, isActive } = req.body;

      // Verify vehicle exists
      const vehicle = await db.get('SELECT id FROM vehicles WHERE id = ?', vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: 'Vehicle not found.' });
      }

      const id = uuidv4();
      const recipientsJson = JSON.stringify(recipients || []);

      await db.run(
        `INSERT INTO reminder_configs (id, "vehicleId", type, channel, frequency, recipients, "isActive")
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        vehicleId,
        type,
        channel || 'email',
        frequency || 'once',
        recipientsJson,
        isActive !== undefined ? (isActive ? 1 : 0) : 1
      );

      const reminder = await db.get(
        `SELECT rc.*, v.name as "vehicleName"
         FROM reminder_configs rc
         JOIN vehicles v ON rc."vehicleId" = v.id
         WHERE rc.id = ?`,
        id
      );

      res.status(201).json({
        ...reminder,
        recipients: safeParseJson(reminder.recipients, []),
      });
    } catch (error) {
      console.error('Error creating reminder:', error.message);
      res.status(500).json({ error: 'Failed to create reminder.' });
    }
  }
);

/**
 * PUT /:id - Update a reminder config.
 */
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const existing = await db.get(
      'SELECT * FROM reminder_configs WHERE id = ?',
      req.params.id
    );

    if (!existing) {
      return res.status(404).json({ error: 'Reminder not found.' });
    }

    const { type, channel, frequency, recipients, isActive } = req.body;

    const recipientsJson =
      recipients !== undefined
        ? JSON.stringify(recipients)
        : existing.recipients;

    await db.run(
      `UPDATE reminder_configs
       SET type = ?, channel = ?, frequency = ?, recipients = ?, "isActive" = ?
       WHERE id = ?`,
      type !== undefined ? type : existing.type,
      channel !== undefined ? channel : existing.channel,
      frequency !== undefined ? frequency : existing.frequency,
      recipientsJson,
      isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive,
      req.params.id
    );

    const updated = await db.get(
      `SELECT rc.*, v.name as "vehicleName"
       FROM reminder_configs rc
       JOIN vehicles v ON rc."vehicleId" = v.id
       WHERE rc.id = ?`,
      req.params.id
    );

    res.json({
      ...updated,
      recipients: safeParseJson(updated.recipients, []),
    });
  } catch (error) {
    console.error('Error updating reminder:', error.message);
    res.status(500).json({ error: 'Failed to update reminder.' });
  }
});

/**
 * DELETE /:id - Delete a reminder config.
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const reminder = await db.get(
      'SELECT * FROM reminder_configs WHERE id = ?',
      req.params.id
    );

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found.' });
    }

    await db.run('DELETE FROM reminder_configs WHERE id = ?', req.params.id);
    res.json({ message: 'Reminder deleted successfully.' });
  } catch (error) {
    console.error('Error deleting reminder:', error.message);
    res.status(500).json({ error: 'Failed to delete reminder.' });
  }
});

/**
 * POST /test - Send a test reminder (email and/or WhatsApp).
 */
router.post(
  '/test',
  [body('to').trim().notEmpty().withMessage('Recipient is required.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { to, type, channel } = req.body;
      const isWhatsApp = channel === 'whatsapp' || channel === 'both' || (to && to.startsWith('+'));

      // Send WhatsApp test if channel is whatsapp/both or recipient looks like a phone number
      if (isWhatsApp) {
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
          return res.status(503).json({
            error: 'Twilio WhatsApp not configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.',
          });
        }

        const db = getDb();
        const settings = await db.get('SELECT * FROM settings WHERE id = 1');
        const phone = settings?.whatsappNumber || to;

        const waResult = await sendTestWhatsApp(phone);

        // Also send email if channel is 'both'
        if (channel === 'both' && to && !to.startsWith('+')) {
          const subject =
            type === 'kmLog'
              ? 'Test: KM Log Reminder'
              : 'Test: Maintenance Reminder';

          const html = `
            <div style="font-family:Arial,sans-serif;padding:20px;">
              <h2 style="color:#1B4F72;">Test Reminder</h2>
              <p>This is a test reminder from your Vehicle Maintenance Tracker.</p>
              <p>If you received this email, your notification settings are configured correctly.</p>
              <p style="color:#5D6D7E;font-size:12px;margin-top:20px;">
                Sent at: ${new Date().toISOString()}
              </p>
            </div>
          `;
          await sendEmail({ to, subject, html });
        }

        if (waResult) {
          res.json({ message: 'Test WhatsApp notification sent successfully.' });
        } else {
          res.status(500).json({ error: 'Failed to send WhatsApp test notification.' });
        }
        return;
      }

      // Default: send email test
      const subject =
        type === 'kmLog'
          ? 'Test: KM Log Reminder'
          : 'Test: Maintenance Reminder';

      const html = `
        <div style="font-family:Arial,sans-serif;padding:20px;">
          <h2 style="color:#1B4F72;">Test Reminder</h2>
          <p>This is a test reminder from your Vehicle Maintenance Tracker.</p>
          <p>If you received this email, your notification settings are configured correctly.</p>
          <p style="color:#5D6D7E;font-size:12px;margin-top:20px;">
            Sent at: ${new Date().toISOString()}
          </p>
        </div>
      `;

      const result = await sendEmail({ to, subject, html });

      if (result) {
        res.json({ message: 'Test reminder sent successfully.', messageId: result.messageId });
      } else {
        res.status(503).json({
          error:
            'SMTP not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.',
        });
      }
    } catch (error) {
      console.error('Error sending test reminder:', error.message);
      res.status(500).json({ error: `Failed to send test reminder: ${error.message}` });
    }
  }
);

/**
 * Safely parse a JSON string, returning a default value on failure.
 */
function safeParseJson(str, defaultValue) {
  try {
    return JSON.parse(str || JSON.stringify(defaultValue));
  } catch {
    return defaultValue;
  }
}

module.exports = router;
