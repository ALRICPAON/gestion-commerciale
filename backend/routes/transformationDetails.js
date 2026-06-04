const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

async function canAccessDepartment(client, { userId, storeId, departmentId }) {
  if (!departmentId) return false;
  const result = await client.query(
    `
    SELECT 1
    FROM user_departments ud
    JOIN departments d ON d.id = ud.department_id
    WHERE ud.user_id = $1
      AND ud.department_id = $2
      AND d.store_id = $3
    LIMIT 1
    `,
    [userId, departmentId, storeId]
  );
  return result.rows.length > 0;
}

async function getInputs(client, storeId, transformationId) {
  const result = await client.query(
    `
    SELECT
      ti.*,
      a.plu AS article_plu,
      a.designation AS article_designation
    FROM transformation_inputs ti
    LEFT JOIN articles a
      ON a.id = ti.article_id
     AND a.store_id = ti.store_id
    WHERE ti.transformation_id = $1
      AND ti.store_id = $2
    ORDER BY ti.line_number ASC, ti.created_at ASC
    `,
    [transformationId, storeId]
  );
  return result.rows;
}

async function getOutputs(client, storeId, transformationId) {
  const result = await client.query(
    `
    SELECT
      too.*,
      a.plu AS article_plu,
      a.designation AS article_designation,
      l.lot_code AS created_lot_code
    FROM transformation_outputs too
    LEFT JOIN articles a
      ON a.id = too.article_id
     AND a.store_id = too.store_id
    LEFT JOIN lots l
      ON l.id = too.created_lot_id
     AND l.store_id = too.store_id
    WHERE too.transformation_id = $1
      AND too.store_id = $2
    ORDER BY too.line_number ASC, too.created_at ASC
    `,
    [transformationId, storeId]
  );
  return result.rows;
}

async function getMetadata(client, storeId, transformationId) {
  const result = await client.query(
    `
    SELECT id, meta_key, meta_value, metadata, notes, created_at, updated_at
    FROM transformation_metadata
    WHERE transformation_id = $1
      AND store_id = $2
    ORDER BY created_at ASC
    `,
    [transformationId, storeId]
  );
  return result.rows;
}

function mapTransformation(row) {
  return {
    id: row.id,
    store_id: row.store_id,
    department_id: row.department_id || null,
    transformation_date: row.transformation_date || row.document_date || row.date || null,
    status: row.status || 'draft',
    transformation_type: row.transformation_type || row.type || 'simple',
    reference_number: row.reference_number || row.reference || null,
    notes: row.notes || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function mapInput(row) {
  const sourceMetadata = row.source_metadata || {};
  return {
    id: row.id,
    article_id: row.article_id,
    article_plu: row.article_plu || row.article_plu_snapshot || null,
    article_name: row.article_designation || row.article_label || null,
    input_quantity: toNumberOrNull(row.input_quantity),
    input_unit: row.input_unit || 'kg',
    unit_cost_ex_vat: toNumberOrNull(row.unit_cost_ex_vat),
    total_cost_ex_vat: toNumberOrNull(row.total_cost_ex_vat),
    line_status: row.line_status || 'pending',
    source_metadata: sourceMetadata,
  };
}

function mapOutput(row) {
  const outputMetadata = row.output_metadata || {};
  return {
    id: row.id,
    article_id: row.article_id,
    article_plu: row.article_plu || row.article_plu_snapshot || null,
    article_name: row.article_designation || row.article_label || null,
    output_quantity: toNumberOrNull(row.output_quantity),
    output_unit: row.output_unit || 'kg',
    unit_cost_ex_vat: toNumberOrNull(row.unit_cost_ex_vat),
    total_cost_ex_vat: toNumberOrNull(row.total_cost_ex_vat),
    line_status: row.line_status || 'pending',
    created_lot_id: row.created_lot_id || outputMetadata.created_lot_id || null,
    created_lot_code: row.created_lot_code || outputMetadata.created_lot_code || null,
    output_metadata: outputMetadata,
  };
}

router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const transformationId = clean(req.params.id);
    if (!transformationId || !isUuid(transformationId)) {
      return res.status(400).json({ error: 'ID transformation invalide' });
    }

    const transformationRow = await getTransformation(req.dbPool, req.user.store_id, transformationId);
    if (!transformationRow) return res.status(404).json({ error: 'Transformation introuvable' });

    const canAccess = await canAccessDepartment(req.dbPool, {
      userId: req.user.id,
      storeId: req.user.store_id,
      departmentId: transformationRow.department_id,
    });
    if (!canAccess) return res.status(403).json({ error: 'Accès interdit à ce rayon' });

    const [inputRows, outputRows, metadata] = await Promise.all([
      getInputs(req.dbPool, req.user.store_id, transformationId),
      getOutputs(req.dbPool, req.user.store_id, transformationId),
      getMetadata(req.dbPool, req.user.store_id, transformationId),
    ]);

    const inputs = inputRows.map(mapInput);
    const outputs = outputRows.map(mapOutput);
    const sourceInputLots = inputs.flatMap((input) => input.source_metadata?.source_input_lots || []);

    return res.json({
      transformation: mapTransformation(transformationRow),
      inputs,
      outputs,
      metadata,
      input_lots: sourceInputLots,
    });
  } catch (err) {
    console.error('Erreur GET /api/transformations/:id :', err);
    return res.status(500).json({ error: 'Erreur détail transformation' });
  }
});

module.exports = router;
