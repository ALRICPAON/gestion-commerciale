const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function safeLimit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
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

function mergeUnique(values) {
  return [...new Set((values || []).flat().filter((value) => value !== undefined && value !== null && value !== ''))];
}

function documentSelectSql() {
  return `
    SELECT
      sd.*,
      input_line.id AS input_line_id,
      input_line.article_id AS input_article_id,
      input_line.article_label AS input_article_label,
      input_line.sold_quantity AS input_quantity,
      input_line.sale_unit AS input_unit,
      input_line.source_inventory_line AS input_metadata,
      input_article.plu AS input_plu,
      input_article.designation AS input_designation,
      output_line.id AS output_line_id,
      output_line.article_id AS output_article_id,
      output_line.article_label AS output_article_label,
      output_line.sold_quantity AS output_quantity,
      output_line.sale_unit AS output_unit,
      output_line.unit_cost_ex_vat AS output_unit_cost_ex_vat,
      output_line.source_inventory_line AS output_metadata,
      output_article.plu AS output_plu,
      output_article.designation AS output_designation
    FROM sales_documents sd
    LEFT JOIN sales_lines input_line
      ON input_line.sales_document_id = sd.id
     AND input_line.store_id = sd.store_id
     AND input_line.line_reason = 'transformation_input'
    LEFT JOIN articles input_article
      ON input_article.id = input_line.article_id
     AND input_article.store_id = input_line.store_id
    LEFT JOIN sales_lines output_line
      ON output_line.sales_document_id = sd.id
     AND output_line.store_id = sd.store_id
     AND output_line.line_reason = 'transformation_output'
    LEFT JOIN articles output_article
      ON output_article.id = output_line.article_id
     AND output_article.store_id = output_line.store_id
  `;
}

