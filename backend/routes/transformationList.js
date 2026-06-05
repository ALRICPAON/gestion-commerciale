const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function safeLimit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    let where = 'WHERE t.store_id = $1';

    const status = clean(req.query.status);
    if (status) {
      params.push(status);
      where += ` AND t.status = $${params.length}`;
    }

    params.push(safeLimit(req.query.limit));
    const result = await req.dbPool.query(
      `
      SELECT
        t.id,
        t.store_id,
        t.department_id,
        t.transformation_date,
        t.status,
        t.reference_number,
        t.notes,
        t.created_at,
        t.updated_at,
        ti.id AS input_line_id,
        ti.article_id AS input_article_id,
        COALESCE(ti.article_plu, input_article.plu) AS input_plu,
        COALESCE(ti.article_label, input_article.designation) AS input_designation,
        ti.input_quantity,
        ti.input_unit,
        too.id AS output_line_id,
        too.article_id AS output_article_id,
        COALESCE(too.article_plu, output_article.plu) AS output_plu,
        COALESCE(too.article_label, output_article.designation) AS output_designation,
        too.output_quantity,
        too.output_unit,
        too.created_lot_id,
        created_lot.lot_code AS created_lot_code
      FROM transformations t
      LEFT JOIN LATERAL (
        SELECT *
        FROM transformation_inputs ti
        WHERE ti.transformation_id = t.id
          AND ti.store_id = t.store_id
        ORDER BY ti.line_number ASC, ti.created_at ASC
        LIMIT 1
      ) ti ON true
      LEFT JOIN articles input_article
        ON input_article.id = ti.article_id
       AND input_article.store_id = ti.store_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM transformation_outputs too
        WHERE too.transformation_id = t.id
          AND too.store_id = t.store_id
        ORDER BY too.line_number ASC, too.created_at ASC
        LIMIT 1
      ) too ON true
      LEFT JOIN articles output_article
        ON output_article.id = too.article_id
       AND output_article.store_id = too.store_id
      LEFT JOIN lots created_lot
        ON created_lot.id = too.created_lot_id
       AND created_lot.store_id = too.store_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    return res.json(result.rows.map((row) => ({
      id: row.id,
      store_id: row.store_id,
      department_id: row.department_id || null,
      transformation_date: row.transformation_date || null,
      status: row.status || 'draft',
      reference_number: row.reference_number || null,
      notes: row.notes || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      input_line_id: row.input_line_id || null,
      input_article_id: row.input_article_id || null,
      input_plu: row.input_plu || null,
      input_designation: row.input_designation || null,
      input_quantity: toNumberOrNull(row.input_quantity),
      input_unit: row.input_unit || 'kg',
      output_line_id: row.output_line_id || null,
      output_article_id: row.output_article_id || null,
      output_plu: row.output_plu || null,
      output_designation: row.output_designation || null,
      output_quantity: toNumberOrNull(row.output_quantity),
      output_unit: row.output_unit || 'kg',
      created_lot_id: row.created_lot_id || null,
      created_lot_code: row.created_lot_code || null,
    })));
  } catch (err) {
    console.error('Erreur GET /api/transformations :', err);
    return res.status(500).json({ error: 'Erreur serveur transformations' });
  }
});

module.exports = router;
