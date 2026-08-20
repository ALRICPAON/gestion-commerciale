const crypto = require('crypto');

const ROOT_FIELDS = new Set(['sheet_id', 'line_id', 'line', 'changes']);
const LINE_FIELDS = new Set([
  'article_id',
  'designation',
  'designation_snapshot',
  'supplier_id',
  'purchase_price',
  'purchase_price_ht',
  'unit',
  'price_unit',
  'sale_unit',
  'supplier_available_quantity',
  'sale_price_level_1_ht',
  'sale_price_level_2_ht',
  'sale_price_level_3_ht',
  'tariff_1',
  'tariff_2',
  'tariff_3',
  'display_order',
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function expose(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw expose(400, `${label} doit etre un objet`);
  }
}

function assertId(value, label) {
  const id = clean(value);
  if (!id) throw expose(400, `${label} requis`);
  return id;
}

function nullableNumber(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw expose(400, `${label} doit etre numerique`);
  return parsed;
}

function nullablePositive(value, label) {
  const parsed = nullableNumber(value, label);
  if (parsed !== null && parsed < 0) throw expose(400, `${label} doit etre positif ou nul`);
  return parsed;
}

function normalizedLineChanges(raw = {}) {
  assertObject(raw, 'line');
  const unknown = Object.keys(raw).filter((key) => !LINE_FIELDS.has(key));
  if (unknown.length) throw expose(400, `Champ(s) ligne fiche appel non autorise(s) : ${unknown.join(', ')}`);
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'article_id')) changes.article_id = clean(raw.article_id);
  if (Object.prototype.hasOwnProperty.call(raw, 'designation')) changes.designation_snapshot = clean(raw.designation);
  if (Object.prototype.hasOwnProperty.call(raw, 'designation_snapshot')) changes.designation_snapshot = clean(raw.designation_snapshot);
  if (Object.prototype.hasOwnProperty.call(raw, 'supplier_id')) changes.supplier_id = clean(raw.supplier_id);
  if (Object.prototype.hasOwnProperty.call(raw, 'purchase_price')) changes.purchase_price_ht = nullablePositive(raw.purchase_price, 'purchase_price');
  if (Object.prototype.hasOwnProperty.call(raw, 'purchase_price_ht')) changes.purchase_price_ht = nullablePositive(raw.purchase_price_ht, 'purchase_price_ht');
  if (Object.prototype.hasOwnProperty.call(raw, 'unit')) {
    const unit = clean(raw.unit);
    changes.price_unit = unit;
    changes.sale_unit = unit;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'price_unit')) changes.price_unit = clean(raw.price_unit);
  if (Object.prototype.hasOwnProperty.call(raw, 'sale_unit')) changes.sale_unit = clean(raw.sale_unit);
  if (Object.prototype.hasOwnProperty.call(raw, 'supplier_available_quantity')) {
    changes.supplier_available_quantity = nullablePositive(raw.supplier_available_quantity, 'supplier_available_quantity');
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sale_price_level_1_ht')) changes.sale_price_level_1_ht = nullablePositive(raw.sale_price_level_1_ht, 'sale_price_level_1_ht');
  if (Object.prototype.hasOwnProperty.call(raw, 'sale_price_level_2_ht')) changes.sale_price_level_2_ht = nullablePositive(raw.sale_price_level_2_ht, 'sale_price_level_2_ht');
  if (Object.prototype.hasOwnProperty.call(raw, 'sale_price_level_3_ht')) changes.sale_price_level_3_ht = nullablePositive(raw.sale_price_level_3_ht, 'sale_price_level_3_ht');
  if (Object.prototype.hasOwnProperty.call(raw, 'tariff_1')) changes.sale_price_level_1_ht = nullablePositive(raw.tariff_1, 'tariff_1');
  if (Object.prototype.hasOwnProperty.call(raw, 'tariff_2')) changes.sale_price_level_2_ht = nullablePositive(raw.tariff_2, 'tariff_2');
  if (Object.prototype.hasOwnProperty.call(raw, 'tariff_3')) changes.sale_price_level_3_ht = nullablePositive(raw.tariff_3, 'tariff_3');
  if (Object.prototype.hasOwnProperty.call(raw, 'display_order')) {
    const parsed = Number(raw.display_order);
    if (!Number.isInteger(parsed)) throw expose(400, 'display_order doit etre un entier');
    changes.display_order = parsed;
  }
  if (Object.keys(changes).length === 0) throw expose(400, 'Aucun champ ligne fiche appel fourni');
  return changes;
}

