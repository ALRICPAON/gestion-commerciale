const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const {
  buildCustomerTariffEmailPreview,
  fetchCustomerTariffEmailHistory,
  sendCustomerTariffEmails,
  sendCustomerTariffTestEmail,
} = require('../services/customerTariffEmailService');

const router = express.Router();

function requireTariffEmailSender(req, res, next) {
  const allowedRoles = ['admin', 'responsable', 'commercial'];
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acces refuse' });
  }
  return next();
}

router.get('/preview', authenticateToken, attachDbContext, requireTariffEmailSender, async (req, res) => {
  try {
    const preview = await buildCustomerTariffEmailPreview(req.dbPool, req.user.store_id, {
      price_list_id: req.query.price_list_id,
      price_list_date: req.query.price_list_date,
      mercuriale_date: req.query.mercuriale_date,
      common_message: req.query.common_message,
    });
    res.json(preview);
  } catch (err) {
    console.error('Erreur GET /api/customer-price-lists/email/preview :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur preview emails tarifs' });
  }
});

router.post('/send', authenticateToken, attachDbContext, requireTariffEmailSender, async (req, res) => {
  try {
    const result = await sendCustomerTariffEmails(req.dbPool, req.user.store_id, {
      user_id: req.user.id,
      price_list_id: req.body?.price_list_id,
      price_list_date: req.body?.price_list_date,
      mercuriale_date: req.body?.mercuriale_date,
      common_message: req.body?.common_message,
      selected_client_ids: req.body?.selected_client_ids,
    });

    res.json(result);
  } catch (err) {
    console.error('Erreur POST /api/customer-price-lists/email/send :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur envoi emails tarifs' });
  }
});

router.post('/test', authenticateToken, attachDbContext, requireTariffEmailSender, async (req, res) => {
  try {
    const result = await sendCustomerTariffTestEmail(req.dbPool, req.user.store_id, {
      to: req.body?.to,
      user_id: req.user.id,
      price_list_id: req.body?.price_list_id,
      price_list_date: req.body?.price_list_date,
      mercuriale_date: req.body?.mercuriale_date,
      common_message: req.body?.common_message,
      selected_client_ids: req.body?.selected_client_ids,
    });

    res.json(result);
  } catch (err) {
    console.error('Erreur POST /api/customer-price-lists/email/test :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur test email mercuriale' });
  }
});

router.get('/history', authenticateToken, attachDbContext, requireTariffEmailSender, async (req, res) => {
  try {
    const history = await fetchCustomerTariffEmailHistory(req.dbPool, req.user.store_id, req.query.limit);
    res.json({ history });
  } catch (err) {
    console.error('Erreur GET /api/customer-price-lists/email/history :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur historique emails mercuriales' });
  }
});

module.exports = router;