async function getArticle(client, storeId, articleId) {
  if (!articleId || !isUuid(articleId)) return null;
  const result = await client.query(
    `
    SELECT id, plu, designation, unit, family_name, latin_name, fao_zone, sous_zone, fishing_gear, production_method, allergens
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

async function upsertTransformationLine(client, { documentId, storeId, clientKey, role, lineNumber, article, quantity, unit, metadata = {} }) {
  const existing = await client.query(
    `
    SELECT id
    FROM sales_lines
    WHERE sales_document_id = $1
      AND store_id = $2
      AND line_reason = $3
    LIMIT 1
    `,
    [documentId, storeId, role]
  );

  if (existing.rows.length) {
    await client.query(
      `
      UPDATE sales_lines
      SET
        article_id = $1,
        article_label = $2,
        sold_quantity = $3,
        sale_unit = $4,
        source_inventory_line = $5::jsonb,
        updated_at = NOW()
      WHERE id = $6
        AND store_id = $7
      `,
      [article.id, article.designation, quantity, unit, JSON.stringify(metadata), existing.rows[0].id, storeId]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `
    INSERT INTO sales_lines (
      id,
      sales_document_id,
      store_id,
      client_key,
      article_id,
      line_number,
      article_label,
      sold_quantity,
      sale_unit,
      unit_cost_ex_vat,
      line_reason,
      line_status,
      source_inventory_line
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 0, $9, 'pending', $10::jsonb
    )
    RETURNING id
    `,
    [documentId, storeId, clientKey || null, article.id, lineNumber, article.designation, quantity, unit, role, JSON.stringify(metadata)]
  );
  return inserted.rows[0].id;
}

async function getAvailableLots(client, { storeId, articleId }) {
  const result = await client.query(
    `
    SELECT
      l.id AS lot_id,
      l.lot_code,
      l.supplier_lot_number,
      l.qty_initial,
      l.qty_remaining,
      l.unit_cost_ex_vat,
      l.dlc,
      l.created_at,
      l.supplier_id,
      l.traceability_data,
      s.name AS supplier_name
    FROM lots l
    LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
    WHERE l.store_id = $1
      AND l.article_id = $2
      AND l.qty_remaining > 0
    ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
    `,
    [storeId, articleId]
  );
  return result.rows;
}

async function selectLots(client, { storeId, articleId, requiredQty, selectionMode, manualLots }) {
  const qtyNeeded = positiveQty(requiredQty);
  if (qtyNeeded <= 0) throw new Error('Quantité source invalide');

  if (selectionMode === 'manual') {
    if (!Array.isArray(manualLots) || manualLots.length === 0) throw new Error('Aucun lot manuel fourni');

    const selected = [];
    let totalSelected = 0;

    for (let index = 0; index < manualLots.length; index += 1) {
      const row = manualLots[index] || {};
      const lotId = clean(row.lot_id || row.lotId);
      const quantityTaken = positiveQty(row.quantity_taken ?? row.quantity ?? row.qty);
      if (!lotId || quantityTaken <= 0) continue;

      const lotResult = await client.query(
        `
        SELECT
          l.id AS lot_id,
          l.lot_code,
          l.supplier_lot_number,
          l.qty_initial,
          l.qty_remaining,
          l.unit_cost_ex_vat,
          l.dlc,
          l.created_at,
          l.supplier_id,
          l.traceability_data,
          s.name AS supplier_name
        FROM lots l
        LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
        WHERE l.id = $1
          AND l.store_id = $2
          AND l.article_id = $3
        LIMIT 1
        `,
        [lotId, storeId, articleId]
      );

      if (!lotResult.rows.length) throw new Error(`Lot manuel introuvable: ${lotId}`);
      const lot = lotResult.rows[0];
      const available = Number(lot.qty_remaining || 0);
      if (available <= 0) throw new Error(`Lot sans stock disponible: ${lot.lot_code || lot.lot_id}`);
      if (quantityTaken > available + 0.0001) throw new Error(`Quantité trop élevée pour le lot ${lot.lot_code || lot.lot_id}`);

      totalSelected += quantityTaken;
      selected.push({ ...lot, quantity_taken: quantityTaken, selection_mode: 'manual', sort_order: index + 1 });
    }

    if (!selected.length) throw new Error('Aucune quantité manuelle sélectionnée');
    if (Math.abs(totalSelected - qtyNeeded) > 0.001) {
      throw new Error(`La somme des lots manuels (${totalSelected.toFixed(3)} kg) doit être égale à la quantité source (${qtyNeeded.toFixed(3)} kg)`);
    }
    return selected;
  }

  const lots = await getAvailableLots(client, { storeId, articleId });
  const totalAvailable = lots.reduce((sum, lot) => sum + Number(lot.qty_remaining || 0), 0);
  if (totalAvailable + 0.0001 < qtyNeeded) {
    throw new Error(`Stock insuffisant : ${totalAvailable.toFixed(3)} disponible / ${qtyNeeded.toFixed(3)} demandé`);
  }

  let remaining = qtyNeeded;
  const selected = [];
  for (let index = 0; index < lots.length && remaining > 0; index += 1) {
    const lot = lots[index];
    const available = Number(lot.qty_remaining || 0);
    if (available <= 0) continue;
    const take = Number(Math.min(available, remaining).toFixed(3));
    selected.push({ ...lot, quantity_taken: take, selection_mode: 'fifo', sort_order: index + 1 });
    remaining = Number((remaining - take).toFixed(3));
  }
  return selected;
}

function buildTraceability({ transformation, inputArticle, outputArticle, inputLots }) {
  const sourceLots = inputLots.map((lot) => ({
    lot_id: lot.lot_id,
    lot_code: lot.lot_code,
    supplier_lot_number: lot.supplier_lot_number,
    supplier_id: lot.supplier_id,
    supplier_name: lot.supplier_name,
    dlc: lot.dlc,
    quantity_taken: Number(lot.quantity_taken || 0),
    unit_cost_ex_vat: Number(lot.unit_cost_ex_vat || 0),
    selection_mode: lot.selection_mode,
    traceability_data: lot.traceability_data || {},
  }));

  const traces = sourceLots.map((lot) => lot.traceability_data || {});
  const sourceLotCodes = sourceLots.map((lot) => lot.lot_code).filter(Boolean);
  const sourcePhotos = mergeUnique(traces.map((trace) => trace.source_photos || trace.sanitary_photo_url || trace.sanitary_photo_urls || []));
  const allergens = mergeUnique(traces.map((trace) => trace.source_allergens || trace.allergens || inputArticle.allergens || []));

  return {
    latin_name: mergeUnique(traces.map((trace) => trace.latin_name || inputArticle.latin_name))[0] || outputArticle.latin_name || null,
    fao_zone: mergeUnique(traces.map((trace) => trace.fao_zone || inputArticle.fao_zone))[0] || outputArticle.fao_zone || null,
    sous_zone: mergeUnique(traces.map((trace) => trace.sous_zone || inputArticle.sous_zone))[0] || outputArticle.sous_zone || null,
    fishing_gear: mergeUnique(traces.map((trace) => trace.fishing_gear || inputArticle.fishing_gear))[0] || outputArticle.fishing_gear || null,
    production_method: mergeUnique(traces.map((trace) => trace.production_method || inputArticle.production_method))[0] || outputArticle.production_method || null,
    allergens: allergens.length <= 1 ? (allergens[0] || null) : allergens,
    origin_label: mergeUnique(traces.map((trace) => trace.origin_label))[0] || null,
    sanitary_photo_url: sourcePhotos[0] || null,
    source_photos: sourcePhotos,
    source_lot_codes: sourceLotCodes,
    source_transformation_id: transformation.id,
    source_transformation_reference: transformation.reference_number || null,
    source_article_id: inputArticle.id,
    source_article_plu: inputArticle.plu,
    source_article_designation: inputArticle.designation,
    output_article_id: outputArticle.id,
    output_article_plu: outputArticle.plu,
    output_article_designation: outputArticle.designation,
    source_input_lots: sourceLots,
  };
}

async function createOutputLot(client, { transformation, inputArticle, outputArticle, outputLine, inputLots, userId }) {
  const totalCost = inputLots.reduce((sum, lot) => sum + Number(lot.quantity_taken || 0) * Number(lot.unit_cost_ex_vat || 0), 0);
  const outputQty = positiveQty(outputLine.output_quantity);
  const unitCost = outputQty > 0 ? Number((totalCost / outputQty).toFixed(4)) : 0;
  const nearestDlc = inputLots.map((lot) => lot.dlc).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
  const supplierId = inputLots[0]?.supplier_id || null;
  const lotCode = `TRF-${String(outputArticle.plu || 'NOPLU').replace(/\s+/g, '').toUpperCase()}-${String(transformation.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const traceabilityData = buildTraceability({ transformation, inputArticle, outputArticle, inputLots });

  const lotResult = await client.query(
    `
    INSERT INTO lots (
      id,
      store_id,
      client_key,
      article_id,
      purchase_id,
      purchase_line_id,
      supplier_id,
      lot_code,
      supplier_lot_number,
      source_type,
      qty_initial,
      qty_remaining,
      unit_cost_ex_vat,
      dlc,
      traceability_data,
      created_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, NULL, NULL, $4, $5, NULL, 'transformation', $6, $6, $7, $8, $9::jsonb, NOW()
    )
    RETURNING id, lot_code
    `,
    [transformation.store_id, transformation.client_key || null, outputArticle.id, supplierId, lotCode, outputQty, unitCost, nearestDlc, JSON.stringify(traceabilityData)]
  );

  const createdLot = lotResult.rows[0];
  await client.query(
    `
    INSERT INTO stock_movements (
      id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat,
      source_table, source_id, notes, created_by, created_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, 'transformation_in', $5, $6,
      'sales_lines', $7, $8, $9, NOW()
    )
    `,
    [transformation.store_id, transformation.client_key || null, outputArticle.id, createdLot.id, outputQty, unitCost, outputLine.id, `Entrée transformation ${transformation.reference_number || transformation.id}`, userId]
  );

  return { lot_id: createdLot.id, lot_code: createdLot.lot_code, unit_cost_ex_vat: unitCost, total_cost_ex_vat: totalCost };
}

async function getTransformationDetail(client, storeId, transformationId) {
  const result = await client.query(
    `
    ${documentSelectSql()}
    WHERE sd.id = $1
      AND sd.store_id = $2
      AND sd.document_type = 'TRANSFORMATION'
      AND sd.origin = 'transformation'
    LIMIT 1
    `,
    [transformationId, storeId]
  );
  return result.rows[0] || null;
}

function mapTransformation(row) {
  const inputMetadata = row.input_metadata || {};
  const outputMetadata = row.output_metadata || {};
  return {
    id: row.id,
    store_id: row.store_id,
    transformation_date: row.document_date,
    status: row.status,
    transformation_type: 'simple',
    reference_number: row.reference_number,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    input_line_id: row.input_line_id,
    input_article_id: row.input_article_id,
    input_plu: row.input_plu,
    input_designation: row.input_designation || row.input_article_label,
    input_quantity: row.input_quantity !== null ? Number(row.input_quantity || 0) : null,
    input_unit: row.input_unit || 'kg',
    output_line_id: row.output_line_id,
    output_article_id: row.output_article_id,
    output_plu: row.output_plu,
    output_designation: row.output_designation || row.output_article_label,
    output_quantity: row.output_quantity !== null ? Number(row.output_quantity || 0) : null,
    output_unit: row.output_unit || 'kg',
    output_unit_cost_ex_vat: Number(row.output_unit_cost_ex_vat || outputMetadata.unit_cost_ex_vat || 0),
    created_lot_id: outputMetadata.created_lot_id || null,
    created_lot_code: outputMetadata.created_lot_code || null,
    source_input_lots: inputMetadata.source_input_lots || [],
  };
}

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    let where = `WHERE sd.store_id = $1 AND sd.document_type = 'TRANSFORMATION' AND sd.origin = 'transformation'`;

    const status = clean(req.query.status);
    if (status) {
      params.push(status);
      where += ` AND sd.status = $${params.length}`;
    }

    params.push(safeLimit(req.query.limit));
    const result = await req.dbPool.query(
      `
      ${documentSelectSql()}
      ${where}
      ORDER BY sd.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );
    res.json(result.rows.map(mapTransformation));
  } catch (err) {
    console.error('Erreur GET /api/transformations :', err);
    res.status(500).json({ error: 'Erreur serveur transformations' });
  }
});

router.get('/articles/search', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const query = clean(req.query.q);
    const mode = clean(req.query.mode) || 'target';
    const params = [req.user.store_id];
    let where = 'WHERE a.store_id = $1 AND COALESCE(a.is_active, true) = true';

    if (query) {
      params.push(`%${query}%`);
      where += ` AND (a.plu ILIKE $${params.length} OR a.designation ILIKE $${params.length} OR COALESCE(a.ean, '') ILIKE $${params.length})`;
    }

    if (mode === 'source') {
      where += ` AND EXISTS (SELECT 1 FROM lots l WHERE l.store_id = a.store_id AND l.article_id = a.id AND l.qty_remaining > 0)`;
    }

    params.push(safeLimit(req.query.limit, 20, 50));
    const result = await req.dbPool.query(
      `
      SELECT id, plu, designation, unit
      FROM articles a
      ${where}
      ORDER BY a.designation ASC
      LIMIT $${params.length}
      `,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/transformations/articles/search :', err);
    res.status(500).json({ error: 'Erreur recherche articles' });
  }
});

router.get('/articles/:articleId/lots-available', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const articleId = clean(req.params.articleId);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });
    const article = await getArticle(req.dbPool, req.user.store_id, articleId);
    if (!article) return res.status(404).json({ error: 'Article introuvable' });
    const lots = await getAvailableLots(req.dbPool, { storeId: req.user.store_id, articleId });
    res.json({ article, lots });
  } catch (err) {
    console.error('Erreur GET /api/transformations/articles/:articleId/lots-available :', err);
    res.status(500).json({ error: 'Erreur lots disponibles' });
  }
});

router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
      INSERT INTO sales_documents (
        id, store_id, client_key, document_date, status, document_type, origin, reference_number, notes, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, $2, COALESCE($3::date, CURRENT_DATE), 'draft', 'TRANSFORMATION', 'transformation', $4, $5, $6, $6
      )
      RETURNING *
      `,
      [req.user.store_id, req.user.client_key || null, clean(req.body.transformation_date), clean(req.body.reference_number), clean(req.body.notes), req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ ok: true, transformation: mapTransformation(result.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations :', err);
    res.status(500).json({ error: 'Erreur création transformation' });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const transformationId = clean(req.params.id);
    if (!transformationId || !isUuid(transformationId)) return res.status(400).json({ error: 'ID transformation invalide' });

    const row = await getTransformationDetail(req.dbPool, req.user.store_id, transformationId);
    if (!row) return res.status(404).json({ error: 'Transformation introuvable' });

    const transformation = mapTransformation(row);
    res.json({
      transformation,
      inputs: row.input_line_id ? [{
        id: row.input_line_id,
        article_id: row.input_article_id,
        article_plu: row.input_plu,
        article_name: row.input_designation || row.input_article_label,
        input_quantity: transformation.input_quantity,
        input_unit: transformation.input_unit,
      }] : [],
      outputs: row.output_line_id ? [{
        id: row.output_line_id,
        article_id: row.output_article_id,
        article_plu: row.output_plu,
        article_name: row.output_designation || row.output_article_label,
        output_quantity: transformation.output_quantity,
        output_unit: transformation.output_unit,
        created_lot_id: transformation.created_lot_id,
        created_lot_code: transformation.created_lot_code,
        unit_cost_ex_vat: transformation.output_unit_cost_ex_vat,
      }] : [],
      input_lots: transformation.source_input_lots || [],
    });
  } catch (err) {
    console.error('Erreur GET /api/transformations/:id :', err);
    res.status(500).json({ error: 'Erreur détail transformation' });
  }
});

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
    const row = await getTransformationDetail(client, req.user.store_id, transformationId);
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }
    if (row.status === 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Une transformation validée ne peut plus être modifiée' });
    }

    await client.query(
      `
      UPDATE sales_documents
      SET document_date = COALESCE($1::date, document_date), reference_number = $2, notes = $3, updated_by = $4, updated_at = NOW()
      WHERE id = $5 AND store_id = $6
      `,
      [clean(req.body.transformation_date), clean(req.body.reference_number), clean(req.body.notes), req.user.id, transformationId, req.user.store_id]
    );

    if (inputArticleId || inputQty > 0) {
      if (!inputArticleId) throw new Error('Article source obligatoire');
      if (inputQty <= 0) throw new Error('Quantité source invalide');
      const article = await getArticle(client, req.user.store_id, inputArticleId);
      if (!article) throw new Error('Article source introuvable');
      await upsertTransformationLine(client, {
        documentId: transformationId,
        storeId: req.user.store_id,
        clientKey: req.user.client_key,
        role: 'transformation_input',
        lineNumber: 1,
        article,
        quantity: inputQty,
        unit: normalizeUnit(req.body.input_unit),
        metadata: { role: 'input' },
      });
    }

    if (outputArticleId || outputQty > 0) {
      if (!outputArticleId) throw new Error('Article cible obligatoire');
      if (outputQty <= 0) throw new Error('Quantité cible invalide');
      const article = await getArticle(client, req.user.store_id, outputArticleId);
      if (!article) throw new Error('Article cible introuvable');
      await upsertTransformationLine(client, {
        documentId: transformationId,
        storeId: req.user.store_id,
        clientKey: req.user.client_key,
        role: 'transformation_output',
        lineNumber: 2,
        article,
        quantity: outputQty,
        unit: normalizeUnit(req.body.output_unit),
        metadata: { role: 'output' },
      });
    }

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Transformation enregistrée' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/transformations/:id :', err);
    res.status(500).json({ error: err.message || 'Erreur mise à jour transformation' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const transformationId = clean(req.params.id);
    if (!transformationId || !isUuid(transformationId)) return res.status(400).json({ error: 'ID transformation invalide' });
    await client.query('BEGIN');
    const row = await getTransformationDetail(client, req.user.store_id, transformationId);
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }
    if (row.status === 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de supprimer une transformation validée. Utilise l’annulation métier.' });
    }
    await client.query('DELETE FROM sales_lines WHERE sales_document_id = $1 AND store_id = $2', [transformationId, req.user.store_id]);
    await client.query('DELETE FROM sales_documents WHERE id = $1 AND store_id = $2', [transformationId, req.user.store_id]);
    await client.query('COMMIT');
    res.json({ ok: true, message: 'Transformation supprimée' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/transformations/:id :', err);
    res.status(500).json({ error: 'Erreur suppression transformation' });
  } finally {
    client.release();
  }
});

router.post('/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const transformationId = clean(req.params.id);
    if (!transformationId || !isUuid(transformationId)) return res.status(400).json({ error: 'ID transformation invalide' });
    await client.query('BEGIN');

    const row = await getTransformationDetail(client, req.user.store_id, transformationId);
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }
    if (row.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document déjà validé ou non modifiable' });
    }

    const inputQty = positiveQty(row.input_quantity);
    const outputQty = positiveQty(row.output_quantity);
    if (!row.input_line_id || !row.input_article_id || inputQty <= 0) throw new Error('Ligne source incomplète');
    if (!row.output_line_id || !row.output_article_id || outputQty <= 0) throw new Error('Ligne cible incomplète');

    const inputArticle = await getArticle(client, req.user.store_id, row.input_article_id);
    const outputArticle = await getArticle(client, req.user.store_id, row.output_article_id);
    if (!inputArticle) throw new Error('Article source introuvable');
    if (!outputArticle) throw new Error('Article cible introuvable');

    const selectedLots = await selectLots(client, {
      storeId: req.user.store_id,
      articleId: row.input_article_id,
      requiredQty: inputQty,
      selectionMode: clean(req.body.selection_mode) === 'manual' ? 'manual' : 'fifo',
      manualLots: req.body.manual_lots || [],
    });

    for (const lot of selectedLots) {
      const qtyTaken = positiveQty(lot.quantity_taken);
      const updateResult = await client.query(
        `UPDATE lots SET qty_remaining = qty_remaining - $1 WHERE id = $2 AND store_id = $3 AND qty_remaining >= $1 RETURNING id`,
        [qtyTaken, lot.lot_id, req.user.store_id]
      );
      if (!updateResult.rows.length) throw new Error('Stock insuffisant ou lot déjà consommé');
      await client.query(
        `
        INSERT INTO stock_movements (
          id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat,
          source_table, source_id, notes, created_by, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, 'transformation_out', $5, $6,
          'sales_lines', $7, $8, $9, NOW()
        )
        `,
        [req.user.store_id, req.user.client_key || null, row.input_article_id, lot.lot_id, -qtyTaken, Number(lot.unit_cost_ex_vat || 0), row.input_line_id, `Sortie transformation ${row.reference_number || row.id}`, req.user.id]
      );
    }

    const createdLot = await createOutputLot(client, {
      transformation: row,
      inputArticle,
      outputArticle,
      outputLine: { id: row.output_line_id, output_quantity: outputQty },
      inputLots: selectedLots,
      userId: req.user.id,
    });

    await client.query(
      `
      UPDATE sales_lines
      SET line_status = 'validated', source_inventory_line = $1::jsonb, updated_at = NOW()
      WHERE id = $2 AND store_id = $3
      `,
      [JSON.stringify({ role: 'input', source_input_lots: selectedLots.map((lot) => ({
        lot_id: lot.lot_id,
        lot_code: lot.lot_code,
        supplier_lot_number: lot.supplier_lot_number,
        supplier_name: lot.supplier_name,
        quantity_taken: Number(lot.quantity_taken || 0),
        unit_cost_ex_vat: Number(lot.unit_cost_ex_vat || 0),
        selection_mode: lot.selection_mode,
        dlc: lot.dlc,
      })) }), row.input_line_id, req.user.store_id]
    );

    await client.query(
      `
      UPDATE sales_lines
      SET line_status = 'validated', unit_cost_ex_vat = $1, source_inventory_line = $2::jsonb, updated_at = NOW()
      WHERE id = $3 AND store_id = $4
      `,
      [createdLot.unit_cost_ex_vat, JSON.stringify({ role: 'output', created_lot_id: createdLot.lot_id, created_lot_code: createdLot.lot_code, unit_cost_ex_vat: createdLot.unit_cost_ex_vat, total_cost_ex_vat: createdLot.total_cost_ex_vat }), row.output_line_id, req.user.store_id]
    );

    await client.query(
      `UPDATE sales_documents SET status = 'validated', updated_by = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
      [req.user.id, transformationId, req.user.store_id]
    );

    await recomputeArticleStock(client, row.input_article_id, req.user.store_id);
    await recomputeArticleStock(client, row.output_article_id, req.user.store_id);
    await client.query('COMMIT');

    res.json({ ok: true, message: 'Transformation validée', created_lot: createdLot });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations/:id/validate :', err);
    res.status(500).json({ error: err.message || 'Erreur validation transformation' });
  } finally {
    client.release();
  }
});

router.post('/:id/cancel-validated', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const transformationId = clean(req.params.id);
    if (!transformationId || !isUuid(transformationId)) return res.status(400).json({ error: 'ID transformation invalide' });
    await client.query('BEGIN');

    const row = await getTransformationDetail(client, req.user.store_id, transformationId);
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }
    if (row.status !== 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Seule une transformation validée peut être annulée' });
    }

    const outputMetadata = row.output_metadata || {};
    const inputMetadata = row.input_metadata || {};
    const createdLotId = outputMetadata.created_lot_id;
    const sourceLots = inputMetadata.source_input_lots || [];
    if (!createdLotId || !sourceLots.length) throw new Error('Traçabilité transformation incomplète');

    const targetLotResult = await client.query(
      `SELECT * FROM lots WHERE id = $1 AND store_id = $2 LIMIT 1`,
      [createdLotId, req.user.store_id]
    );
    const targetLot = targetLotResult.rows[0];
    if (!targetLot) throw new Error('Lot transformé introuvable');
    if (Number(targetLot.qty_remaining || 0) < Number(targetLot.qty_initial || 0) - 0.0001) {
      throw new Error("Impossible d'annuler : le lot transformé a déjà été consommé ou vendu.");
    }

    for (const sourceLot of sourceLots) {
      await client.query(
        `UPDATE lots SET qty_remaining = qty_remaining + $1 WHERE id = $2 AND store_id = $3`,
        [positiveQty(sourceLot.quantity_taken), sourceLot.lot_id, req.user.store_id]
      );
    }

    await client.query(
      `DELETE FROM stock_movements WHERE store_id = $1 AND source_table = 'sales_lines' AND source_id = ANY($2::uuid[])`,
      [req.user.store_id, [row.input_line_id, row.output_line_id].filter(Boolean)]
    );
    await client.query(`DELETE FROM lots WHERE id = $1 AND store_id = $2`, [createdLotId, req.user.store_id]);
    await client.query(
      `UPDATE sales_lines SET line_status = 'pending', unit_cost_ex_vat = 0, source_inventory_line = $1::jsonb, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
      [JSON.stringify({ role: 'input' }), row.input_line_id, req.user.store_id]
    );
    await client.query(
      `UPDATE sales_lines SET line_status = 'pending', unit_cost_ex_vat = 0, source_inventory_line = $1::jsonb, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
      [JSON.stringify({ role: 'output' }), row.output_line_id, req.user.store_id]
    );
    await client.query(
      `UPDATE sales_documents SET status = 'cancelled', updated_by = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
      [req.user.id, transformationId, req.user.store_id]
    );

    if (row.input_article_id) await recomputeArticleStock(client, row.input_article_id, req.user.store_id);
    if (row.output_article_id) await recomputeArticleStock(client, row.output_article_id, req.user.store_id);
    await client.query('COMMIT');
    res.json({ ok: true, message: 'Transformation annulée et stock restauré.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations/:id/cancel-validated :', err);
    res.status(500).json({ error: err.message || 'Erreur annulation transformation' });
  } finally {
    client.release();
  }
});

module.exports = router;
