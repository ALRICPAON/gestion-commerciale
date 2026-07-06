const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const {
  buildCustomerTariffEmailPreview,
  sendCustomerTariffEmails,
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
    const preview = await buildCustomerTariffEmailPreview(req.dbPool, req.user.store_id);
    res.json(preview);
  } catch (err) {
    console.error('Erreur GET /api/customer-price-lists/email/preview :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur preview emails tarifs' });
  }
});

router.post('/send', authenticateToken, attachDbContext, requireTariffEmailSender, async (req, res) => {
  try {
    const result = await sendCustomerTariffEmails(req.dbPool, req.user.store_id, {
      subject: req.body && req.body.subject,
      intro_text: req.body && req.body.intro_text,
    });

    res.json(result);
  } catch (err) {
    console.error('Erreur POST /api/customer-price-lists/email/send :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur envoi emails tarifs' });
  }
});

module.exports = router;
