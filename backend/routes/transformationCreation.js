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

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function ensureTransformationTables(client) {
  const result = await client.query(
    `
    SELECT
      to_regclass('public.transformations') AS transformations,
      to_regclass('public.transformation_inputs') AS transformation_inputs,
      to_regclass('public.transformation_outputs') AS transformation_outputs,
      to_regclass('public.transformation_metadata') AS transformation_metadata
    `
  );
  return result.rows[0] || {};
}

function buildInsert(tableName, columns, candidates) {
  const names = [];
  const values = [];
  const params = [];

  for (const candidate of candidates) {
    if (!columns.has(candidate.column)) continue;
    names.push(quoteIdentifier(candidate.column));
    if (candidate.raw) {
      values.push(candidate.raw);
      continue;
    }
    params.push(candidate.value);
    values.push(candidate.cast ? `$${params.length}::${candidate.cast}` : `$${params.length}`);
  }

  if (!names.length) {
    throw new Error(`Aucune colonne compatible pour ${tableName}`);
  }

  return {
    sql: `
      INSERT INTO ${quoteIdentifier(tableName)} (${names.join(', ')})
      VALUES (${values.join(', ')})
      RETURNING *
    `,
    params,
  };
}

function mapCreatedTransformation(row) {
  return {
    id: row.id,
    store_id: row.store_id,
    transformation_date: row.transformation_date || row.document_date || row.date || null,
    status: row.status || 'draft',
    transformation_type: row.transformation_type || row.type || 'simple',
    reference_number: row.reference_number || row.reference || null,
    notes: row.notes || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function createTransformationMetadata(client, { tableStatus, transformation, storeId, clientKey, userId, body }) {
  if (!tableStatus.transformation_metadata) return;

  const columns = await getTableColumns(client, 'transformation_metadata');
  const metadata = {
    source_type: 'transformation',
    status: 'draft',
    transformation_date: transformation.transformation_date || transformation.document_date || body.transformation_date || null,
    created_from: 'api',
  };

  const insert = buildInsert('transformation_metadata', columns, [
    { column: 'id', raw: 'gen_random_uuid()' },
    { column: 'transformation_id', value: transformation.id },
    { column: 'store_id', value: storeId },
    { column: 'client_key', value: clientKey || null },
    { column: 'meta_key', value: 'creation' },
    { column: 'meta_value', value: JSON.stringify(metadata), cast: 'jsonb' },
    { column: 'metadata', value: JSON.stringify(metadata), cast: 'jsonb' },
    { column: 'notes', value: clean(body.notes) },
    { column: 'created_by', value: userId },
    { column: 'updated_by', value: userId },
    { column: 'created_at', raw: 'NOW()' },
    { column: 'updated_at', raw: 'NOW()' },
  ]);

  await client.query(insert.sql, insert.params);
}

router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');

    const tableStatus = await ensureTransformationTables(client);
    if (!tableStatus.transformations) {
      throw new Error('Table transformations introuvable');
    }

    const columns = await getTableColumns(client, 'transformations');
    const insert = buildInsert('transformations', columns, [
      { column: 'id', raw: 'gen_random_uuid()' },
      { column: 'store_id', value: req.user.store_id },
      { column: 'client_key', value: req.user.client_key || null },
      { column: 'transformation_date', value: clean(req.body.transformation_date), cast: 'date' },
      { column: 'document_date', value: clean(req.body.transformation_date), cast: 'date' },
      { column: 'date', value: clean(req.body.transformation_date), cast: 'date' },
      { column: 'status', value: 'draft' },
      { column: 'transformation_type', value: 'simple' },
      { column: 'type', value: 'simple' },
      { column: 'source_type', value: 'transformation' },
      { column: 'reference_number', value: clean(req.body.reference_number) },
      { column: 'reference', value: clean(req.body.reference_number) },
      { column: 'notes', value: clean(req.body.notes) },
      { column: 'created_by', value: req.user.id },
      { column: 'updated_by', value: req.user.id },
      { column: 'created_at', raw: 'NOW()' },
      { column: 'updated_at', raw: 'NOW()' },
    ]);

    const result = await client.query(insert.sql, insert.params);
    const transformation = result.rows[0];

    await createTransformationMetadata(client, {
      tableStatus,
      transformation,
      storeId: req.user.store_id,
      clientKey: req.user.client_key,
      userId: req.user.id,
      body: req.body,
    });

    await client.query('COMMIT');
    res.status(201).json({ ok: true, transformation: mapCreatedTransformation(transformation) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations :', err);
    res.status(500).json({ error: err.message || 'Erreur création transformation' });
  } finally {
    client.release();
  }
});

module.exports = router;
