const twilio = require('twilio');

// Initialize Twilio client from env vars
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

let client = null;

function getClient() {
  if (!client && accountSid && authToken) {
    client = twilio(accountSid, authToken);
  }
  return client;
}

/**
 * Send a WhatsApp message via Twilio.
 *
 * @param {string} phone - Phone number with country code (e.g. "+971501894632")
 * @param {string} message - Plain text message to send
 * @returns {Promise<Object|null>} Twilio message object or null on failure
 */
async function sendWhatsApp(phone, message) {
  const twilioClient = getClient();
  if (!twilioClient) {
    console.warn('WhatsApp not sent: Twilio credentials not configured.');
    return null;
  }

  // Ensure phone is in whatsapp: format
  const to = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;

  try {
    const result = await twilioClient.messages.create({
      from: twilioFrom,
      to,
      body: message,
    });
    console.log(`WhatsApp sent to ${to} (SID: ${result.sid})`);
    return result;
  } catch (error) {
    console.error('WhatsApp send failed:', error.message);
    return null;
  }
}

/**
 * Format a maintenance reminder message for WhatsApp.
 */
function formatMaintenanceWhatsApp(vehicle, serviceRecord, category) {
  const isOverdue = serviceRecord._isOverdue;
  const statusEmoji = isOverdue ? '\u26a0\ufe0f' : '\ud83d\udd14';
  const statusLabel = isOverdue ? 'OVERDUE' : 'COMING UP';

  let message = `${statusEmoji} *${statusLabel}: ${category.name}*\n\n`;
  message += `\ud83d\ude97 Vehicle: ${vehicle.name}\n`;
  message += `\ud83d\udcca Current KMs: ${Number(vehicle.currentKms || 0).toLocaleString()} km\n`;

  if (serviceRecord.nextDueDate) {
    message += `\ud83d\udcc5 Due Date: ${serviceRecord.nextDueDate}\n`;
  }
  if (serviceRecord.nextDueKms) {
    message += `\ud83c\udfc1 Due at: ${Number(serviceRecord.nextDueKms).toLocaleString()} km\n`;
  }
  if (serviceRecord.date) {
    message += `\ud83d\udd27 Last Service: ${serviceRecord.date}\n`;
  }
  if (serviceRecord.provider) {
    message += `\ud83c\udfe2 Provider: ${serviceRecord.provider}\n`;
  }

  message += `\nPlease schedule this maintenance soon.`;
  return message;
}

/**
 * Send a maintenance reminder WhatsApp message.
 *
 * @param {Object} vehicle - Vehicle record
 * @param {Object} serviceRecord - Service record with due info
 * @param {Object} category - Category record
 * @param {string} phone - WhatsApp phone number
 * @returns {Promise<Object|null>}
 */
async function sendMaintenanceWhatsApp(vehicle, serviceRecord, category, phone) {
  try {
    const message = formatMaintenanceWhatsApp(vehicle, serviceRecord, category);
    return await sendWhatsApp(phone, message);
  } catch (error) {
    console.error('Failed to send maintenance WhatsApp:', error.message);
    return null;
  }
}

/**
 * Format a KM log reminder message for WhatsApp.
 */
function formatKmLogWhatsApp(vehicle) {
  let message = `\ud83d\udcdd *Odometer Update Reminder*\n\n`;
  message += `\ud83d\ude97 Vehicle: ${vehicle.name}\n`;
  message += `\ud83d\udcca Last recorded: ${Number(vehicle.currentKms || 0).toLocaleString()} km\n\n`;
  message += `Please log your current odometer reading to keep maintenance reminders accurate.`;
  return message;
}

/**
 * Send a KM log reminder via WhatsApp.
 *
 * @param {Object} vehicle - Vehicle record
 * @param {string} phone - WhatsApp phone number
 * @returns {Promise<Object|null>}
 */
async function sendKmLogWhatsApp(vehicle, phone) {
  try {
    const message = formatKmLogWhatsApp(vehicle);
    return await sendWhatsApp(phone, message);
  } catch (error) {
    console.error('Failed to send KM log WhatsApp:', error.message);
    return null;
  }
}

/**
 * Send a test WhatsApp message.
 *
 * @param {string} phone - WhatsApp phone number
 * @returns {Promise<Object|null>}
 */
async function sendTestWhatsApp(phone) {
  const message = `\u2705 *Test Notification*\n\nThis is a test message from your Vehicle Maintenance Tracker.\n\nIf you received this, your WhatsApp notifications are configured correctly!\n\n\ud83d\udcc5 Sent at: ${new Date().toISOString()}`;
  return sendWhatsApp(phone, message);
}

module.exports = {
  sendWhatsApp,
  sendMaintenanceWhatsApp,
  sendKmLogWhatsApp,
  sendTestWhatsApp,
};
