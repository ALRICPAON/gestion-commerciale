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

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveQty(value) {
  const parsed = toNumber(value, 0);
  return parsed > 0 ? Number(parsed.toFixed(3)) : 0;
}

function mergeUnique(values) {
  return [...new Set((values || []).flat().filter((value) => value !== undefined && value !== null && value !== ''))];
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

async function getInput(client, storeId, transformationId) {
  const result = await client.query(
    `
    SELECT *
    FROM transformation_inputs
    WHERE transformation_id = $1
      AND store_id = $2
    ORDER BY line_number ASC, created_at ASC
    LIMIT 1
    `,
    [transformationId, storeId]
  );
  return result.rows[0] || null;
}

async function getOutput(client, storeId, transformationId) {
  const result = await client.query(
    `
    SELECT *
    FROM transformation_outputs
    WHERE transformation_id = $1
      AND store_id = $2
    ORDER BY line_number ASC, created_at ASC
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
      if (!lotId || !isUuid(lotId) || quantityTaken <= 0) continue;

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
      'transformation_outputs', $7, $8, $9, NOW()
    )
    `,
    [transformation.store_id, transformation.client_key || null, outputArticle.id, createdLot.id, outputQty, unitCost, outputLine.id, `Entrée transformation ${transformation.reference_number || transformation.id}`, userId]
  );

  return {
    lot_id: createdLot.id,
    lot_code: createdLot.lot_code,
    unit_cost_ex_vat: unitCost,
    total_cost_ex_vat: totalCost,
    traceability_data: traceabilityData,
  };
}

router.post('/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const transformationId = clean(req.params.id);
    if (!transformationId || !isUuid(transformationId)) return res.status(400).json({ error: 'ID transformation invalide' });

    await client.query('BEGIN');

    const transformation = await getTransformation(client, req.user.store_id, transformationId);
    if (!transformation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }
    if (transformation.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Transformation déjà validée ou non modifiable' });
    }

    const inputLine = await getInput(client, req.user.store_id, transformationId);
    const outputLine = await getOutput(client, req.user.store_id, transformationId);
    const inputQty = positiveQty(inputLine?.input_quantity);
    const outputQty = positiveQty(outputLine?.output_quantity);

    if (!inputLine?.id || !inputLine.article_id || inputQty <= 0) throw new Error('Ligne source incomplète');
    if (!outputLine?.id || !outputLine.article_id || outputQty <= 0) throw new Error('Ligne cible incomplète');

    const inputArticle = await getArticle(client, req.user.store_id, inputLine.article_id);
    const outputArticle = await getArticle(client, req.user.store_id, outputLine.article_id);
    if (!inputArticle) throw new Error('Article source introuvable');
    if (!outputArticle) throw new Error('Article cible introuvable');

    const selectedLots = await selectLots(client, {
      storeId: req.user.store_id,
      articleId: inputLine.article_id,
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
          'transformation_inputs', $7, $8, $9, NOW()
        )
        `,
        [req.user.store_id, req.user.client_key || null, inputLine.article_id, lot.lot_id, -qtyTaken, Number(lot.unit_cost_ex_vat || 0), inputLine.id, `Sortie transformation ${transformation.reference_number || transformation.id}`, req.user.id]
      );
    }

    const createdLot = await createOutputLot(client, {
      transformation,
      inputArticle,
      outputArticle,
      outputLine: { id: outputLine.id, output_quantity: outputQty },
      inputLots: selectedLots,
      userId: req.user.id,
    });

    const sourceInputLots = selectedLots.map((lot) => ({
      lot_id: lot.lot_id,
      lot_code: lot.lot_code,
      supplier_lot_number: lot.supplier_lot_number,
      supplier_name: lot.supplier_name,
      quantity_taken: Number(lot.quantity_taken || 0),
      unit_cost_ex_vat: Number(lot.unit_cost_ex_vat || 0),
      selection_mode: lot.selection_mode,
      dlc: lot.dlc,
    }));

    await client.query(
      `
      UPDATE transformation_inputs
      SET
        line_status = 'validated',
        source_metadata = $1::jsonb,
        updated_by = $2,
        updated_at = NOW()
      WHERE id = $3
        AND store_id = $4
      `,
      [JSON.stringify({ role: 'input', source_input_lots: sourceInputLots }), req.user.id, inputLine.id, req.user.store_id]
    );

    await client.query(
      `
      UPDATE transformation_outputs
      SET
        line_status = 'validated',
        created_lot_id = $1,
        unit_cost_ex_vat = $2,
        total_cost_ex_vat = $3,
        output_metadata = $4::jsonb,
        updated_by = $5,
        updated_at = NOW()
      WHERE id = $6
        AND store_id = $7
      `,
      [createdLot.lot_id, createdLot.unit_cost_ex_vat, createdLot.total_cost_ex_vat, JSON.stringify({ role: 'output', created_lot_id: createdLot.lot_id, created_lot_code: createdLot.lot_code, unit_cost_ex_vat: createdLot.unit_cost_ex_vat, total_cost_ex_vat: createdLot.total_cost_ex_vat }), req.user.id, outputLine.id, req.user.store_id]
    );

    await client.query(
      `
      INSERT INTO transformation_metadata (
        id, transformation_id, store_id, client_key, meta_key, meta_value, metadata, notes, created_by, updated_by, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'validation', $4::jsonb, $4::jsonb, NULL, $5, $5, NOW(), NOW()
      )
      ON CONFLICT (transformation_id, meta_key)
      DO UPDATE SET
        meta_value = EXCLUDED.meta_value,
        metadata = EXCLUDED.metadata,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      `,
      [transformation.id, req.user.store_id, req.user.client_key || null, JSON.stringify({ selection_mode: clean(req.body.selection_mode) === 'manual' ? 'manual' : 'fifo', source_input_lots: sourceInputLots, created_lot_id: createdLot.lot_id, created_lot_code: createdLot.lot_code }), req.user.id]
    );

    await client.query(
      `
      UPDATE transformations
      SET status = 'validated', validated_by = $1, validated_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = $2
        AND store_id = $3
      `,
      [req.user.id, transformationId, req.user.store_id]
    );

    await recomputeArticleStock(client, inputLine.article_id, req.user.store_id);
    await recomputeArticleStock(client, outputLine.article_id, req.user.store_id);
    await client.query('COMMIT');

    return res.json({ ok: true, message: 'Transformation validée', created_lot: createdLot });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations/:id/validate :', err);
    return res.status(err.status || 500).json({ error: err.message || 'Erreur validation transformation' });
  } finally {
    client.release();
  }
});

module.exports = router;
