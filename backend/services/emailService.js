const nodemailer = require('nodemailer');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getSmtpConfig() {
  const secure = parseBoolean(process.env.SMTP_SECURE);
  const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));
  const fromAddress = clean(process.env.MAIL_FROM_ADDRESS) || clean(process.env.SMTP_FROM_EMAIL);
  const fromName = clean(process.env.MAIL_FROM_NAME) || clean(process.env.SMTP_FROM_NAME) || 'ALTA MARÉE';

  return {
    host: clean(process.env.SMTP_HOST),
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: clean(process.env.SMTP_USER),
    pass: clean(process.env.SMTP_PASS),
    fromName,
    fromAddress,
  };
}

function getMissingSmtpConfig(config = getSmtpConfig()) {
  const required = {
    SMTP_HOST: config.host,
    SMTP_USER: config.user,
    SMTP_PASS: config.pass,
    MAIL_FROM_ADDRESS: config.fromAddress,
  };

  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function assertSmtpConfig() {
  const config = getSmtpConfig();
  const missing = getMissingSmtpConfig(config);

  if (missing.length > 0) {
    const error = new Error(`Configuration SMTP incomplete: ${missing.join(', ')}`);
    error.status = 503;
    error.expose = true;
    throw error;
  }

  return config;
}

function createTransport() {
  const config = assertSmtpConfig();

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function messageToHtml(message) {
  return escapeHtml(message || '')
    .split(/\r?\n/)
    .map((line) => (line ? `<p>${line}</p>` : '<br>'))
    .join('');
}

async function sendEmail({ to, subject, html, text, replyTo, attachments }) {
  const recipients = Array.isArray(to)
    ? to.map(clean).filter(Boolean)
    : clean(to);
  if (!recipients || (Array.isArray(recipients) && !recipients.length)) {
    const error = new Error('Destinataire email manquant');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const config = assertSmtpConfig();
  const transport = createTransport();
  const info = await transport.sendMail({
    from: {
      name: config.fromName,
      address: config.fromAddress,
    },
    to: recipients,
    subject: clean(subject) || 'Message ALTA MARÉE',
    html: html || undefined,
    text: text || undefined,
    replyTo: clean(replyTo) || undefined,
    attachments: Array.isArray(attachments) ? attachments : undefined,
  });

  return {
    message_id: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
}

async function sendTestEmail({ to, subject, message }) {
  const body = clean(message) || 'Message de test ALTA MARÉE';

  return sendEmail({
    to,
    subject: clean(subject) || 'Test ALTA MARÉE',
    text: body,
    html: messageToHtml(body),
  });
}

function getSmtpStatus() {
  const config = getSmtpConfig();
  return {
    configured: getMissingSmtpConfig(config).length === 0,
    missing: getMissingSmtpConfig(config),
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    from_name: config.fromName,
    from_address: config.fromAddress,
  };
}

module.exports = {
  sendEmail,
  sendTestEmail,
  getSmtpStatus,
};
