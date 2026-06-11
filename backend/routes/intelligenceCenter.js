const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { buildIntelligenceAlerts } = require('../services/intelligence/alertEngine');

const router = express.Router();

router.get('/intelligence-center', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const alerts = await buildIntelligenceAlerts(req.dbPool, req.user.store_id);
    res.json({ alerts });
  } catch (error) {
    console.error('Erreur GET /api/intelligence-center :', {
      message: error.message,
      code: error.code || null,
    });
    res.status(500).json({ error: 'Erreur centre de surveillance' });
  }
});

module.exports = router;
