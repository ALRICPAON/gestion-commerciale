const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

const DEFAULT_COMPANY_NAME = 'ALTA MARÉE';

router.get('/store-branding', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `
      SELECT company_name, logo_url
      FROM store_settings
      WHERE store_id = $1
      LIMIT 1
      `,
      [req.user.store_id]
    );

    const settings = result.rows[0] || {};

    res.json({
      company_name: settings.company_name || DEFAULT_COMPANY_NAME,
      logo_url: settings.logo_url || null,
    });
  } catch (err) {
    console.error('Erreur GET /api/store-branding :', err);
    res.status(500).json({ error: 'Erreur serveur branding société' });
  }
});

module.exports = router;
