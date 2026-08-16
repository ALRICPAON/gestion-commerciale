const fs = require('fs');
const path = require('path');

const { recomputeArticleStock } = require('./stockService');

const STATUS_DRAFT = 'draft';
const STATUS_VALIDATED = 'validated';
const STATUS_CANCELLED = 'cancelled';

const SOURCE_MOVEMENT = 'packing_source_out';
const MATERIAL_MOVEMENT = 'packing_material_out';
const OUTPUT_MOVEMENT = 'packing_output_in';

const ERROR_DEFINITIONS = {
  PACKING_NOT_FOUND: [404, 'Operation de colisage introuvable'],
  PACKING_NOT_DRAFT: [409, 'Operation de colisage non modifiable'],
  PACKING_ALREADY_VALIDATED: [409, 'Operation de colisage deja validee'],
  PACKING_SOURCE_STOCK_INSUFFICIENT: [409, 'Stock poisson insuffisant pour le colisage'],
  PACKING_MATERIAL_STOCK_INSUFFICIENT: [409, 'Stock emballage insuffisant pour le colisage'],
  PACKING_SOURCE_LOT_BLOCKED: [409, 'Lot source bloque pour raison qualite'],
  PACKING_MATERIAL_LOT_BLOCKED: [409, 'Lot emballage bloque pour raison qualite'],
  PACKING_INVALID_OUTPUT_QUANTITY: [400, 'Quantite de sortie colisage invalide'],
  PACKING_OUTPUT_ARTICLE_INVALID: [400, 'Article de sortie colisage invalide'],
  PACKING_SOURCE_ARTICLE_INVALID: [400, 'Lot source poisson invalide'],
  PACKING_MATERIAL_ARTICLE_INVALID: [400, 'Lot emballage invalide'],
  PACKING_INVALID_QUANTITY: [400, 'Quantite colisage invalide'],
  PACKING_LINE_DUPLICATE: [409, 'Lot deja present dans cette operation de colisage'],
};

