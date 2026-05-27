const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const departmentId = req.query.department_id || null;

    const params = [req.user.store_id];
    let where = `WHERE ss.store_id = $1`;

    if (departmentId) {
      params.push(departmentId);
      where += ` AND ss.department_id = $${params.length}`;
    }

    const result = await req.dbPool.query(
      `
      SELECT
        ss.id,
        ss.store_id,
        ss.department_id,
        ss.article_id,
        a.plu,
        a.designation,
        a.unit,
        a.ean,
        ss.stock_quantity,
        ss.stock_value_ex_vat,
        ss.pma,
        ss.next_dlc,
        ss.updated_at,

        ad.display_name,
        ds.code AS sector_code,
        ds.name AS sector_name,

        adm.category,
        adm.latin_name,
        adm.fao_zone,
        adm.sous_zone,
        adm.engin,
        adm.allergenes,

        sap.pv_ttc_real

      FROM stock_summary ss
      JOIN articles a
        ON a.id = ss.article_id
      LEFT JOIN article_departments ad
        ON ad.article_id = a.id
       AND ad.department_id = ss.department_id
      LEFT JOIN department_sectors ds
        ON ds.id = ad.department_sector_id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key = 'v2_import'
      LEFT JOIN stock_article_pricing sap
        ON sap.article_id = ss.article_id
       AND sap.department_id = ss.department_id
       AND sap.store_id = ss.store_id
      ${where}
      ORDER BY ds.code ASC NULLS LAST, a.designation ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/stock :', err);
    res.status(500).json({ error: 'Erreur serveur stock' });
  }
});

router.patch('/:articleId/pricing', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const articleId = req.params.articleId;
    const { department_id, pv_ttc_real } = req.body;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    if (pv_ttc_real !== null && pv_ttc_real !== undefined && pv_ttc_real !== '') {
      const n = Number(pv_ttc_real);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'pv_ttc_real invalide' });
      }
    }

    const departmentCheck = await req.dbPool.query(
      `
      SELECT id
      FROM departments
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [department_id, req.user.store_id]
    );

    if (departmentCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    const articleCheck = await req.dbPool.query(
      `
      SELECT id
      FROM articles
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [articleId, req.user.store_id]
    );

    if (articleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const numericPv =
      pv_ttc_real === null || pv_ttc_real === undefined || pv_ttc_real === ''
        ? null
        : Number(pv_ttc_real);

    const result = await req.dbPool.query(
      `
      INSERT INTO stock_article_pricing (
        store_id,
        department_id,
        article_id,
        pv_ttc_real
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (store_id, department_id, article_id)
      DO UPDATE SET
        pv_ttc_real = EXCLUDED.pv_ttc_real,
        updated_at = NOW()
      RETURNING *
      `,
      [req.user.store_id, department_id, articleId, numericPv]
    );

    res.json({
      ok: true,
      pricing: result.rows[0],
    });
  } catch (err) {
    console.error('Erreur PATCH /api/stock/:articleId/pricing :', err);
    res.status(500).json({ error: 'Erreur serveur pricing stock' });
  }
});

module.exports = router;
