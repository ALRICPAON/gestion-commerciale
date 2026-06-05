const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveQty(value) {
  const parsed = toNumber(value, 0);
  return parsed > 0 ? Number(parsed.toFixed(3)) : 0;
}

function normalizeUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (['piece', 'pièce', 'pieces', 'pièces', 'pcs', 'pc', 'unite', 'unité'].includes(unit)) return 'piece';
  if (['colis', 'box', 'carton', 'cartons'].includes(unit)) return 'colis';
  return 'kg';
}

async function getTransformation(client, storeId, transformationId) {
  const result = await client.query(
    `
    SELECT *
    FROM transformations
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
    `,
    [transformationId, storeId]
  );
  return result.rows[0] || null;
}

async function getArticle(client, storeId, articleId) {
  if (!articleId || !isUuid(articleId)) return null;
  const result = await client.query(
    `
    SELECT id, plu, designation, unit
    FROM articles
    WHERE id = $1
      AND store_id = $2
      AND COALESCE(is_active, true) = true
    LIMIT 1
    `,
    [articleId, storeId]
  );
  return result.rows[0] || null;
}

async function upsertInputLine(client, { transformation, article, quantity, unit, userId }) {
  const existing = await client.query(
    `
    SELECT id
    FROM transformation_inputs
    WHERE transformation_id = $1
      AND store_id = $2
    ORDER BY line_number ASC, created_at ASC
    LIMIT 1
    `,
    [transformation.id, transformation.store_id]
  );

  const params = [
    article.id,
    article.plu || null,
    article.designation || null,
    quantity,
    unit,
    JSON.stringify({ role: 'input' }),
    userId,
  ];

  if (existing.rows.length) {
    await client.query(
      `
      UPDATE transformation_inputs
      SET
        article_id = $1,
        article_plu = $2,
        article_label = $3,
        input_quantity = $4,
        input_unit = $5,
        source_metadata = $6::jsonb,
        line_number = 1,
        line_status = 'pending',
        updated_by = $7,
        updated_at = NOW()
      WHERE id = $8
        AND store_id = $9
      `,
      [...params, existing.rows[0].id, transformation.store_id]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `
    INSERT INTO transformation_inputs (
      id,
      transformation_id,
      store_id,
      department_id,
      client_key,
      article_id,
      line_number,
      article_plu,
      article_label,
      input_quantity,
      input_unit,
      line_status,
      source_metadata,
      created_by,
      updated_by,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, 1, $6, $7, $8, $9, 'pending', $10::jsonb, $11, $11, NOW(), NOW()
    )
    RETURNING id
    `,
    [
      transformation.id,
      transformation.store_id,
      transformation.department_id || null,
      transformation.client_key || null,
      article.id,
      article.plu || null,
      article.designation || null,
      quantity,
      unit,
      JSON.stringify({ role: 'input' }),
      userId,
    ]
  );
  return inserted.rows[0].id;
}

async function upsertOutputLine(client, { transformation, article, quantity, unit, userId }) {
  const existing = await client.query(
    `
    SELECT id
    FROM transformation_outputs
    WHERE transformation_id = $1
      AND store_id = $2
    ORDER BY line_number ASC, created_at ASC
    LIMIT 1
    `,
    [transformation.id, transformation.store_id]
  );

  const params = [
    article.id,
    article.plu || null,
    article.designation || null,
    quantity,
    unit,
    JSON.stringify({ role: 'output' }),
    userId,
  ];

  if (existing.rows.length) {
    await client.query(
      `
      UPDATE transformation_outputs
      SET
        article_id = $1,
        article_plu = $2,
        article_label = $3,
        output_quantity = $4,
        output_unit = $5,
        output_metadata = $6::jsonb,
        line_number = 1,
        line_status = 'pending',
        updated_by = $7,
        updated_at = NOW()
      WHERE id = $8
        AND store_id = $9
      `,
      [...params, existing.rows[0].id, transformation.store_id]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `
    INSERT INTO transformation_outputs (
      id,
      transformation_id,
      store_id,
      department_id,
      client_key,
      article_id,
      line_number,
      article_plu,
      article_label,
      output_quantity,
      output_unit,
      line_status,
      output_metadata,
      created_by,
      updated_by,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, 1, $6, $7, $8, $9, 'pending', $10::jsonb, $11, $11, NOW(), NOW()
    )
    RETURNING id
    `,
    [
      transformation.id,
      transformation.store_id,
      transformation.department_id || null,
      transformation.client_key || null,
      article.id,
      article.plu || null,
      article.designation || null,
      quantity,
      unit,
      JSON.stringify({ role: 'output' }),
      userId,
    ]
  );
  return inserted.rows[0].id;
}

router.patch('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const transformationId = clean(req.params.id);
    if (!transformationId || !isUuid(transformationId)) return res.status(400).json({ error: 'ID transformation invalide' });

    const inputQty = positiveQty(req.body.input_quantity);
    const outputQty = positiveQty(req.body.output_quantity);
    const inputArticleId = clean(req.body.input_article_id);
    const outputArticleId = clean(req.body.output_article_id);

    await client.query('BEGIN');

    const transformation = await getTransformation(client, req.user.store_id, transformationId);
    if (!transformation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }
    if (transformation.status === 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Une transformation validée ne peut plus être modifiée' });
    }

    const updateResult = await client.query(
      `
      UPDATE transformations
      SET
        transformation_date = COALESCE($1::date, transformation_date),
        reference_number = $2,
        notes = $3,
        updated_by = $4,
        updated_at = NOW()
      WHERE id = $5
        AND store_id = $6
      RETURNING *
      `,
      [clean(req.body.transformation_date), clean(req.body.reference_number), clean(req.body.notes), req.user.id, transformationId, req.user.store_id]
    );
    const updatedTransformation = updateResult.rows[0] || transformation;

    if (inputArticleId || inputQty > 0) {
      if (!inputArticleId || !isUuid(inputArticleId)) throw new Error('Article source obligatoire');
      if (inputQty <= 0) throw new Error('Quantité source invalide');
      const article = await getArticle(client, req.user.store_id, inputArticleId);
      if (!article) throw new Error('Article source introuvable');
      await upsertInputLine(client, {
        transformation: updatedTransformation,
        article,
        quantity: inputQty,
        unit: normalizeUnit(req.body.input_unit || article.unit),
        userId: req.user.id,
      });
    }

    if (outputArticleId || outputQty > 0) {
      if (!outputArticleId || !isUuid(outputArticleId)) throw new Error('Article cible obligatoire');
      if (outputQty <= 0) throw new Error('Quantité cible invalide');
      const article = await getArticle(client, req.user.store_id, outputArticleId);
      if (!article) throw new Error('Article cible introuvable');
      await upsertOutputLine(client, {
        transformation: updatedTransformation,
        article,
        quantity: outputQty,
        unit: normalizeUnit(req.body.output_unit || article.unit),
        userId: req.user.id,
      });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, message: 'Transformation enregistrée' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/transformations/:id :', err);
    return res.status(err.status || 500).json({ error: err.message || 'Erreur mise à jour transformation' });
  } finally {
    client.release();
  }
});

module.exports = router;
