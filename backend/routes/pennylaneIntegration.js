const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { requireAdminOrManager } = require('../middleware/authorization');
const { testPennylaneConnection } = require('../services/pennylane');

const router = express.Router();

router.get('/integrations/pennylane/test', authenticateToken, requireAdminOrManager, async (req, res) => {
  try {
    const result = await testPennylaneConnection();

    if (result.connected) {
      console.info('Test connexion Pennylane OK', {
        environment: result.environment,
        user_id: req.user.id,
        store_id: req.user.store_id,
      });
    } else {
      console.warn('Test connexion Pennylane KO', {
        environment: result.environment,
        user_id: req.user.id,
        store_id: req.user.store_id,
        message: result.message,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('Erreur GET /api/integrations/pennylane/test :', err);
    return res.status(500).json({
      connected: false,
      environment: process.env.PENNYLANE_ENV || 'sandbox',
      message: 'Erreur serveur pendant le test Pennylane.',
      pennylane_response: null,
    });
  }
});

module.exports = router;
