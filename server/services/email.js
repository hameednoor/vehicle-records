const nodemailer = require('nodemailer');

const BRAND_COLOR = '#1B4F72';
const BRAND_LIGHT = '#2E86C1';
const BRAND_BG = '#EBF5FB';

/**
 * Create a Nodemailer transporter using SMTP settings from environment
 * variables or provided configuration.
 */
function createTransporter(config = {}) {
  const options = {
    host: config.host || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(config.port || process.env.SMTP_PORT || '587', 10),
    secure: (config.port || process.env.SMTP_PORT || '587') === '465',
    auth: {
      user: config.user || process.env.SMTP_USER || '',
      pass: config.pass || process.env.SMTP_PASS || '',
    },
  };

  // If no credentials are configured, skip transport creation
  if (!options.auth.user || !options.auth.pass) {
    console.warn(
      'SMTP credentials not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS environment variables.'
    );
    return null;
  }

  return nodemailer.createTransport(options);
}

/**
 * Wrap content in the standard email layout template.
 */
function wrapInTemplate(title, bodyHtml) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f4;padding:20px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">
                Vehicle Maintenance Tracker
              </h1>
            </td>
          </tr>
          <!-- Title Bar -->
          <tr>
            <td style="background-color:${BRAND_LIGHT};padding:12px 32px;">
              <h2 style="margin:0;color:#ffffff;font-size:16px;font-weight:600;">${title}</h2>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:${BRAND_BG};padding:16px 32px;border-top:1px solid #D4E6F1;">
              <p style="margin:0;color:#5D6D7E;font-size:12px;text-align:center;">
                This is an automated notification from your Vehicle Maintenance Tracker.
                <br>Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send an email using the configured SMTP transport.
 *
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email(s)
 * @param {string} options.subject - Email subject line
 * @param {string} options.html - HTML body content
 * @returns {Promise<Object|null>} Nodemailer send result or null if transport unavailable
 */
async function sendEmail({ to, subject, html }) {
  try {
    const transporter = createTransporter();
    if (!transporter) {
      console.warn(`Email not sent (no SMTP config): "${subject}" to ${to}`);
      return null;
    }

    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@vehicle-tracker.app';

    const result = await transporter.sendMail({
      from: `"Vehicle Tracker" <${fromAddress}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
    });

    console.log(`Email sent: "${subject}" to ${to} (messageId: ${result.messageId})`);
    return result;
  } catch (error) {
    console.error(`Failed to send email "${subject}" to ${to}:`, error.message);
    throw error;
  }
}

/**
 * Send a maintenance reminder email for a specific service that is due.
 *
 * @param {Object} vehicle - Vehicle record
 * @param {Object} serviceRecord - Service record with upcoming due info
 * @param {Object} category - Category record
 * @returns {Promise<Object|null>}
 */
async function sendMaintenanceReminder(vehicle, serviceRecord, category) {
  const isOverdue = serviceRecord._isOverdue;
  const statusColor = isOverdue ? '#E74C3C' : '#F39C12';
  const statusLabel = isOverdue ? 'OVERDUE' : 'COMING UP';

  const dueParts = [];
  if (serviceRecord.nextDueDate) {
    dueParts.push(`<strong>Due Date:</strong> ${serviceRecord.nextDueDate}`);
  }
  if (serviceRecord.nextDueKms) {
    dueParts.push(
      `<strong>Due at:</strong> ${Number(serviceRecord.nextDueKms).toLocaleString()} km`
    );
  }

  const bodyHtml = `
    <div style="background-color:${statusColor};color:#fff;padding:8px 16px;border-radius:4px;display:inline-block;margin-bottom:16px;">
      ${statusLabel}
    </div>
    <h3 style="color:${BRAND_COLOR};margin:0 0 8px;">${category.name}</h3>
    <table role="presentation" cellspacing="0" cellpadding="4" style="margin-bottom:16px;">
      <tr>
        <td style="color:#5D6D7E;padding-right:12px;">Vehicle:</td>
        <td><strong>${vehicle.name}</strong></td>
      </tr>
      <tr>
        <td style="color:#5D6D7E;padding-right:12px;">Current KMs:</td>
        <td><strong>${Number(vehicle.currentKms || 0).toLocaleString()} km</strong></td>
      </tr>
      ${dueParts
        .map(
          (part) => `
      <tr>
        <td colspan="2">${part}</td>
      </tr>`
        )
        .join('')}
      <tr>
        <td style="color:#5D6D7E;padding-right:12px;">Last Service:</td>
        <td>${serviceRecord.date || 'N/A'}</td>
      </tr>
    </table>
    ${
      serviceRecord.provider
        ? `<p style="color:#5D6D7E;font-size:14px;">Last provider: ${serviceRecord.provider}</p>`
        : ''
    }
    <p style="color:#5D6D7E;font-size:14px;margin-top:16px;">
      Please schedule this maintenance at your earliest convenience to keep your vehicle running safely.
    </p>
  `;

  const subject = `${statusLabel}: ${category.name} for ${vehicle.name}`;
  const html = wrapInTemplate(`Maintenance ${statusLabel}`, bodyHtml);

  return sendEmail({ to: vehicle._recipients, subject, html });
}

/**
 * Send a KM log reminder prompting the user to update their vehicle's odometer reading.
 *
 * @param {Object} vehicle - Vehicle record
 * @returns {Promise<Object|null>}
 */
async function sendKmLogReminder(vehicle) {
  const bodyHtml = `
    <h3 style="color:${BRAND_COLOR};margin:0 0 16px;">Odometer Update Needed</h3>
    <p style="color:#333;font-size:15px;">
      It's time to log the current odometer reading for your vehicle:
    </p>
    <div style="background-color:${BRAND_BG};padding:16px;border-radius:6px;border-left:4px solid ${BRAND_COLOR};margin:16px 0;">
      <p style="margin:0;font-size:16px;"><strong>${vehicle.name}</strong></p>
      <p style="margin:4px 0 0;color:#5D6D7E;font-size:14px;">
        Last recorded: ${Number(vehicle.currentKms || 0).toLocaleString()} km
      </p>
    </div>
    <p style="color:#5D6D7E;font-size:14px;">
      Keeping your odometer readings up to date helps us send you accurate maintenance reminders.
    </p>
  `;

  const subject = `Odometer Update Reminder: ${vehicle.name}`;
  const html = wrapInTemplate('KM Log Reminder', bodyHtml);

  return sendEmail({ to: vehicle._recipients, subject, html });
}

module.exports = {
  sendEmail,
  sendMaintenanceReminder,
  sendKmLogReminder,
};