function validateRoot(payload = {}, requiredFields = []) {
  assertObject(payload, 'payload');
  const unknown = Object.keys(payload).filter((key) => !ROOT_FIELDS.has(key));
  if (unknown.length) throw expose(400, `Cle(s) payload non autorisee(s) : ${unknown.join(', ')}`);
  for (const field of requiredFields) assertId(payload[field], field);
}

function normalizeAddLinePayload(payload = {}) {
  validateRoot(payload, ['sheet_id']);
  return {
    sheet_id: clean(payload.sheet_id),
    line: normalizedLineChanges(payload.line || {}),
  };
}

function normalizeUpdateLinePayload(payload = {}) {
  validateRoot(payload, ['line_id']);
  return {
    line_id: clean(payload.line_id),
    changes: normalizedLineChanges(payload.changes || {}),
  };
}

function normalizeDeleteLinePayload(payload = {}) {
  validateRoot(payload, ['line_id']);
  return { line_id: clean(payload.line_id) };
}

function rowSnapshot(row = {}) {
  if (!row) return null;
  return {
    id: row.id,
    store_id: row.store_id,
    sheet_id: row.sheet_id,
    column_uid: row.column_uid,
    article_id: row.article_id,
    plu: row.plu,
    designation: row.designation_snapshot,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name || null,
    display_order: row.display_order,
    purchase_price_ht: row.purchase_price_ht === null || row.purchase_price_ht === undefined ? null : Number(row.purchase_price_ht),
    price_unit: row.price_unit,
    supplier_available_quantity: row.supplier_available_quantity === null || row.supplier_available_quantity === undefined ? null : Number(row.supplier_available_quantity),
    sale_price_level_1_ht: row.sale_price_level_1_ht === null || row.sale_price_level_1_ht === undefined ? null : Number(row.sale_price_level_1_ht),
    sale_price_level_2_ht: row.sale_price_level_2_ht === null || row.sale_price_level_2_ht === undefined ? null : Number(row.sale_price_level_2_ht),
    sale_price_level_3_ht: row.sale_price_level_3_ht === null || row.sale_price_level_3_ht === undefined ? null : Number(row.sale_price_level_3_ht),
    manual_price_level_1: Boolean(row.manual_price_level_1),
    manual_price_level_2: Boolean(row.manual_price_level_2),
    manual_price_level_3: Boolean(row.manual_price_level_3),
    family_code: row.family_code,
    family_name: row.family_name,
    sale_unit: row.sale_unit,
  };
}

async function readLine(db, storeId, lineId) {
  const result = await db.query(
    `SELECT p.*, s.name AS supplier_name
     FROM quick_order_sheet_products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
     WHERE p.store_id = $1 AND p.id = $2
     LIMIT 1`,
    [storeId, lineId]
  );
  return result.rows[0] || null;
}

async function lockSheet(db, storeId, sheetId) {
  const result = await db.query(
    `SELECT qs.*
     FROM quick_order_sheets qs
     WHERE qs.store_id = $1 AND qs.id = $2
     FOR UPDATE OF qs`,
    [storeId, sheetId]
  );
  const sheet = result.rows[0];
  if (!sheet) throw expose(404, 'Fiche appel introuvable pour ce magasin');
  return sheet;
}

async function lockLine(db, storeId, lineId) {
  const result = await db.query(
    `SELECT p.*
     FROM quick_order_sheet_products p
     WHERE p.store_id = $1 AND p.id = $2
     FOR UPDATE OF p`,
    [storeId, lineId]
  );
  return result.rows[0] || null;
}

async function fetchArticle(db, storeId, articleId) {
  if (!articleId) return null;
  const result = await db.query(
    `SELECT id, plu, designation, family_code, family_name, sale_unit, unit
     FROM articles
     WHERE store_id = $1 AND id = $2 AND is_active = true
     LIMIT 1`,
    [storeId, articleId]
  );
  if (!result.rows[0]) throw expose(404, 'Article introuvable pour ce magasin');
  return result.rows[0];
}

