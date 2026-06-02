const nodemailer = require('nodemailer');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function requireEnv(name) {
  const value = clean(process.env[name]);
  if (!value) {
    const error = new Error(`Variable SMTP manquante: ${name}`);
    error.status = 500;
    throw error;
  }
  return value;
}

function smtpSecure() {
  return String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
}

function smtpPort() {
  const parsed = Number(process.env.SMTP_PORT || (smtpSecure() ? 465 : 587));
  return Number.isFinite(parsed) ? parsed : 587;
}

function createTransport() {
  return nodemailer.createTransport({
    host: requireEnv('SMTP_HOST'),
    port: smtpPort(),
    secure: smtpSecure(),
    auth: {
      user: requireEnv('SMTP_USER'),
      pass: requireEnv('SMTP_PASS'),
    },
  });
}

function fromAddress() {
  const email = requireEnv('SMTP_FROM_EMAIL');
  const name = clean(process.env.SMTP_FROM_NAME);
  return name ? `"${name.replace(/"/g, '')}" <${email}>` : email;
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  const recipient = clean(to);
  if (!recipient) {
    const error = new Error('Destinataire email manquant');
    error.status = 400;
    throw error;
  }

  const transport = createTransport();
  const info = await transport.sendMail({
    from: fromAddress(),
    to: recipient,
    subject: clean(subject) || 'Document Gestion Commerciale',
    html: html || undefined,
    text: text || undefined,
    replyTo: clean(replyTo) || undefined,
  });

  return {
    message_id: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
}

module.exports = {
  sendEmail,
};