function packingError(code, details = null) {
  const [status, message] = ERROR_DEFINITIONS[code] || [500, 'Erreur colisage'];
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function clean(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value) {
  const parsed = number(value, 0);
  return parsed > 0 ? parsed : 0;
}

function round3(value) {
  return Number(number(value, 0).toFixed(3));
}

function round4(value) {
  return Number(number(value, 0).toFixed(4));
}

function sameQuantity(a, b, tolerance = 0.001) {
  return Math.abs(number(a, 0) - number(b, 0)) <= tolerance;
}

function normalizeDraftQuantities({ packageCount, quantityPerPackage, totalOutputQuantity }) {
  const packages = positiveNumber(packageCount);
  const perPackage = positiveNumber(quantityPerPackage);
  const computedTotal = packages > 0 && perPackage > 0 ? round4(packages * perPackage) : 0;
  const total = totalOutputQuantity !== undefined && totalOutputQuantity !== null && totalOutputQuantity !== ''
    ? positiveNumber(totalOutputQuantity)
    : computedTotal;

  if (packages <= 0 || perPackage <= 0 || total <= 0 || !sameQuantity(total, computedTotal)) {
    throw packingError('PACKING_INVALID_OUTPUT_QUANTITY');
  }

  return {
    packageCount: round4(packages),
    quantityPerPackage: round4(perPackage),
    totalOutputQuantity: round4(total),
  };
}

async function withTransaction(dbPool, callback) {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function assertOutputArticle(client, storeId, articleId) {
  const result = await client.query(
    `SELECT id, plu, designation, COALESCE(article_category, 'product') AS article_category
     FROM articles
     WHERE id = $1::uuid
       AND store_id = $2::uuid
       AND COALESCE(is_active, true) = true
     LIMIT 1`,
    [articleId, storeId]
  );
  const article = result.rows[0];
  if (!article || article.article_category !== 'product') {
    throw packingError('PACKING_OUTPUT_ARTICLE_INVALID', { article_id: articleId });
  }
  return article;
}

async function getOperationForUpdate(client, storeId, operationId) {
  const result = await client.query(
    `SELECT *
     FROM packing_operations
     WHERE id = $1::uuid
       AND store_id = $2::uuid
     FOR UPDATE`,
    [operationId, storeId]
  );
  const operation = result.rows[0];
  if (!operation) throw packingError('PACKING_NOT_FOUND', { packing_operation_id: operationId });
  return operation;
}

function assertDraft(operation) {
  if (operation.status === STATUS_VALIDATED) {
    throw packingError('PACKING_ALREADY_VALIDATED', { packing_operation_id: operation.id });
  }
  if (operation.status !== STATUS_DRAFT) {
    throw packingError('PACKING_NOT_DRAFT', { packing_operation_id: operation.id, status: operation.status });
  }
}

async function getLotWithArticle(client, storeId, lotId, { forUpdate = false } = {}) {
  const result = await client.query(
    `SELECT
       l.*,
       a.plu AS article_plu,
       a.designation AS article_designation,
       COALESCE(a.article_category, 'product') AS article_category
     FROM lots l
     JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     WHERE l.id = $1::uuid
       AND l.store_id = $2::uuid
     ${forUpdate ? 'FOR UPDATE OF l' : ''}`,
    [lotId, storeId]
  );
  return result.rows[0] || null;
}

function assertLotUsableForPacking(lot, blockedCode) {
  if (clean(lot?.quality_status, 'available') === 'blocked') {
    throw packingError(blockedCode, { lot_id: lot.id, lot_code: lot.lot_code });
  }
}

function assertLotStock(lot, qty, errorCode) {
  if (number(lot.qty_remaining, 0) + 0.0001 < qty) {
    throw packingError(errorCode, {
      lot_id: lot.id,
      lot_code: lot.lot_code,
      requested_quantity: qty,
      qty_remaining: number(lot.qty_remaining, 0),
    });
  }
}

async function refreshDraftCosts(client, storeId, operationId) {
  const result = await client.query(
    `SELECT
       COALESCE((SELECT SUM(line_cost_ex_vat) FROM packing_source_lots WHERE store_id = $1::uuid AND packing_operation_id = $2::uuid), 0) AS fish_cost,
       COALESCE((SELECT SUM(line_cost_ex_vat) FROM packing_materials WHERE store_id = $1::uuid AND packing_operation_id = $2::uuid), 0) AS packaging_cost,
       po.total_output_quantity
     FROM packing_operations po
     WHERE po.id = $2::uuid
       AND po.store_id = $1::uuid`,
    [storeId, operationId]
  );
  const row = result.rows[0];
  if (!row) throw packingError('PACKING_NOT_FOUND', { packing_operation_id: operationId });
  const fishCost = round4(row.fish_cost);
  const packagingCost = round4(row.packaging_cost);
  const totalCost = round4(fishCost + packagingCost);
  const unitCost = number(row.total_output_quantity, 0) > 0
    ? round4(totalCost / number(row.total_output_quantity, 0))
    : 0;

  await client.query(
    `UPDATE packing_operations
     SET fish_cost_ex_vat = $3::numeric,
         packaging_cost_ex_vat = $4::numeric,
         total_cost_ex_vat = $5::numeric,
         unit_cost_ex_vat = $6::numeric,
         updated_at = NOW()
     WHERE id = $1::uuid
       AND store_id = $2::uuid`,
    [operationId, storeId, fishCost, packagingCost, totalCost, unitCost]
  );
}

async function createPackingDraft(dbPool, input) {
  return withTransaction(dbPool, async (client) => {
    const quantities = normalizeDraftQuantities(input);
    await assertOutputArticle(client, input.storeId, input.outputArticleId);

    const result = await client.query(
      `INSERT INTO packing_operations (
         store_id, output_article_id, total_output_quantity, package_count,
         quantity_per_package, notes, created_by
       ) VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric, $6::text, $7::uuid)
       RETURNING *`,
      [
        input.storeId,
        input.outputArticleId,
        quantities.totalOutputQuantity,
        quantities.packageCount,
        quantities.quantityPerPackage,
        clean(input.notes),
        input.userId || null,
      ]
    );
    return getPackingOperation(client, input.storeId, result.rows[0].id);
  });
}

async function listPackingOperations(db, storeId, { status = null, limit = 50 } = {}) {
  const params = [storeId];
  let where = 'po.store_id = $1::uuid';
  if (status) {
    params.push(status);
    where += ` AND po.status = $${params.length}::text`;
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const result = await db.query(
    `SELECT po.*, a.plu AS output_article_plu, a.designation AS output_article_designation,
            l.lot_code AS output_lot_code
     FROM packing_operations po
     JOIN articles a ON a.id = po.output_article_id AND a.store_id = po.store_id
     LEFT JOIN lots l ON l.id = po.output_lot_id AND l.store_id = po.store_id
     WHERE ${where}
     ORDER BY po.created_at DESC, po.id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

async function getPackingOperation(db, storeId, operationId) {
  const operationResult = await db.query(
    `SELECT po.*, a.plu AS output_article_plu, a.designation AS output_article_designation,
            l.lot_code AS output_lot_code
     FROM packing_operations po
     JOIN articles a ON a.id = po.output_article_id AND a.store_id = po.store_id
     LEFT JOIN lots l ON l.id = po.output_lot_id AND l.store_id = po.store_id
     WHERE po.id = $1::uuid
       AND po.store_id = $2::uuid
     LIMIT 1`,
    [operationId, storeId]
  );
  const operation = operationResult.rows[0];
  if (!operation) throw packingError('PACKING_NOT_FOUND', { packing_operation_id: operationId });

  const sourceLots = await db.query(
    `SELECT psl.*, l.lot_code, l.supplier_lot_number, l.qty_remaining,
            a.plu AS article_plu, a.designation AS article_designation
     FROM packing_source_lots psl
     JOIN lots l ON l.id = psl.lot_id AND l.store_id = psl.store_id
     JOIN articles a ON a.id = psl.article_id AND a.store_id = psl.store_id
     WHERE psl.packing_operation_id = $1::uuid
       AND psl.store_id = $2::uuid
     ORDER BY psl.created_at ASC, psl.id ASC`,
    [operationId, storeId]
  );
  const materials = await db.query(
    `SELECT pm.*, l.lot_code, l.supplier_lot_number, l.qty_remaining,
            a.plu AS article_plu, a.designation AS article_designation
     FROM packing_materials pm
     JOIN lots l ON l.id = pm.lot_id AND l.store_id = pm.store_id
     JOIN articles a ON a.id = pm.article_id AND a.store_id = pm.store_id
     WHERE pm.packing_operation_id = $1::uuid
       AND pm.store_id = $2::uuid
     ORDER BY pm.created_at ASC, pm.id ASC`,
    [operationId, storeId]
  );

  return {
    ...operation,
    source_lots: sourceLots.rows,
    materials: materials.rows,
  };
}

async function addPackingSourceLot(dbPool, input) {
  return withTransaction(dbPool, async (client) => {
    const operation = await getOperationForUpdate(client, input.storeId, input.packingOperationId);
    assertDraft(operation);
    const qty = positiveNumber(input.quantityUsed);
    if (qty <= 0) throw packingError('PACKING_INVALID_QUANTITY');

    const lot = await getLotWithArticle(client, input.storeId, input.lotId);
    if (!lot || lot.article_category !== 'product') {
      throw packingError('PACKING_SOURCE_ARTICLE_INVALID', { lot_id: input.lotId });
    }
    assertLotUsableForPacking(lot, 'PACKING_SOURCE_LOT_BLOCKED');
    assertLotStock(lot, qty, 'PACKING_SOURCE_STOCK_INSUFFICIENT');

    const unitCost = round4(lot.unit_cost_ex_vat);
    const lineCost = round4(qty * unitCost);
    await client.query(
      `INSERT INTO packing_source_lots (
         store_id, packing_operation_id, lot_id, article_id, quantity_used,
         unit_cost_ex_vat, line_cost_ex_vat
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric, $6::numeric, $7::numeric)`,
      [input.storeId, input.packingOperationId, input.lotId, lot.article_id, round4(qty), unitCost, lineCost]
    ).catch((error) => {
      if (error.code === '23505') throw packingError('PACKING_LINE_DUPLICATE', { lot_id: input.lotId });
      throw error;
    });

    await refreshDraftCosts(client, input.storeId, input.packingOperationId);
    return getPackingOperation(client, input.storeId, input.packingOperationId);
  });
}

async function addPackingMaterial(dbPool, input) {
  return withTransaction(dbPool, async (client) => {
    const operation = await getOperationForUpdate(client, input.storeId, input.packingOperationId);
    assertDraft(operation);
    const qty = positiveNumber(input.quantityUsed);
    if (qty <= 0) throw packingError('PACKING_INVALID_QUANTITY');

    const lot = await getLotWithArticle(client, input.storeId, input.lotId);
    if (!lot || lot.article_category !== 'packaging') {
      throw packingError('PACKING_MATERIAL_ARTICLE_INVALID', { lot_id: input.lotId });
    }
    assertLotUsableForPacking(lot, 'PACKING_MATERIAL_LOT_BLOCKED');
    assertLotStock(lot, qty, 'PACKING_MATERIAL_STOCK_INSUFFICIENT');

    const unitCost = round4(lot.unit_cost_ex_vat);
    const lineCost = round4(qty * unitCost);
    await client.query(
      `INSERT INTO packing_materials (
         store_id, packing_operation_id, article_id, lot_id, quantity_used,
         unit_cost_ex_vat, line_cost_ex_vat
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric, $6::numeric, $7::numeric)`,
      [input.storeId, input.packingOperationId, lot.article_id, input.lotId, round4(qty), unitCost, lineCost]
    ).catch((error) => {
      if (error.code === '23505') throw packingError('PACKING_LINE_DUPLICATE', { lot_id: input.lotId });
      throw error;
    });

    await refreshDraftCosts(client, input.storeId, input.packingOperationId);
    return getPackingOperation(client, input.storeId, input.packingOperationId);
  });
}

async function removePackingSourceLot(dbPool, { storeId, packingOperationId, lineId }) {
  return withTransaction(dbPool, async (client) => {
    const operation = await getOperationForUpdate(client, storeId, packingOperationId);
    assertDraft(operation);
    await client.query(
      `DELETE FROM packing_source_lots
       WHERE id = $1::uuid
         AND packing_operation_id = $2::uuid
         AND store_id = $3::uuid`,
      [lineId, packingOperationId, storeId]
    );
    await refreshDraftCosts(client, storeId, packingOperationId);
    return getPackingOperation(client, storeId, packingOperationId);
  });
}

async function removePackingMaterial(dbPool, { storeId, packingOperationId, lineId }) {
  return withTransaction(dbPool, async (client) => {
    const operation = await getOperationForUpdate(client, storeId, packingOperationId);
    assertDraft(operation);
    await client.query(
      `DELETE FROM packing_materials
       WHERE id = $1::uuid
         AND packing_operation_id = $2::uuid
         AND store_id = $3::uuid`,
      [lineId, packingOperationId, storeId]
    );
    await refreshDraftCosts(client, storeId, packingOperationId);
    return getPackingOperation(client, storeId, packingOperationId);
  });
}

async function updatePackingDraft(dbPool, input) {
  return withTransaction(dbPool, async (client) => {
    const operation = await getOperationForUpdate(client, input.storeId, input.packingOperationId);
    assertDraft(operation);

    const outputArticleId = input.outputArticleId || operation.output_article_id;
    if (input.outputArticleId) await assertOutputArticle(client, input.storeId, input.outputArticleId);

    const quantities = normalizeDraftQuantities({
      packageCount: input.packageCount ?? operation.package_count,
      quantityPerPackage: input.quantityPerPackage ?? operation.quantity_per_package,
      totalOutputQuantity: input.totalOutputQuantity ?? null,
    });

    await client.query(
      `UPDATE packing_operations
       SET output_article_id = $3::uuid,
           total_output_quantity = $4::numeric,
           package_count = $5::numeric,
           quantity_per_package = $6::numeric,
           notes = $7::text,
           updated_at = NOW()
       WHERE id = $1::uuid
         AND store_id = $2::uuid`,
      [
        input.packingOperationId,
        input.storeId,
        outputArticleId,
        quantities.totalOutputQuantity,
        quantities.packageCount,
        quantities.quantityPerPackage,
        input.notes !== undefined ? clean(input.notes) : operation.notes,
      ]
    );
    await refreshDraftCosts(client, input.storeId, input.packingOperationId);
    return getPackingOperation(client, input.storeId, input.packingOperationId);
  });
}

async function cancelPackingDraft(dbPool, { storeId, packingOperationId, userId = null }) {
  return withTransaction(dbPool, async (client) => {
    const operation = await getOperationForUpdate(client, storeId, packingOperationId);
    assertDraft(operation);
    await client.query(
      `UPDATE packing_operations
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1::uuid
         AND store_id = $2::uuid`,
      [packingOperationId, storeId]
    );
    return getPackingOperation(client, storeId, packingOperationId);
  });
}

function buildOutputTraceability({ operation, outputArticle, sourceLots, materials }) {
  return {
    source_type: 'packing',
    packing_operation_id: operation.id,
    package_count: number(operation.package_count, 0),
    quantity_per_package: number(operation.quantity_per_package, 0),
    total_output_quantity: number(operation.total_output_quantity, 0),
    output_article: {
      id: outputArticle.id,
      plu: outputArticle.plu || null,
      designation: outputArticle.designation || null,
    },
    source_lots: sourceLots.map((line) => ({
      lot_id: line.lot_id,
      lot_code: line.lot_code || null,
      supplier_lot_number: line.supplier_lot_number || null,
      article_id: line.article_id,
      plu: line.article_plu || null,
      designation: line.article_designation || null,
      quantity_used: number(line.quantity_used, 0),
      unit_cost_ex_vat: number(line.unit_cost_ex_vat, 0),
      line_cost_ex_vat: number(line.line_cost_ex_vat, 0),
    })),
    materials: materials.map((line) => ({
      lot_id: line.lot_id,
      lot_code: line.lot_code || null,
      supplier_lot_number: line.supplier_lot_number || null,
      article_id: line.article_id,
      plu: line.article_plu || null,
      designation: line.article_designation || null,
      quantity_used: number(line.quantity_used, 0),
      unit_cost_ex_vat: number(line.unit_cost_ex_vat, 0),
      line_cost_ex_vat: number(line.line_cost_ex_vat, 0),
    })),
  };
}

async function loadPackingLinesForValidation(client, storeId, operationId, tableName) {
  const result = await client.query(
    `SELECT line.*, l.lot_code, l.supplier_lot_number, l.qty_remaining, l.unit_cost_ex_vat AS current_unit_cost_ex_vat,
            l.dlc, l.supplier_id, l.quality_status, a.plu AS article_plu, a.designation AS article_designation,
            COALESCE(a.article_category, 'product') AS article_category
     FROM ${tableName} line
     JOIN lots l ON l.id = line.lot_id AND l.store_id = line.store_id
     JOIN articles a ON a.id = line.article_id AND a.store_id = line.store_id
     WHERE line.store_id = $1::uuid
       AND line.packing_operation_id = $2::uuid
     ORDER BY line.created_at ASC, line.id ASC
     FOR UPDATE OF l`,
    [storeId, operationId]
  );
  return result.rows;
}

async function validatePackingOperation(dbPool, input) {
  return withTransaction(dbPool, async (client) => {
    const operation = await getOperationForUpdate(client, input.storeId, input.packingOperationId);
    assertDraft(operation);

    const outputArticle = await assertOutputArticle(client, input.storeId, operation.output_article_id);
    const sourceLots = await loadPackingLinesForValidation(client, input.storeId, operation.id, 'packing_source_lots');
    const materials = await loadPackingLinesForValidation(client, input.storeId, operation.id, 'packing_materials');

    if (!sourceLots.length) throw packingError('PACKING_SOURCE_ARTICLE_INVALID');

    let sourceQty = 0;
    let fishCost = 0;
    let packagingCost = 0;

    for (const line of sourceLots) {
      if (line.article_category !== 'product') throw packingError('PACKING_SOURCE_ARTICLE_INVALID', { lot_id: line.lot_id });
      assertLotUsableForPacking(line, 'PACKING_SOURCE_LOT_BLOCKED');
      const qty = number(line.quantity_used, 0);
      assertLotStock(line, qty, 'PACKING_SOURCE_STOCK_INSUFFICIENT');
      sourceQty += qty;
      fishCost += qty * number(line.current_unit_cost_ex_vat, line.unit_cost_ex_vat);
    }

    for (const line of materials) {
      if (line.article_category !== 'packaging') throw packingError('PACKING_MATERIAL_ARTICLE_INVALID', { lot_id: line.lot_id });
      assertLotUsableForPacking(line, 'PACKING_MATERIAL_LOT_BLOCKED');
      const qty = number(line.quantity_used, 0);
      assertLotStock(line, qty, 'PACKING_MATERIAL_STOCK_INSUFFICIENT');
      packagingCost += qty * number(line.current_unit_cost_ex_vat, line.unit_cost_ex_vat);
    }

    if (!sameQuantity(sourceQty, operation.total_output_quantity)) {
      throw packingError('PACKING_INVALID_OUTPUT_QUANTITY', {
        source_quantity: round4(sourceQty),
        total_output_quantity: number(operation.total_output_quantity, 0),
      });
    }

    fishCost = round4(fishCost);
    packagingCost = round4(packagingCost);
    const totalCost = round4(fishCost + packagingCost);
    const outputQty = round3(operation.total_output_quantity);
    const unitCost = outputQty > 0 ? round4(totalCost / outputQty) : 0;

    for (const line of sourceLots) {
      const qty = round3(line.quantity_used);
      const updateResult = await client.query(
        `UPDATE lots
         SET qty_remaining = qty_remaining - $3::numeric,
             updated_at = NOW()
         WHERE id = $1::uuid
           AND store_id = $2::uuid
           AND qty_remaining + 0.0001 >= $3::numeric
           AND COALESCE(quality_status, 'available') <> 'blocked'
         RETURNING id`,
        [line.lot_id, input.storeId, qty]
      );
      if (!updateResult.rows.length) throw packingError('PACKING_SOURCE_STOCK_INSUFFICIENT', { lot_id: line.lot_id });
      await client.query(
        `INSERT INTO stock_movements (
           id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat,
           source_table, source_id, notes, created_by
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::numeric, $7::numeric,
           'packing_operations', $8::uuid, $9::text, $10::uuid
         )`,
        [
          input.storeId,
          input.clientKey || null,
          line.article_id,
          line.lot_id,
          SOURCE_MOVEMENT,
          -qty,
          round4(line.current_unit_cost_ex_vat),
          operation.id,
          `Sortie poisson colisage ${operation.id}`,
          input.userId || null,
        ]
      );
    }

    for (const line of materials) {
      const qty = round3(line.quantity_used);
      const updateResult = await client.query(
        `UPDATE lots
         SET qty_remaining = qty_remaining - $3::numeric,
             updated_at = NOW()
         WHERE id = $1::uuid
           AND store_id = $2::uuid
           AND qty_remaining + 0.0001 >= $3::numeric
           AND COALESCE(quality_status, 'available') <> 'blocked'
         RETURNING id`,
        [line.lot_id, input.storeId, qty]
      );
      if (!updateResult.rows.length) throw packingError('PACKING_MATERIAL_STOCK_INSUFFICIENT', { lot_id: line.lot_id });
      await client.query(
        `INSERT INTO stock_movements (
           id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat,
           source_table, source_id, notes, created_by
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::numeric, $7::numeric,
           'packing_operations', $8::uuid, $9::text, $10::uuid
         )`,
        [
          input.storeId,
          input.clientKey || null,
          line.article_id,
          line.lot_id,
          MATERIAL_MOVEMENT,
          -qty,
          round4(line.current_unit_cost_ex_vat),
          operation.id,
          `Sortie emballage colisage ${operation.id}`,
          input.userId || null,
        ]
      );
    }

    const nearestDlc = sourceLots.map((line) => line.dlc).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
    const supplierId = sourceLots[0]?.supplier_id || null;
    const lotCode = `PKG-${String(outputArticle.plu || 'NOPLU').replace(/\s+/g, '').toUpperCase()}-${String(operation.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const traceability = buildOutputTraceability({ operation, outputArticle, sourceLots, materials });

    const lotResult = await client.query(
      `INSERT INTO lots (
         id, store_id, client_key, article_id, purchase_id, purchase_line_id, supplier_id,
         lot_code, supplier_lot_number, source_type, qty_initial, qty_remaining,
         unit_cost_ex_vat, dlc, traceability_data, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1::uuid, $2::text, $3::uuid, NULL, NULL, $4::uuid,
         $5::text, NULL, 'packing', $6::numeric, $6::numeric,
         $7::numeric, $8::date, $9::jsonb, NOW(), NOW()
       )
       RETURNING id, lot_code`,
      [
        input.storeId,
        input.clientKey || null,
        outputArticle.id,
        supplierId,
        lotCode,
        outputQty,
        unitCost,
        nearestDlc,
        JSON.stringify(traceability),
      ]
    );
    const outputLot = lotResult.rows[0];

    await client.query(
      `INSERT INTO stock_movements (
         id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat,
         source_table, source_id, notes, created_by
       ) VALUES (
         gen_random_uuid(), $1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::numeric, $7::numeric,
         'packing_operations', $8::uuid, $9::text, $10::uuid
       )`,
      [
        input.storeId,
        input.clientKey || null,
        outputArticle.id,
        outputLot.id,
        OUTPUT_MOVEMENT,
        outputQty,
        unitCost,
        operation.id,
        `Entree colisage ${operation.id}`,
        input.userId || null,
      ]
    );

    await client.query(
      `UPDATE packing_operations
       SET status = 'validated',
           output_lot_id = $3::uuid,
           fish_cost_ex_vat = $4::numeric,
           packaging_cost_ex_vat = $5::numeric,
           total_cost_ex_vat = $6::numeric,
           unit_cost_ex_vat = $7::numeric,
           validated_by = $8::uuid,
           validated_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid
         AND store_id = $2::uuid`,
      [
        operation.id,
        input.storeId,
        outputLot.id,
        fishCost,
        packagingCost,
        totalCost,
        unitCost,
        input.userId || null,
      ]
    );

    const impactedArticles = new Set([
      outputArticle.id,
      ...sourceLots.map((line) => line.article_id),
      ...materials.map((line) => line.article_id),
    ]);
    for (const articleId of impactedArticles) {
      await recomputeArticleStock(client, articleId, input.storeId);
    }

    return getPackingOperation(client, input.storeId, operation.id);
  });
}

function applyPackingMigrationSqlForTests() {
  return fs.readFileSync(path.join(__dirname, '..', 'db', 'gestion-commerciale', '106_packing_foundation.sql'), 'utf8');
}

module.exports = {
  MATERIAL_MOVEMENT,
  OUTPUT_MOVEMENT,
  SOURCE_MOVEMENT,
  STATUS_CANCELLED,
  STATUS_DRAFT,
  STATUS_VALIDATED,
  addPackingMaterial,
  addPackingSourceLot,
  applyPackingMigrationSqlForTests,
  buildOutputTraceability,
  cancelPackingDraft,
  createPackingDraft,
  getPackingOperation,
  listPackingOperations,
  normalizeDraftQuantities,
  packingError,
  removePackingMaterial,
  removePackingSourceLot,
  updatePackingDraft,
  validatePackingOperation,
};
