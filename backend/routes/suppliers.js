const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

router.get('/suppliers', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `
      SELECT
        id,
        code,
        name,
        contact_name,
        phone,
        email,
        address,
        is_active,
        created_at
      FROM suppliers
      WHERE store_id = $1
      ORDER BY code ASC, name ASC
      `,
      [req.user.store_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/suppliers :', err);
    res.status(500).json({ error: 'Erreur serveur fournisseurs' });
  }
});

router.post('/suppliers', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const {
      code,
      name,
      contact_name,
      phone,
      email,
      address,
    } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'code et name obligatoires' });
    }

    const result = await req.dbPool.query(
      `
      INSERT INTO suppliers (
        id,
        store_id,
        code,
        name,
        contact_name,
        phone,
        email,
        address,
        is_active
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7, true
      )
      RETURNING *
      `,
      [
        req.user.store_id,
        code,
        name,
        contact_name || null,
        phone || null,
        email || null,
        address || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur POST /api/suppliers :', err);

    if (err.code === '23505') {
      return res.status(400).json({ error: 'Code fournisseur déjà existant' });
    }

    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/suppliers/:id/status', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const supplierId = req.params.id;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active doit être un booléen' });
    }

    const result = await req.dbPool.query(
      `
      UPDATE suppliers
      SET is_active = $1
      WHERE id = $2
        AND store_id = $3
      RETURNING id
      `,
      [is_active, supplierId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fournisseur introuvable' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur PATCH supplier status :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
