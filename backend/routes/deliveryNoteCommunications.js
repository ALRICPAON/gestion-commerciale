const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const {
  getDeliveryNoteCommunicationContext,
  sendDeliveryNoteEmail,
  sendDeliveryNoteWhatsapp,
} = require('../services/deliveryNoteCommunicationService');

const router = express.Router();

router.get('/delivery-notes/:id/communication-options', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const context = await getDeliveryNoteCommunicationContext(req.dbPool, {
      storeId: req.user.store_id,
      deliveryNoteId: req.params.id,
    });

    res.json({
      delivery_note_id: context.document.id,
      delivery_note_reference: context.document.reference_number,
      client_name: context.document.client_name,
      billed_client_name: context.document.billed_client_name,
      email: context.contacts.email,
      email_source: context.contacts.email_source,
      phone: context.contacts.phone,
      whatsapp_phone: context.contacts.whatsapp_phone,
      phone_source: context.contacts.phone_source,
      can_send_email: Boolean(context.contacts.email),
      can_send_whatsapp: Boolean(context.contacts.whatsapp_phone),
    });
  } catch (err) {
    console.error('Erreur options communication BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur options communication BL' });
  }
});

router.post('/delivery-notes/:id/send-email', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await sendDeliveryNoteEmail(req.dbPool, {
      storeId: req.user.store_id,
      deliveryNoteId: req.params.id,
      to: req.body?.to,
      subject: req.body?.subject,
      message: req.body?.message,
    });
    res.json(result);
  } catch (err) {
    console.error('Erreur envoi email BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur envoi email BL' });
  }
});

router.post('/delivery-notes/:id/send-whatsapp', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await sendDeliveryNoteWhatsapp(req.dbPool, {
      storeId: req.user.store_id,
      deliveryNoteId: req.params.id,
      to: req.body?.to,
      templateName: req.body?.template_name,
      languageCode: req.body?.language_code,
    });
    res.json(result);
  } catch (err) {
    console.error('Erreur envoi WhatsApp BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur envoi WhatsApp BL' });
  }
});

module.exports = router;
