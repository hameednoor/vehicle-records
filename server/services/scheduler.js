const cron = require('node-cron');
const { sendMaintenanceReminder, sendKmLogReminder } = require('./email');
const { sendMaintenanceWhatsApp, sendKmLogWhatsApp } = require('./whatsapp');

let schedulerTask = null;
// Track sent reminders to avoid flooding (key: "recordId-date", resets daily)
const sentToday = new Set();
let lastResetDate = '';

function resetSentTrackingIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastResetDate) {
    sentToday.clear();
    lastResetDate = today;
  }
}

/**
 * Start the scheduler that checks for due maintenance reminders every hour.
 *
 * @param {Object} db - The unified database wrapper instance
 */
function startScheduler(db) {
  if (schedulerTask) {
    console.log('Scheduler is already running.');
    return;
  }

  console.log('Starting reminder scheduler (runs every hour)...');

  // Run every hour at minute 0
  schedulerTask = cron.schedule('0 * * * *', () => {
    runReminderChecks(db);
  });

  // Also run immediately on startup after a short delay
  setTimeout(() => {
    runReminderChecks(db);
  }, 5000);
}

/**
 * Run all reminder checks.
 */
async function runReminderChecks(db) {
  resetSentTrackingIfNewDay();
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Running reminder checks...`);

  try {
    await checkMaintenanceReminders(db);
  } catch (error) {
    console.error('Error checking maintenance reminders:', error.message);
  }

  try {
    await checkKmLogReminders(db);
  } catch (error) {
    console.error('Error checking KM log reminders:', error.message);
  }
}

/**
 * Check for upcoming or overdue maintenance based on whichever is closer: date or KM.
 * Since KM readings are not updated periodically, we check both thresholds and
 * send ONE reminder per service record if either condition is met.
 */
async function checkMaintenanceReminders(db) {
  // Get settings for buffer values
  const settings = await db.get('SELECT * FROM settings WHERE id = 1');
  if (!settings) return;

  const bufferKms = settings.reminderBufferKms || 500;
  const bufferDays = settings.reminderBufferDays || 7;

  // Get all active maintenance reminder configs
  const reminderConfigs = await db.all(
    `SELECT rc.*, v.name as "vehicleName", v."currentKms"
     FROM reminder_configs rc
     JOIN vehicles v ON rc."vehicleId" = v.id
     WHERE rc."isActive" = 1 AND rc.type = 'maintenance'`
  );

  const today = new Date().toISOString().split('T')[0];
  const bufferDate = new Date();
  bufferDate.setDate(bufferDate.getDate() + bufferDays);
  const bufferDateStr = bufferDate.toISOString().split('T')[0];

  for (const config of reminderConfigs) {
    try {
      const recipients = parseRecipients(config.recipients, settings);
      if (recipients.length === 0) continue;

      const currentKms = config.currentKms || 0;
      const kmsThreshold = currentKms + bufferKms;

      // Single query: get records where EITHER date or KM threshold is approaching
      const dueRecords = await db.all(
        `SELECT sr.*, c.name as "categoryName", c.id as "catId"
         FROM service_records sr
         JOIN categories c ON sr."categoryId" = c.id
         WHERE sr."vehicleId" = ?
           AND (
             (sr."nextDueDate" IS NOT NULL AND sr."nextDueDate" <= ?)
             OR
             (sr."nextDueKms" IS NOT NULL AND sr."nextDueKms" <= ?)
           )
         ORDER BY CASE WHEN sr."nextDueDate" IS NULL THEN 1 ELSE 0 END, sr."nextDueDate" ASC`,
        config.vehicleId, bufferDateStr, kmsThreshold
      );

      for (const record of dueRecords) {
        // One reminder per record per day, regardless of which threshold triggered
        const sentKey = `maint-${record.id}-${today}`;
        if (sentToday.has(sentKey)) continue;

        // Overdue if either date is past or KMs have been exceeded
        const dateOverdue = record.nextDueDate && record.nextDueDate < today;
        const kmOverdue = record.nextDueKms && record.nextDueKms <= currentKms;
        record._isOverdue = dateOverdue || kmOverdue;

        const vehicle = {
          name: config.vehicleName,
          currentKms: config.currentKms,
          _recipients: recipients,
        };
        const category = { name: record.categoryName };

        sentToday.add(sentKey);

        const channel = config.channel || 'email';

        // Send email if channel is 'email' or 'both'
        if (channel === 'email' || channel === 'both') {
          sendMaintenanceReminder(vehicle, record, category).catch((err) => {
            sentToday.delete(sentKey);
            console.error(`Failed to send maintenance reminder:`, err.message);
          });
        }

        // Send WhatsApp if channel is 'whatsapp' or 'both'
        if (channel === 'whatsapp' || channel === 'both') {
          const waPhone = settings.whatsappNumber;
          sendMaintenanceWhatsApp(vehicle, record, category, waPhone).catch((err) => {
            console.error(`Failed to send maintenance WhatsApp reminder:`, err.message);
          });
        }
      }
    } catch (error) {
      console.error(
        `Error processing maintenance reminder for vehicle ${config.vehicleId}:`,
        error.message
      );
    }
  }
}

/**
 * Check for KM log reminders and send prompts to log odometer readings.
 */
async function checkKmLogReminders(db) {
  const settings = await db.get('SELECT * FROM settings WHERE id = 1');
  if (!settings) return;

  // Get all active KM log reminder configs
  const reminderConfigs = await db.all(
    `SELECT rc.*, v.name as "vehicleName", v."currentKms"
     FROM reminder_configs rc
     JOIN vehicles v ON rc."vehicleId" = v.id
     WHERE rc."isActive" = 1 AND rc.type = 'kmLog'`
  );

  const now = new Date();
  const currentHour = now.getHours();

  for (const config of reminderConfigs) {
    try {
      const recipients = parseRecipients(config.recipients, settings);
      if (recipients.length === 0) continue;

      // Determine if we should send based on frequency
      let shouldSend = false;

      if (config.frequency === 'daily') {
        // Send once per day at 9 AM
        shouldSend = currentHour === 9;
      } else if (config.frequency === 'weekly') {
        // Send on Mondays at 9 AM
        shouldSend = now.getDay() === 1 && currentHour === 9;
      } else if (config.frequency === 'once') {
        // 'once' reminders: check if the last KM log is older than 30 days
        const lastLog = await db.get(
          'SELECT "loggedAt" FROM km_logs WHERE "vehicleId" = ? ORDER BY "loggedAt" DESC LIMIT 1',
          config.vehicleId
        );

        if (!lastLog) {
          shouldSend = currentHour === 9;
        } else {
          const lastDate = new Date(lastLog.loggedAt);
          const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
          shouldSend = daysSince >= 30 && currentHour === 9;
        }
      }

      if (shouldSend) {
        const today = new Date().toISOString().split('T')[0];
        const sentKey = `kmlog-${config.vehicleId}-${today}`;
        if (sentToday.has(sentKey)) continue;

        sentToday.add(sentKey);

        const vehicle = {
          name: config.vehicleName,
          currentKms: config.currentKms,
          _recipients: recipients,
        };

        // Send email if channel is 'email' or 'both'
        const channel = config.channel || 'email';
        if (channel === 'email' || channel === 'both') {
          sendKmLogReminder(vehicle).catch((err) => {
            sentToday.delete(sentKey);
            console.error(`Failed to send KM log reminder:`, err.message);
          });
        }

        // Send WhatsApp if channel is 'whatsapp' or 'both'
        if (channel === 'whatsapp' || channel === 'both') {
          const waPhone = settings.whatsappNumber;
          sendKmLogWhatsApp(vehicle, waPhone).catch((err) => {
            console.error(`Failed to send KM log WhatsApp reminder:`, err.message);
          });
        }
      }
    } catch (error) {
      console.error(
        `Error processing KM log reminder for vehicle ${config.vehicleId}:`,
        error.message
      );
    }
  }
}

/**
 * Parse recipients from reminder config, falling back to settings emails.
 */
function parseRecipients(recipientsJson, settings) {
  let recipients = [];

  try {
    recipients = JSON.parse(recipientsJson || '[]');
  } catch {
    recipients = [];
  }

  // If no specific recipients, fall back to global email settings
  if (recipients.length === 0) {
    try {
      recipients = JSON.parse(settings.emails || '[]');
    } catch {
      recipients = [];
    }
  }

  return recipients;
}

/**
 * Stop the scheduler gracefully.
 */
function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('Scheduler stopped.');
  }
}

module.exports = { startScheduler, stopScheduler };
