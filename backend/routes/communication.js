const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/authorization');
const { attachDbContext } = require('../middleware/dbContext');
const { sendTestEmail, getSmtpStatus } = require('../services/emailService');

const router = express.Router();

const COMMUNICATION_DEFAULTS = {
  email_sender_name: 'ALTA MARÉE',
  email_sender_address: 'commercial@altamaree.fr',
  contact_email: 'contact@altamaree.fr',
  internal_email: 'alric@altamaree.fr',
  webmail_url: 'https://mail.altamaree.fr',
  calendar_url: 'https://mail.altamaree.fr',
};

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function publicCommunicationSettings(row = {}) {
  return Object.fromEntries(
    Object.entries(COMMUNICATION_DEFAULTS).map(([key, fallback]) => [key, clean(row[key]) || fallback])
  );
}

router.get('/communication/settings', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `
      SELECT
        email_sender_name,
        email_sender_address,
        contact_email,
        internal_email,
        webmail_url,
        calendar_url
      FROM store_settings
      WHERE store_id = $1
      LIMIT 1
      `,
      [req.user.store_id]
    );

    res.json(publicCommunicationSettings(result.rows[0] || {}));
  } catch (err) {
    console.error('Erreur GET /api/communication/settings :', err);
    res.status(500).json({ error: 'Erreur serveur paramètres communication' });
  }
});

router.get('/communication/email/status', authenticateToken, requireAdmin, (req, res) => {
  res.json(getSmtpStatus());
});

router.post('/communication/email/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const to = clean(req.body?.to);
    const subject = clean(req.body?.subject) || 'Test ALTA MARÉE';
    const message = clean(req.body?.message) || 'Message de test';

    if (!isValidEmail(to)) {
      return res.status(400).json({ error: 'Adresse destinataire invalide' });
    }

    const result = await sendTestEmail({ to, subject, message });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Erreur POST /api/communication/email/test :', {
      message: err.message,
      status: err.status || 500,
    });

    res.status(err.status || 500).json({
      success: false,
      error: err.expose ? err.message : 'Erreur envoi email',
    });
  }
});

module.exports = router;
