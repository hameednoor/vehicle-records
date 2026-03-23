const cron = require('node-cron');
const { sendMaintenanceReminder, sendKmLogReminder } = require('./email');

let schedulerTask = null;

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
 * Check for upcoming or overdue maintenance based on date and KM thresholds.
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

  for (const config of reminderConfigs) {
    try {
      const recipients = parseRecipients(config.recipients, settings);
      if (recipients.length === 0) continue;

      // Find service records with upcoming due dates or KMs for this vehicle
      const today = new Date().toISOString().split('T')[0];

      // Calculate the buffer date (today + bufferDays)
      const bufferDate = new Date();
      bufferDate.setDate(bufferDate.getDate() + bufferDays);
      const bufferDateStr = bufferDate.toISOString().split('T')[0];

      // Check date-based reminders
      const dateBasedRecords = await db.all(
        `SELECT sr.*, c.name as "categoryName", c.id as "catId"
         FROM service_records sr
         JOIN categories c ON sr."categoryId" = c.id
         WHERE sr."vehicleId" = ?
           AND sr."nextDueDate" IS NOT NULL
           AND sr."nextDueDate" <= ?
         ORDER BY sr."nextDueDate" ASC`,
        config.vehicleId, bufferDateStr
      );

      for (const record of dateBasedRecords) {
        const isOverdue = record.nextDueDate < today;
        record._isOverdue = isOverdue;

        const vehicle = {
          name: config.vehicleName,
          currentKms: config.currentKms,
          _recipients: recipients,
        };
        const category = { name: record.categoryName };

        sendMaintenanceReminder(vehicle, record, category).catch((err) => {
          console.error(`Failed to send date-based reminder:`, err.message);
        });
      }

      // Check KM-based reminders
      const currentKms = config.currentKms || 0;
      const kmsThreshold = currentKms + bufferKms;

      const kmsBasedRecords = await db.all(
        `SELECT sr.*, c.name as "categoryName", c.id as "catId"
         FROM service_records sr
         JOIN categories c ON sr."categoryId" = c.id
         WHERE sr."vehicleId" = ?
           AND sr."nextDueKms" IS NOT NULL
           AND sr."nextDueKms" <= ?
         ORDER BY sr."nextDueKms" ASC`,
        config.vehicleId, kmsThreshold
      );

      for (const record of kmsBasedRecords) {
        const isOverdue = record.nextDueKms <= currentKms;
        record._isOverdue = isOverdue;

        const vehicle = {
          name: config.vehicleName,
          currentKms: config.currentKms,
          _recipients: recipients,
        };
        const category = { name: record.categoryName };

        sendMaintenanceReminder(vehicle, record, category).catch((err) => {
          console.error(`Failed to send KM-based reminder:`, err.message);
        });
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
        const vehicle = {
          name: config.vehicleName,
          currentKms: config.currentKms,
          _recipients: recipients,
        };

        sendKmLogReminder(vehicle).catch((err) => {
          console.error(`Failed to send KM log reminder:`, err.message);
        });
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