async function assertSupplier(db, storeId, supplierId) {
  if (!supplierId) return null;
  const result = await db.query(
    `SELECT id, name FROM suppliers WHERE store_id = $1 AND id = $2 AND COALESCE(status, 'active') <> 'inactive' LIMIT 1`,
    [storeId, supplierId]
  );
  if (!result.rows[0]) throw expose(404, 'Fournisseur introuvable pour ce magasin');
  return result.rows[0];
}

function applyArticleSnapshot(base, article, explicit = {}) {
  if (!article) return base;
  return {
    ...base,
    article_id: article.id,
    plu: article.plu || null,
    designation_snapshot: Object.prototype.hasOwnProperty.call(explicit, 'designation_snapshot')
      ? explicit.designation_snapshot
      : article.designation,
    family_code: article.family_code || null,
    family_name: article.family_name || null,
    sale_unit: base.sale_unit || article.sale_unit || article.unit || base.price_unit || 'kg',
    price_unit: base.price_unit || article.sale_unit || article.unit || 'kg',
  };
}

async function listCallSheets(db, storeId, input = {}) {
  const params = [storeId];
  let where = 'WHERE qs.store_id = $1';
  if (clean(input.date_from)) {
    params.push(clean(input.date_from));
    where += ` AND qs.sheet_date >= $${params.length}::date`;
  }
  if (clean(input.date_to)) {
    params.push(clean(input.date_to));
    where += ` AND qs.sheet_date <= $${params.length}::date`;
  }
  if (clean(input.supplier_id)) {
    params.push(clean(input.supplier_id));
    where += ` AND qs.supplier_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(input.limit) || 30, 1), 100));
  const result = await db.query(
    `SELECT qs.id, qs.sheet_date, qs.title, qs.notes, qs.supplier_id, s.name AS supplier_name,
            qs.default_margin_level_1, qs.default_margin_level_2, qs.default_margin_level_3,
            qs.created_at, qs.updated_at, COUNT(p.id)::int AS line_count
     FROM quick_order_sheets qs
     LEFT JOIN suppliers s ON s.id = qs.supplier_id AND s.store_id = qs.store_id
     LEFT JOIN quick_order_sheet_products p ON p.sheet_id = qs.id AND p.store_id = qs.store_id
     ${where}
     GROUP BY qs.id, s.name
     ORDER BY qs.sheet_date DESC, qs.updated_at DESC
     LIMIT $${params.length}`,
    params
  );
  return { results: result.rows };
}

async function getCallSheet(db, storeId, input = {}) {
  const params = [storeId];
  let where = '';
  if (clean(input.sheet_id || input.id)) {
    params.push(clean(input.sheet_id || input.id));
    where = `qs.id = $${params.length}`;
  } else {
    params.push(clean(input.date || input.sheet_date) || new Date().toISOString().slice(0, 10));
    where = `qs.sheet_date = $${params.length}::date`;
  }
  const header = await db.query(
    `SELECT qs.*, s.name AS supplier_name, s.code AS supplier_code
     FROM quick_order_sheets qs
     LEFT JOIN suppliers s ON s.id = qs.supplier_id AND s.store_id = qs.store_id
     WHERE qs.store_id = $1 AND ${where}
     LIMIT 1`,
    params
  );
  const sheet = header.rows[0];
  if (!sheet) return { exists: false, sheet: null, lines: [] };
  const lines = await db.query(
    `SELECT p.*, a.designation AS article_designation, s.name AS supplier_name
     FROM quick_order_sheet_products p
     LEFT JOIN articles a ON a.id = p.article_id AND a.store_id = p.store_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
     WHERE p.store_id = $1 AND p.sheet_id = $2
     ORDER BY p.display_order ASC, p.created_at ASC`,
    [storeId, sheet.id]
  );
  return { exists: true, sheet, lines: lines.rows.map(rowSnapshot) };
}

async function searchCallSheetLines(db, storeId, input = {}) {
  const query = clean(input.query);
  const params = [storeId];
  let where = 'WHERE p.store_id = $1';
  if (clean(input.sheet_id)) {
    params.push(clean(input.sheet_id));
    where += ` AND p.sheet_id = $${params.length}`;
  }
  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    where += ` AND (LOWER(COALESCE(p.designation_snapshot, '')) LIKE $${params.length}
               OR LOWER(COALESCE(p.plu, '')) LIKE $${params.length}
               OR LOWER(COALESCE(s.name, '')) LIKE $${params.length})`;
  }
  params.push(Math.min(Math.max(Number(input.limit) || 50, 1), 100));
  const result = await db.query(
    `SELECT p.*, s.name AS supplier_name
     FROM quick_order_sheet_products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
     ${where}
     ORDER BY p.updated_at DESC, p.display_order ASC
     LIMIT $${params.length}`,
    params
  );
  return { results: result.rows.map(rowSnapshot) };
}

async function executeAddLine({ db, context, payload }) {
  const normalized = normalizeAddLinePayload(payload);
  const sheet = await lockSheet(db, context.store_id, normalized.sheet_id);
  const article = await fetchArticle(db, context.store_id, normalized.line.article_id);
  const supplierId = normalized.line.supplier_id || sheet.supplier_id || null;
  await assertSupplier(db, context.store_id, supplierId);
  const nextOrder = normalized.line.display_order ?? (await db.query(
    'SELECT COALESCE(MAX(display_order), 0)::int + 1 AS next_order FROM quick_order_sheet_products WHERE store_id = $1 AND sheet_id = $2',
    [context.store_id, normalized.sheet_id]
  )).rows[0].next_order;
  let line = {
    column_uid: `agent-${crypto.randomUUID()}`,
    article_id: normalized.line.article_id || null,
    supplier_id: supplierId,
    plu: null,
    designation_snapshot: normalized.line.designation_snapshot || null,
    display_order: nextOrder,
    purchase_price_ht: normalized.line.purchase_price_ht ?? null,
    price_unit: normalized.line.price_unit || 'kg',
    supplier_available_quantity: normalized.line.supplier_available_quantity ?? null,
    sale_price_level_1_ht: normalized.line.sale_price_level_1_ht ?? null,
    sale_price_level_2_ht: normalized.line.sale_price_level_2_ht ?? null,
    sale_price_level_3_ht: normalized.line.sale_price_level_3_ht ?? null,
    manual_price_level_1: Object.prototype.hasOwnProperty.call(normalized.line, 'sale_price_level_1_ht'),
    manual_price_level_2: Object.prototype.hasOwnProperty.call(normalized.line, 'sale_price_level_2_ht'),
    manual_price_level_3: Object.prototype.hasOwnProperty.call(normalized.line, 'sale_price_level_3_ht'),
    family_code: null,
    family_name: null,
    sale_unit: normalized.line.sale_unit || normalized.line.price_unit || 'kg',
  };
  line = applyArticleSnapshot(line, article, normalized.line);
  if (!clean(line.designation_snapshot)) throw expose(400, 'designation requise si aucun article valide ne fournit de libelle');
  const inserted = await db.query(
    `INSERT INTO quick_order_sheet_products (
      store_id, sheet_id, column_uid, article_id, supplier_id, plu, designation_snapshot,
      display_order, purchase_price_ht, price_unit, supplier_available_quantity,
      sale_price_level_1_ht, sale_price_level_2_ht, sale_price_level_3_ht,
      manual_price_level_1, manual_price_level_2, manual_price_level_3,
      family_code, family_name, sale_unit
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
    ) RETURNING id`,
    [
      context.store_id, normalized.sheet_id, line.column_uid, line.article_id, line.supplier_id, line.plu, line.designation_snapshot,
      line.display_order, line.purchase_price_ht, line.price_unit, line.supplier_available_quantity,
      line.sale_price_level_1_ht, line.sale_price_level_2_ht, line.sale_price_level_3_ht,
      line.manual_price_level_1, line.manual_price_level_2, line.manual_price_level_3,
      line.family_code, line.family_name, line.sale_unit,
    ]
  );
  await db.query('UPDATE quick_order_sheets SET updated_by = COALESCE($3, updated_by), updated_at = NOW() WHERE store_id = $1 AND id = $2', [context.store_id, normalized.sheet_id, context.user_id || null]);
  const after = await readLine(db, context.store_id, inserted.rows[0].id);
  return { ok: true, mode: 'executed', action: 'call_sheet.add_line', module: 'call_sheet', target_type: 'quick_order_sheet_product', target_id: after.id, after: rowSnapshot(after) };
}

async function executeUpdateLine({ db, context, payload }) {
  const normalized = normalizeUpdateLinePayload(payload);
  const before = await lockLine(db, context.store_id, normalized.line_id);
  if (!before) throw expose(404, 'Ligne fiche appel introuvable pour ce magasin');
  await lockSheet(db, context.store_id, before.sheet_id);
  const article = Object.prototype.hasOwnProperty.call(normalized.changes, 'article_id')
    ? await fetchArticle(db, context.store_id, normalized.changes.article_id)
    : null;
  const supplierId = Object.prototype.hasOwnProperty.call(normalized.changes, 'supplier_id') ? normalized.changes.supplier_id : before.supplier_id;
  await assertSupplier(db, context.store_id, supplierId);
  let next = { ...before, ...normalized.changes, supplier_id: supplierId };
  next = applyArticleSnapshot(next, article, normalized.changes);
  if (!clean(next.designation_snapshot)) throw expose(400, 'designation requise');
  if (Object.prototype.hasOwnProperty.call(normalized.changes, 'sale_price_level_1_ht')) next.manual_price_level_1 = true;
  if (Object.prototype.hasOwnProperty.call(normalized.changes, 'sale_price_level_2_ht')) next.manual_price_level_2 = true;
  if (Object.prototype.hasOwnProperty.call(normalized.changes, 'sale_price_level_3_ht')) next.manual_price_level_3 = true;
  await db.query(
    `UPDATE quick_order_sheet_products
     SET article_id=$3, supplier_id=$4, plu=$5, designation_snapshot=$6,
         display_order=$7, purchase_price_ht=$8, price_unit=$9, supplier_available_quantity=$10,
         sale_price_level_1_ht=$11, sale_price_level_2_ht=$12, sale_price_level_3_ht=$13,
         manual_price_level_1=$14, manual_price_level_2=$15, manual_price_level_3=$16,
         family_code=$17, family_name=$18, sale_unit=$19
     WHERE store_id=$1 AND id=$2`,
    [
      context.store_id, normalized.line_id, next.article_id, next.supplier_id, next.plu, next.designation_snapshot,
      next.display_order, next.purchase_price_ht, next.price_unit, next.supplier_available_quantity,
      next.sale_price_level_1_ht, next.sale_price_level_2_ht, next.sale_price_level_3_ht,
      next.manual_price_level_1, next.manual_price_level_2, next.manual_price_level_3,
      next.family_code, next.family_name, next.sale_unit,
    ]
  );
  await db.query('UPDATE quick_order_sheets SET updated_by = COALESCE($3, updated_by), updated_at = NOW() WHERE store_id = $1 AND id = $2', [context.store_id, before.sheet_id, context.user_id || null]);
  const after = await readLine(db, context.store_id, normalized.line_id);
  return { ok: true, mode: 'executed', action: 'call_sheet.update_line', module: 'call_sheet', target_type: 'quick_order_sheet_product', target_id: after.id, before: rowSnapshot(before), after: rowSnapshot(after), changes: normalized.changes };
}

async function executeDeleteLine({ db, context, payload }) {
  const normalized = normalizeDeleteLinePayload(payload);
  const before = await lockLine(db, context.store_id, normalized.line_id);
  if (!before) throw expose(404, 'Ligne fiche appel introuvable pour ce magasin');
  await lockSheet(db, context.store_id, before.sheet_id);
  await db.query('DELETE FROM quick_order_sheet_products WHERE store_id = $1 AND id = $2', [context.store_id, normalized.line_id]);
  await db.query('UPDATE quick_order_sheets SET updated_by = COALESCE($3, updated_by), updated_at = NOW() WHERE store_id = $1 AND id = $2', [context.store_id, before.sheet_id, context.user_id || null]);
  const after = await readLine(db, context.store_id, normalized.line_id);
  if (after) throw expose(409, 'La ligne fiche appel existe encore apres suppression');
  return { ok: true, mode: 'executed', action: 'call_sheet.delete_line', module: 'call_sheet', target_type: 'quick_order_sheet_product', target_id: normalized.line_id, before: rowSnapshot(before), deleted: true };
}

module.exports = {
  listCallSheets,
  getCallSheet,
  searchCallSheetLines,
  normalizeAddLinePayload,
  normalizeUpdateLinePayload,
  normalizeDeleteLinePayload,
  executeAddLine,
  executeUpdateLine,
  executeDeleteLine,
};
