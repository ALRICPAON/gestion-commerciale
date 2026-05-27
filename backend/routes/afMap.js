const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

router.get('/af-map', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `
      SELECT 
        m.id,
        s.code AS supplier_code,
        s.name AS supplier_name,
        a.plu,
        a.designation AS article_name,
        m.supplier_ref,
        m.supplier_label,
        m.purchase_unit,
        m.conversion_to_stock,
        m.is_active
      FROM supplier_article_mappings m
      JOIN suppliers s ON m.supplier_id = s.id
      JOIN articles a ON m.article_id = a.id
      WHERE s.store_id = $1
      ORDER BY s.code ASC, m.supplier_ref ASC
      `,
      [req.user.store_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/af-map :', err);
    res.status(500).json({ error: 'Erreur serveur AF_MAP' });
  }
});

router.post('/af-map', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const {
      supplier_code,
      plu,
      supplier_ref,
      supplier_label,
    } = req.body;

    if (!supplier_code || !plu || !supplier_ref) {
      return res.status(400).json({
        error: 'supplier_code, plu et supplier_ref sont obligatoires'
      });
    }

    const supplierResult = await req.dbPool.query(
      `
      SELECT id
      FROM suppliers
      WHERE store_id = $1
        AND code = $2
      LIMIT 1
      `,
      [req.user.store_id, supplier_code]
    );

    if (supplierResult.rows.length === 0) {
      return res.status(404).json({ error: 'Fournisseur introuvable' });
    }

    const articleResult = await req.dbPool.query(
      `
      SELECT id
      FROM articles
      WHERE store_id = $1
        AND plu = $2
      LIMIT 1
      `,
      [req.user.store_id, plu]
    );

    if (articleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const result = await req.dbPool.query(
      `
      INSERT INTO supplier_article_mappings (
        supplier_id,
        article_id,
        supplier_ref,
        supplier_label,
        purchase_unit,
        conversion_to_stock,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING id
      `,
      [
        supplierResult.rows[0].id,
        articleResult.rows[0].id,
        supplier_ref,
        supplier_label || null,
        'kg',
        1,
      ]
    );

    res.status(201).json({
      ok: true,
      id: result.rows[0].id,
    });
  } catch (err) {
    console.error('Erreur POST /api/af-map :', err);

    if (err.code === '23505') {
      return res.status(400).json({
        error: 'Cette référence fournisseur existe déjà pour ce fournisseur'
      });
    }

    res.status(500).json({ error: 'Erreur serveur AF_MAP' });
  }
});

router.post('/purchases/:id/apply-af-mappings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const purchaseId = req.params.id;

    const purchaseResult = await client.query(
      `
      SELECT id, store_id, supplier_id, department_id, status
      FROM purchases
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [purchaseId, req.user.store_id]
    );

    if (purchaseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const purchase = purchaseResult.rows[0];

    if (!['ordered', 'draft', 'receiving'].includes(purchase.status)) {
      return res.status(400).json({
        error: 'Impossible d’appliquer les mappings sur un achat verrouillé',
      });
    }

    await client.query('BEGIN');

    const linesResult = await client.query(
      `
      SELECT
        pl.id,
        pl.supplier_reference,
        pl.article_id,
        pl.supplier_article_mapping_id
      FROM purchase_lines pl
      WHERE pl.purchase_id = $1
      ORDER BY pl.line_number ASC
      `,
      [purchaseId]
    );

    let updatedCount = 0;

    for (const line of linesResult.rows) {
      if (!line.supplier_reference) continue;
      if (line.article_id && line.supplier_article_mapping_id) continue;

      const mappingResult = await client.query(
        `
        SELECT m.id, m.article_id
        FROM supplier_article_mappings m
        WHERE m.supplier_id = $1
          AND m.supplier_ref = $2
          AND m.is_active = true
        LIMIT 1
        `,
        [purchase.supplier_id, line.supplier_reference]
      );

      if (mappingResult.rows.length === 0) continue;

      const mapping = mappingResult.rows[0];

      await client.query(
        `
        UPDATE purchase_lines
        SET
          supplier_article_mapping_id = $1,
          article_id = COALESCE(article_id, $2),
          updated_at = NOW()
        WHERE id = $3
        `,
        [mapping.id, mapping.article_id, line.id]
      );

      updatedCount += 1;
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      updated_lines: updatedCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/purchases/:id/apply-af-mappings :', err);
    res.status(500).json({ error: 'Erreur application mappings achat' });
  } finally {
    client.release();
  }
});

router.patch('/af-map/:id/status', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const mappingId = req.params.id;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active doit être un booléen' });
    }

    const result = await req.dbPool.query(
      `
      UPDATE supplier_article_mappings m
      SET is_active = $1
      FROM suppliers s
      WHERE m.id = $2
        AND m.supplier_id = s.id
        AND s.store_id = $3
      RETURNING m.id
      `,
      [is_active, mappingId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ligne AF_MAP introuvable' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur PATCH /api/af-map/:id/status :', err);
    res.status(500).json({ error: 'Erreur serveur AF_MAP' });
  }
});

module.exports = router;
