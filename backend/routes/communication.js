const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { requireAdmin, requireAdminOrManager } = require('../middleware/authorization');
const { attachDbContext } = require('../middleware/dbContext');
const { sendTestEmail } = require('../services/emailService');
const { sendTextMessage } = require('../services/whatsappService');
const {
  getInvoiceCommunicationDefaults,
  sendDeliveryNoteDocumentEmail,
  sendInvoiceDocumentEmail,
} = require('../services/documentEmailService');

const router = express.Router();

const COMMUNICATION_DEFAULTS = {
  email_sender_name: 'ALTA MARÉE',
  email_sender_address: 'commercial@altamaree.fr',
  contact_email: 'contact@altamaree.fr',
  internal_email: 'alric@altamaree.fr',
  webmail_url: 'https://mail.altamaree.fr',
  calendar_url: 'https://mail.altamaree.fr',
};
const WHATSAPP_TEST_MESSAGE = 'Bonjour depuis ALTA MARÉE 🚀';

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

function emailPayload(body = {}) {
  return {
    to: clean(body.to),
    subject: clean(body.subject),
    message: clean(body.message),
  };
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

router.post('/communication/whatsapp/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await sendTextMessage(req.body?.to, WHATSAPP_TEST_MESSAGE);
    res.json({ success: true });
  } catch (err) {
    console.error('Erreur POST /api/communication/whatsapp/test :', {
      message: err.message,
      status: err.status || 500,
    });

    res.status(err.status || 500).json({
      success: false,
      error: err.expose ? err.message : 'Erreur envoi WhatsApp',
    });
  }
});

router.post(
  '/communication/send-delivery-note-email/:id',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  async (req, res) => {
    try {
      const result = await sendDeliveryNoteDocumentEmail(req.dbPool, {
        storeId: req.user.store_id,
        deliveryNoteId: req.params.id,
        ...emailPayload(req.body),
      });
      res.json(result);
    } catch (err) {
      console.error('Erreur envoi email PDF BL :', {
        message: err.message,
        status: err.status || 500,
        delivery_note_id: req.params.id,
      });
      res.status(err.status || 500).json({ error: err.expose ? err.message : (err.message || 'Erreur envoi email BL') });
    }
  }
);

router.get('/communication/invoices/:id/defaults', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const defaults = await getInvoiceCommunicationDefaults(req.dbPool, {
      storeId: req.user.store_id,
      invoiceId: req.params.id,
    });
    if (!defaults) return res.status(404).json({ error: 'Facture introuvable' });
    return res.json(defaults);
  } catch (err) {
    console.error('Erreur defaults communication facture :', {
      message: err.message,
      status: err.status || 500,
      invoice_id: req.params.id,
    });
    return res.status(err.status || 500).json({ error: err.expose ? err.message : 'Erreur communication facture' });
  }
});

router.post(
  '/communication/send-invoice-email/:id',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  async (req, res) => {
    try {
      const result = await sendInvoiceDocumentEmail(req.dbPool, {
        storeId: req.user.store_id,
        invoiceId: req.params.id,
        ...emailPayload(req.body),
      });
      res.json(result);
    } catch (err) {
      console.error('Erreur envoi email PDF facture :', {
        message: err.message,
        status: err.status || 500,
        invoice_id: req.params.id,
      });
      res.status(err.status || 500).json({ error: err.expose ? err.message : (err.message || 'Erreur envoi email facture') });
    }
  }
);

module.exports = router;
