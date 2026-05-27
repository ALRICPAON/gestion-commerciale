const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');
const { toNullableString } = require('../utils/valueHelpers');

// =========================================================
// HELPERS
// =========================================================

function normalizeTransformationUnit(raw) {
  const value = String(raw || '').trim().toLowerCase();

  if (['piece', 'pièce', 'pieces', 'pièces', 'pcs', 'pc', 'unite', 'unité'].includes(value)) {
    return 'piece';
  }

  if (['colis', 'box', 'carton', 'cartons'].includes(value)) {
    return 'colis';
  }

  return 'kg';
}

async function getTransformationLotSelection(client, {
  storeId,
  departmentId,
  articleId,
  requiredQty,
  selectionMode = 'fifo',
  manualLots = [],
}) {
  const qtyNeeded = Number(requiredQty || 0);

  if (qtyNeeded <= 0) {
    throw new Error('Quantité source invalide');
  }

  if (selectionMode === 'manual') {
    if (!Array.isArray(manualLots) || manualLots.length === 0) {
      throw new Error('Aucun lot manuel fourni');
    }

    const selected = [];
    let totalSelected = 0;

    for (let i = 0; i < manualLots.length; i += 1) {
      const row = manualLots[i] || {};
      const lotId = row.lot_id || row.lotId || null;
      const qty = Number(row.quantity_taken ?? row.quantity ?? row.qty ?? 0);

      if (!lotId || qty <= 0) continue;

      const lotResult = await client.query(
        `
        SELECT
          l.id,
          l.article_id,
          l.store_id,
          l.department_id,
          l.lot_code,
          l.qty_initial,
          l.qty_remaining,
          l.unit_cost_ex_vat,
          l.dlc,
          l.created_at,
          l.supplier_id,
          s.name AS supplier_name
        FROM lots l
        LEFT JOIN suppliers s ON s.id = l.supplier_id
        WHERE l.id = $1
          AND l.store_id = $2
          AND l.department_id = $3
          AND l.article_id = $4
        LIMIT 1
        `,
        [lotId, storeId, departmentId, articleId]
      );

      if (lotResult.rows.length === 0) {
        throw new Error(`Lot manuel introuvable: ${lotId}`);
      }

      const lot = lotResult.rows[0];
      const available = Number(lot.qty_remaining || 0);

      if (available <= 0) {
        throw new Error(`Lot sans stock disponible: ${lot.lot_code || lot.id}`);
      }

      if (qty > available + 0.0001) {
        throw new Error(`Quantité trop élevée pour le lot ${lot.lot_code || lot.id}`);
      }

      totalSelected += qty;

      selected.push({
        lot_id: lot.id,
        lot_code: lot.lot_code,
        qty_initial: Number(lot.qty_initial || 0),
        qty_remaining: available,
        quantity_taken: qty,
        unit_cost_ex_vat: Number(lot.unit_cost_ex_vat || 0),
        dlc: lot.dlc,
        created_at: lot.created_at,
        supplier_id: lot.supplier_id,
        supplier_name: lot.supplier_name || null,
        selection_mode: 'manual',
        sort_order: i + 1,
      });
    }

    if (selected.length === 0) {
      throw new Error('Aucune quantité manuelle sélectionnée');
    }

    if (Math.abs(totalSelected - qtyNeeded) > 0.001) {
      throw new Error(
        `La somme des lots manuels (${totalSelected.toFixed(3)} kg) doit être égale à la quantité à consommer (${qtyNeeded.toFixed(3)} kg)`
      );
    }

    return selected;
  }

  const lotsResult = await client.query(
    `
    SELECT
      l.id,
      l.lot_code,
      l.qty_initial,
      l.qty_remaining,
      l.unit_cost_ex_vat,
      l.dlc,
      l.created_at,
      l.supplier_id,
      s.name AS supplier_name
    FROM lots l
    LEFT JOIN suppliers s ON s.id = l.supplier_id
    WHERE l.store_id = $1
      AND l.department_id = $2
      AND l.article_id = $3
      AND l.qty_remaining > 0
    ORDER BY l.created_at ASC, l.id ASC
    `,
    [storeId, departmentId, articleId]
  );

  const lots = lotsResult.rows;
  const totalAvailable = lots.reduce((sum, lot) => sum + Number(lot.qty_remaining || 0), 0);

  if (totalAvailable + 0.0001 < qtyNeeded) {
    throw new Error(
      `Stock insuffisant : ${totalAvailable.toFixed(3)} disponible / ${qtyNeeded.toFixed(3)} demandé`
    );
  }

  let remaining = qtyNeeded;
  const selected = [];
  let order = 1;

  for (const lot of lots) {
    if (remaining <= 0) break;

    const available = Number(lot.qty_remaining || 0);
    if (available <= 0) continue;

    const take = Math.min(available, remaining);

    selected.push({
      lot_id: lot.id,
      lot_code: lot.lot_code,
      qty_initial: Number(lot.qty_initial || 0),
      qty_remaining: available,
      quantity_taken: Number(take.toFixed(3)),
      unit_cost_ex_vat: Number(lot.unit_cost_ex_vat || 0),
      dlc: lot.dlc,
      created_at: lot.created_at,
      supplier_id: lot.supplier_id,
      supplier_name: lot.supplier_name || null,
      selection_mode: 'fifo',
      sort_order: order,
    });

    remaining -= take;
    order += 1;
  }

  return selected;
}

async function createTransformationOutputLot(client, {
  transformation,
  output,
  inputLots,
  reqUserId,
}) {
  const totalCost = inputLots.reduce((sum, row) => {
    return sum + Number(row.quantity_taken || 0) * Number(row.unit_cost_ex_vat || 0);
  }, 0);

  const outputQty = Number(output.output_quantity || 0);
  const unitCost = outputQty > 0 ? Number((totalCost / outputQty).toFixed(4)) : 0;

  const inputLotIds = inputLots.map((row) => row.lot_id).filter(Boolean);

  let sourceLotsDetails = [];
  if (inputLotIds.length > 0) {
    const sourceLotsResult = await client.query(
      `
      SELECT
        l.id,
        l.lot_code,
        l.dlc,
        l.source_type,
        l.supplier_id,
        l.purchase_line_id,
        l.traceability_data,
        plm.sanitary_photo_url,
        plm.allergens AS metadata_allergens
      FROM lots l
      LEFT JOIN purchase_line_metadata plm
        ON plm.purchase_line_id = l.purchase_line_id
       AND plm.meta_key = 'v2_line'
      WHERE l.id = ANY($1::uuid[])
      `,
      [inputLotIds]
    );

    sourceLotsDetails = sourceLotsResult.rows;
  }

  const sourceById = new Map();
  for (const row of sourceLotsDetails) {
    sourceById.set(row.id, row);
  }

  const sourceLatinNames = [];
  const sourceFaoZones = [];
  const sourceSousZones = [];
  const sourceFishingGears = [];
  const sourceProductionMethods = [];
  const sourceAllergens = [];
  const sourceOriginLabels = [];
  const sourcePhotos = [];
  const sourceLotCodes = [];

  for (const usedRow of inputLots) {
    const detail = sourceById.get(usedRow.lot_id);
    if (!detail) continue;

    const trace = detail.traceability_data || {};

    if (detail.lot_code) sourceLotCodes.push(detail.lot_code);
    if (detail.sanitary_photo_url) sourcePhotos.push(detail.sanitary_photo_url);

    if (trace.latin_name) sourceLatinNames.push(trace.latin_name);
    if (trace.fao_zone) sourceFaoZones.push(trace.fao_zone);
    if (trace.sous_zone) sourceSousZones.push(trace.sous_zone);
    if (trace.fishing_gear) sourceFishingGears.push(trace.fishing_gear);
    if (trace.production_method) sourceProductionMethods.push(trace.production_method);
    if (trace.origin_label) sourceOriginLabels.push(trace.origin_label);

    if (trace.allergens) {
      if (Array.isArray(trace.allergens)) {
        sourceAllergens.push(...trace.allergens.filter(Boolean));
      } else {
        sourceAllergens.push(trace.allergens);
      }
    }

    if (detail.metadata_allergens) {
      sourceAllergens.push(detail.metadata_allergens);
    }
  }

  const unique = (arr) => [...new Set((arr || []).filter(Boolean))];

  const uniqueLatinNames = unique(sourceLatinNames);
  const uniqueFaoZones = unique(sourceFaoZones);
  const uniqueSousZones = unique(sourceSousZones);
  const uniqueFishingGears = unique(sourceFishingGears);
  const uniqueProductionMethods = unique(sourceProductionMethods);
  const uniqueAllergens = unique(sourceAllergens);
  const uniqueOriginLabels = unique(sourceOriginLabels);
  const uniquePhotos = unique(sourcePhotos);
  const uniqueLotCodes = unique(sourceLotCodes);

  const traceabilityData = {
    latin_name: uniqueLatinNames[0] || null,
    fao_zone: uniqueFaoZones[0] || null,
    sous_zone: uniqueSousZones[0] || null,
    fishing_gear: uniqueFishingGears[0] || null,
    production_method: uniqueProductionMethods[0] || null,
    allergens: uniqueAllergens.length <= 1 ? (uniqueAllergens[0] || null) : uniqueAllergens,
    origin_label: uniqueOriginLabels[0] || null,
    sanitary_photo_url: uniquePhotos[0] || null,

    source_latin_names: uniqueLatinNames,
    source_fao_zones: uniqueFaoZones,
    source_sous_zones: uniqueSousZones,
    source_fishing_gears: uniqueFishingGears,
    source_production_methods: uniqueProductionMethods,
    source_allergens: uniqueAllergens,
    source_origin_labels: uniqueOriginLabels,
    source_photos: uniquePhotos,
    source_lot_codes: uniqueLotCodes,

    source_transformation_id: transformation.id,
    source_transformation_reference: transformation.reference_number || null,
    source_input_lots: inputLots.map((row) => ({
      lot_id: row.lot_id,
      lot_code: row.lot_code || null,
      quantity_taken: Number(row.quantity_taken || 0),
      unit_cost_ex_vat: Number(row.unit_cost_ex_vat || 0),
      selection_mode: row.selection_mode || 'fifo',
    })),
  };

  const nearestDlc =
    inputLots
      .map((row) => row.dlc)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0] || null;

  const lotCode = `TRF-${String(output.article_plu || 'NOPLU')
    .replace(/\s+/g, '')
    .toUpperCase()}-${String(transformation.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  const supplierId = inputLots[0]?.supplier_id || null;

  const lotInsert = await client.query(
    `
    INSERT INTO lots (
      id,
      store_id,
      department_id,
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
    )
    VALUES (
      gen_random_uuid(),
      $1, $2, $3,
      NULL,
      NULL,
      $4,
      $5,
      NULL,
      'transformation',
      $6,
      $6,
      $7,
      $8,
      $9::jsonb,
      NOW()
    )
    RETURNING id, lot_code
    `,
    [
      transformation.store_id,
      transformation.department_id,
      output.article_id,
      supplierId,
      lotCode,
      outputQty,
      unitCost,
      nearestDlc,
      JSON.stringify(traceabilityData),
    ]
  );

  const createdLot = lotInsert.rows[0];

  await client.query(
    `
    INSERT INTO stock_movements (
      id,
      store_id,
      department_id,
      article_id,
      lot_id,
      movement_type,
      quantity,
      unit_cost_ex_vat,
      source_table,
      source_id,
      notes,
      created_at,
      created_by
    )
    VALUES (
      gen_random_uuid(),
      $1, $2, $3, $4,
      'transformation_in',
      $5,
      $6,
      'transformation_outputs',
      $7,
      $8,
      NOW(),
      $9
    )
    `,
    [
      transformation.store_id,
      transformation.department_id,
      output.article_id,
      createdLot.id,
      outputQty,
      unitCost,
      output.id,
      `Entrée transformation ${transformation.id}`,
      reqUserId,
    ]
  );

  await client.query(
    `
    UPDATE transformation_outputs
    SET
      unit_cost_ex_vat = $1,
      total_cost_ex_vat = $2,
      created_lot_id = $3,
      line_status = 'validated',
      updated_at = NOW()
    WHERE id = $4
    `,
    [unitCost, totalCost, createdLot.id, output.id]
  );

  return {
    lot_id: createdLot.id,
    lot_code: createdLot.lot_code,
    unit_cost_ex_vat: unitCost,
    total_cost_ex_vat: totalCost,
  };
}

// =========================================================
// LISTE TRANSFORMATIONS
// =========================================================

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const {
      department_id = '',
      status = '',
      limit = '50',
    } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const safeLimit = Math.min(Number(limit) || 50, 200);

    const params = [req.user.store_id, department_id];
    let where = `
      WHERE t.store_id = $1
        AND t.department_id = $2
    `;

    if (status) {
      params.push(status);
      where += ` AND t.status = $${params.length}`;
    }

    params.push(safeLimit);

    const result = await req.dbPool.query(
      `
      SELECT
        t.id,
        t.transformation_date,
        t.status,
        t.transformation_type,
        t.reference_number,
        t.notes,
        t.created_at,
        ai.plu AS input_plu,
        ai.designation AS input_designation,
        ti.input_quantity,
        ao.plu AS output_plu,
        ao.designation AS output_designation,
        to1.output_quantity
      FROM transformations t
      LEFT JOIN transformation_inputs ti
        ON ti.transformation_id = t.id
       AND ti.line_number = 1
      LEFT JOIN articles ai
        ON ai.id = ti.article_id
      LEFT JOIN transformation_outputs to1
        ON to1.transformation_id = t.id
       AND to1.line_number = 1
      LEFT JOIN articles ao
        ON ao.id = to1.article_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/transformations :', err);
    res.status(500).json({ error: 'Erreur serveur transformations' });
  }
});

// =========================================================
// CREER TRANSFORMATION
// =========================================================

router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      department_id,
      transformation_date,
      reference_number,
      notes,
      input_article_id,
      input_quantity,
      input_unit = 'kg',
      output_article_id,
      output_quantity,
      output_unit = 'kg',
    } = req.body;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    await client.query('BEGIN');

    const departmentCheck = await client.query(
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
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    const transfoInsert = await client.query(
      `
      INSERT INTO transformations (
        id,
        store_id,
        department_id,
        transformation_date,
        status,
        transformation_type,
        reference_number,
        notes,
        created_by,
        updated_by
      )
      VALUES (
        gen_random_uuid(),
        $1, $2,
        COALESCE($3::date, CURRENT_DATE),
        'draft',
        'simple',
        $4,
        $5,
        $6,
        $6
      )
      RETURNING *
      `,
      [
        req.user.store_id,
        department_id,
        transformation_date || null,
        toNullableString(reference_number),
        toNullableString(notes),
        req.user.id,
      ]
    );

    const transformation = transfoInsert.rows[0];

    let inputLineCreated = false;
    if (input_article_id) {
      const inputArticleCheck = await client.query(
        `
        SELECT id
        FROM articles
        WHERE id = $1
          AND store_id = $2
        LIMIT 1
        `,
        [input_article_id, req.user.store_id]
      );

      if (inputArticleCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Article source introuvable' });
      }

      const inputQty = Number(input_quantity || 0);
      if (input_quantity !== undefined && inputQty <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Quantité source invalide' });
      }

      await client.query(
        `
        INSERT INTO transformation_inputs (
          id,
          transformation_id,
          store_id,
          department_id,
          article_id,
          line_number,
          input_quantity,
          input_unit,
          line_status
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, 1,
          $5, $6,
          'pending'
        )
        `,
        [
          transformation.id,
          req.user.store_id,
          department_id,
          input_article_id,
          inputQty > 0 ? inputQty : null,
          normalizeTransformationUnit(input_unit),
        ]
      );

      inputLineCreated = true;
    }

    let outputLineCreated = false;
    if (output_article_id) {
      const outputArticleCheck = await client.query(
        `
        SELECT id
        FROM articles
        WHERE id = $1
          AND store_id = $2
        LIMIT 1
        `,
        [output_article_id, req.user.store_id]
      );

      if (outputArticleCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Article cible introuvable' });
      }

      const outputQty = Number(output_quantity || 0);
      if (output_quantity !== undefined && outputQty <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Quantité cible invalide' });
      }

      await client.query(
        `
        INSERT INTO transformation_outputs (
          id,
          transformation_id,
          store_id,
          department_id,
          article_id,
          line_number,
          output_quantity,
          output_unit,
          unit_cost_ex_vat,
          total_cost_ex_vat,
          line_status
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, 1,
          $5, $6,
          0, 0,
          'pending'
        )
        `,
        [
          transformation.id,
          req.user.store_id,
          department_id,
          output_article_id,
          outputQty > 0 ? outputQty : null,
          normalizeTransformationUnit(output_unit),
        ]
      );

      outputLineCreated = true;
    }

    await client.query(
      `
      INSERT INTO transformation_metadata (
        id,
        transformation_id,
        meta_key,
        meta_value,
        notes
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_transformation',
        '{}'::jsonb,
        NULL
      )
      ON CONFLICT (transformation_id, meta_key)
      DO NOTHING
      `,
      [transformation.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      transformation,
      input_line_created: inputLineCreated,
      output_line_created: outputLineCreated,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations :', err);
    res.status(500).json({ error: 'Erreur création transformation' });
  } finally {
    client.release();
  }
});

// =========================================================
// DETAIL TRANSFORMATION
// =========================================================

router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const transformationId = req.params.id;

    const transfoResult = await req.dbPool.query(
      `
      SELECT *
      FROM transformations
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [transformationId, req.user.store_id]
    );

    if (transfoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transformation introuvable' });
    }

    const transformation = transfoResult.rows[0];

    const inputsResult = await req.dbPool.query(
      `
      SELECT
        ti.*,
        a.plu AS article_plu,
        a.designation AS article_name
      FROM transformation_inputs ti
      LEFT JOIN articles a ON a.id = ti.article_id
      WHERE ti.transformation_id = $1
      ORDER BY ti.line_number ASC
      `,
      [transformationId]
    );

    const outputsResult = await req.dbPool.query(
      `
      SELECT
        to1.*,
        a.plu AS article_plu,
        a.designation AS article_name
      FROM transformation_outputs to1
      LEFT JOIN articles a ON a.id = to1.article_id
      WHERE to1.transformation_id = $1
      ORDER BY to1.line_number ASC
      `,
      [transformationId]
    );

    const inputIds = inputsResult.rows.map((row) => row.id);

    let inputLots = [];
    if (inputIds.length > 0) {
      const inputLotsResult = await req.dbPool.query(
        `
        SELECT
          til.*,
          l.lot_code,
          l.dlc,
          l.created_at AS lot_created_at,
          s.name AS supplier_name
        FROM transformation_input_lots til
        LEFT JOIN lots l ON l.id = til.lot_id
        LEFT JOIN suppliers s ON s.id = l.supplier_id
        WHERE til.transformation_input_id = ANY($1::uuid[])
        ORDER BY til.sort_order ASC, til.created_at ASC
        `,
        [inputIds]
      );

      inputLots = inputLotsResult.rows;
    }

    res.json({
      transformation,
      inputs: inputsResult.rows,
      outputs: outputsResult.rows,
      input_lots: inputLots,
    });
  } catch (err) {
    console.error('Erreur GET /api/transformations/:id :', err);
    res.status(500).json({ error: 'Erreur détail transformation' });
  }
});

// =========================================================
// MODIFIER TRANSFORMATION BROUILLON
// =========================================================

router.patch('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const transformationId = req.params.id;
    const {
      transformation_date,
      status,
      reference_number,
      notes,
      input_article_id,
      input_quantity,
      input_unit,
      output_article_id,
      output_quantity,
      output_unit,
    } = req.body;

    await client.query('BEGIN');

    const transfoCheck = await client.query(
      `
      SELECT *
      FROM transformations
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [transformationId, req.user.store_id]
    );

    if (transfoCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }

    const transformation = transfoCheck.rows[0];

    if (transformation.status === 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Une transformation validée ne peut plus être modifiée' });
    }

    const allowedStatuses = ['draft', 'cancelled'];
    if (status && !allowedStatuses.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Statut non autorisé manuellement' });
    }

    await client.query(
      `
      UPDATE transformations
      SET
        transformation_date = COALESCE($1::date, transformation_date),
        status = COALESCE($2, status),
        reference_number = $3,
        notes = $4,
        updated_by = $5,
        updated_at = NOW()
      WHERE id = $6
        AND store_id = $7
      `,
      [
        transformation_date || null,
        status || null,
        toNullableString(reference_number),
        toNullableString(notes),
        req.user.id,
        transformationId,
        req.user.store_id,
      ]
    );

    if (input_article_id !== undefined || input_quantity !== undefined || input_unit !== undefined) {
      let inputQty = null;

      if (input_quantity !== undefined && input_quantity !== null && input_quantity !== '') {
        inputQty = Number(input_quantity);
        if (!Number.isFinite(inputQty) || inputQty <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Quantité source invalide' });
        }
      }

      if (input_article_id) {
        const inputArticleCheck = await client.query(
          `
          SELECT id
          FROM articles
          WHERE id = $1
            AND store_id = $2
          LIMIT 1
          `,
          [input_article_id, req.user.store_id]
        );

        if (inputArticleCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Article source introuvable' });
        }
      }

      const finalInputUnit = input_unit ? normalizeTransformationUnit(input_unit) : null;

      const existingInput = await client.query(
        `
        SELECT id
        FROM transformation_inputs
        WHERE transformation_id = $1
          AND line_number = 1
        LIMIT 1
        `,
        [transformationId]
      );

      if (existingInput.rows.length > 0) {
        await client.query(
          `
          UPDATE transformation_inputs
          SET
            article_id = COALESCE($1, article_id),
            input_quantity = COALESCE($2, input_quantity),
            input_unit = COALESCE($3, input_unit),
            updated_at = NOW()
          WHERE transformation_id = $4
            AND line_number = 1
          `,
          [input_article_id || null, inputQty, finalInputUnit, transformationId]
        );
      } else if (input_article_id && inputQty !== null && inputQty > 0) {
        await client.query(
          `
          INSERT INTO transformation_inputs (
            id,
            transformation_id,
            store_id,
            department_id,
            article_id,
            line_number,
            input_quantity,
            input_unit,
            line_status
          )
          VALUES (
            gen_random_uuid(),
            $1, $2, $3, $4, 1,
            $5, $6,
            'pending'
          )
          `,
          [
            transformationId,
            req.user.store_id,
            transformation.department_id,
            input_article_id,
            inputQty,
            finalInputUnit || 'kg',
          ]
        );
      }
    }

    if (output_article_id !== undefined || output_quantity !== undefined || output_unit !== undefined) {
      let outputQty = null;

      if (output_quantity !== undefined && output_quantity !== null && output_quantity !== '') {
        outputQty = Number(output_quantity);
        if (!Number.isFinite(outputQty) || outputQty <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Quantité cible invalide' });
        }
      }

      if (output_article_id) {
        const outputArticleCheck = await client.query(
          `
          SELECT id
          FROM articles
          WHERE id = $1
            AND store_id = $2
          LIMIT 1
          `,
          [output_article_id, req.user.store_id]
        );

        if (outputArticleCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Article cible introuvable' });
        }
      }

      const finalOutputUnit = output_unit ? normalizeTransformationUnit(output_unit) : null;

      const existingOutput = await client.query(
        `
        SELECT id
        FROM transformation_outputs
        WHERE transformation_id = $1
          AND line_number = 1
        LIMIT 1
        `,
        [transformationId]
      );

      if (existingOutput.rows.length > 0) {
        await client.query(
          `
          UPDATE transformation_outputs
          SET
            article_id = COALESCE($1, article_id),
            output_quantity = COALESCE($2, output_quantity),
            output_unit = COALESCE($3, output_unit),
            updated_at = NOW()
          WHERE transformation_id = $4
            AND line_number = 1
          `,
          [output_article_id || null, outputQty, finalOutputUnit, transformationId]
        );
      } else if (output_article_id && outputQty !== null && outputQty > 0) {
        await client.query(
          `
          INSERT INTO transformation_outputs (
            id,
            transformation_id,
            store_id,
            department_id,
            article_id,
            line_number,
            output_quantity,
            output_unit,
            unit_cost_ex_vat,
            total_cost_ex_vat,
            line_status
          )
          VALUES (
            gen_random_uuid(),
            $1, $2, $3, $4, 1,
            $5, $6,
            0, 0,
            'pending'
          )
          `,
          [
            transformationId,
            req.user.store_id,
            transformation.department_id,
            output_article_id,
            outputQty,
            finalOutputUnit || 'kg',
          ]
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Transformation modifiée avec succès',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/transformations/:id :', err);
    res.status(500).json({ error: 'Erreur mise à jour transformation' });
  } finally {
    client.release();
  }
});

// =========================================================
// SUPPRIMER TRANSFORMATION BROUILLON
// =========================================================

router.delete('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const transformationId = req.params.id;

    await client.query('BEGIN');

    const transfoCheck = await client.query(
      `
      SELECT *
      FROM transformations
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [transformationId, req.user.store_id]
    );

    if (transfoCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }

    const transformation = transfoCheck.rows[0];

    if (transformation.status === 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible de supprimer une transformation validée. Utilise l’annulation métier.',
      });
    }

    const inputIdsResult = await client.query(
      `
      SELECT id
      FROM transformation_inputs
      WHERE transformation_id = $1
      `,
      [transformationId]
    );

    const inputIds = inputIdsResult.rows.map((row) => row.id);

    if (inputIds.length > 0) {
      await client.query(
        `
        DELETE FROM transformation_input_lots
        WHERE transformation_input_id = ANY($1::uuid[])
        `,
        [inputIds]
      );
    }

    await client.query(
      `
      DELETE FROM transformation_metadata
      WHERE transformation_id = $1
      `,
      [transformationId]
    );

    await client.query(
      `
      DELETE FROM transformation_outputs
      WHERE transformation_id = $1
      `,
      [transformationId]
    );

    await client.query(
      `
      DELETE FROM transformation_inputs
      WHERE transformation_id = $1
      `,
      [transformationId]
    );

    await client.query(
      `
      DELETE FROM transformations
      WHERE id = $1
        AND store_id = $2
      `,
      [transformationId, req.user.store_id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Transformation supprimée',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/transformations/:id :', err);
    res.status(500).json({ error: 'Erreur suppression transformation' });
  } finally {
    client.release();
  }
});

// =========================================================
// VALIDER TRANSFORMATION
// =========================================================

router.post('/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const transformationId = req.params.id;
    const {
      selection_mode = 'fifo',
      manual_lots = [],
    } = req.body || {};

    await client.query('BEGIN');

    const transfoResult = await client.query(
      `
      SELECT *
      FROM transformations
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [transformationId, req.user.store_id]
    );

    if (transfoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }

    const transformation = transfoResult.rows[0];

    if (transformation.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document déjà validé ou non modifiable' });
    }

    const inputResult = await client.query(
      `
      SELECT
        ti.*,
        a.plu AS article_plu,
        a.designation AS article_name
      FROM transformation_inputs ti
      LEFT JOIN articles a ON a.id = ti.article_id
      WHERE ti.transformation_id = $1
        AND ti.line_number = 1
      LIMIT 1
      `,
      [transformationId]
    );

    if (inputResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "Ligne source manquante - veuillez définir l'article et la quantité source" });
    }

    const input = inputResult.rows[0];

    if (!input.article_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Article source non défini' });
    }

    if (!input.input_quantity || input.input_quantity <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quantité source invalide ou manquante' });
    }

    const outputResult = await client.query(
      `
      SELECT
        to1.*,
        a.plu AS article_plu,
        a.designation AS article_name
      FROM transformation_outputs to1
      LEFT JOIN articles a ON a.id = to1.article_id
      WHERE to1.transformation_id = $1
        AND to1.line_number = 1
      LIMIT 1
      `,
      [transformationId]
    );

    if (outputResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "Ligne cible manquante - veuillez définir l'article et la quantité cible" });
    }

    const output = outputResult.rows[0];

    if (!output.article_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Article cible non défini' });
    }

    if (!output.output_quantity || output.output_quantity <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quantité cible invalide ou manquante' });
    }

    const selectedLots = await getTransformationLotSelection(client, {
      storeId: transformation.store_id,
      departmentId: transformation.department_id,
      articleId: input.article_id,
      requiredQty: input.input_quantity,
      selectionMode: selection_mode,
      manualLots: manual_lots,
    });

    await client.query(
      `
      DELETE FROM transformation_input_lots
      WHERE transformation_input_id = $1
      `,
      [input.id]
    );

    for (const row of selectedLots) {
      const qtyTaken = Number(row.quantity_taken || 0);

      await client.query(
        `
        INSERT INTO transformation_input_lots (
          id,
          transformation_input_id,
          lot_id,
          quantity_taken,
          unit_cost_ex_vat,
          selection_mode,
          sort_order
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, $5, $6
        )
        `,
        [
          input.id,
          row.lot_id,
          qtyTaken,
          Number(row.unit_cost_ex_vat || 0),
          row.selection_mode,
          row.sort_order,
        ]
      );

      const lotUpdate = await client.query(
        `
        UPDATE lots
        SET qty_remaining = qty_remaining - $1
        WHERE id = $2
          AND qty_remaining >= $1
        RETURNING id, qty_remaining
        `,
        [qtyTaken, row.lot_id]
      );

      if (lotUpdate.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Stock insuffisant ou lot déjà consommé' });
      }

      await client.query(
        `
        INSERT INTO stock_movements (
          id,
          store_id,
          department_id,
          article_id,
          lot_id,
          movement_type,
          quantity,
          unit_cost_ex_vat,
          source_table,
          source_id,
          notes,
          created_at,
          created_by
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4,
          'transformation_out',
          $5,
          $6,
          'transformation_inputs',
          $7,
          $8,
          NOW(),
          $9
        )
        `,
        [
          transformation.store_id,
          transformation.department_id,
          input.article_id,
          row.lot_id,
          qtyTaken,
          Number(row.unit_cost_ex_vat || 0),
          input.id,
          `Sortie transformation ${transformation.id}`,
          req.user.id,
        ]
      );
    }

    const createdLot = await createTransformationOutputLot(client, {
      transformation,
      output,
      inputLots: selectedLots,
      reqUserId: req.user.id,
    });

    await client.query(
      `
      UPDATE transformation_inputs
      SET
        line_status = 'validated',
        updated_at = NOW()
      WHERE id = $1
      `,
      [input.id]
    );

    await client.query(
      `
      UPDATE transformations
      SET
        status = 'validated',
        updated_at = NOW(),
        updated_by = $2
      WHERE id = $1
      `,
      [transformationId, req.user.id]
    );

    await recomputeArticleStock(client, input.article_id, transformation.store_id, transformation.department_id);
    await recomputeArticleStock(client, output.article_id, transformation.store_id, transformation.department_id);

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Transformation validée avec succès',
      created_lot: createdLot,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations/:id/validate :', err);
    res.status(500).json({ error: err.message || 'Erreur validation transformation' });
  } finally {
    client.release();
  }
});

// =========================================================
// ANNULER TRANSFORMATION VALIDEE
// =========================================================

router.post('/:id/cancel-validated', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const transformationId = req.params.id;

    await client.query('BEGIN');

    const transfoResult = await client.query(
      `
      SELECT *
      FROM transformations
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [transformationId, req.user.store_id]
    );

    const transformation = transfoResult.rows[0];

    if (!transformation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transformation introuvable' });
    }

    if (transformation.status !== 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Seule une transformation validée peut être annulée' });
    }

    const inputsResult = await client.query(
      `
      SELECT *
      FROM transformation_inputs
      WHERE transformation_id = $1
      ORDER BY line_number ASC
      `,
      [transformationId]
    );

    const outputsResult = await client.query(
      `
      SELECT *
      FROM transformation_outputs
      WHERE transformation_id = $1
      ORDER BY line_number ASC
      `,
      [transformationId]
    );

    const inputs = inputsResult.rows;
    const outputs = outputsResult.rows;

    if (!inputs.length || !outputs.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Lignes de transformation incomplètes' });
    }

    const output = outputs[0];

    if (!output.created_lot_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Lot cible introuvable' });
    }

    const targetLotResult = await client.query(
      `
      SELECT *
      FROM lots
      WHERE id = $1
      LIMIT 1
      `,
      [output.created_lot_id]
    );

    const targetLot = targetLotResult.rows[0];

    if (!targetLot) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Lot cible introuvable' });
    }

    const consumedCheck = await client.query(
      `
      SELECT COUNT(*) as consumed_count
      FROM stock_movements
      WHERE lot_id = $1
        AND movement_type = 'transformation_out'
        AND created_at > $2
      `,
      [targetLot.id, targetLot.created_at]
    );

    if (Number(consumedCheck.rows[0].consumed_count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: "Impossible d'annuler : le lot transformé a déjà été consommé ou vendu.",
      });
    }

    const inputIds = inputs.map((i) => i.id);
    const outputIds = outputs.map((o) => o.id);

    const inputLotsResult = await client.query(
      `
      SELECT *
      FROM transformation_input_lots
      WHERE transformation_input_id = ANY($1::uuid[])
      `,
      [inputIds]
    );

    const inputLots = inputLotsResult.rows;

    for (const inputLot of inputLots) {
      await client.query(
        `
        UPDATE lots
        SET qty_remaining = qty_remaining + $1
        WHERE id = $2
        `,
        [inputLot.quantity_taken, inputLot.lot_id]
      );
    }

    await client.query(
      `
      DELETE FROM stock_movements
      WHERE (source_table = 'transformation_inputs' AND source_id = ANY($1::uuid[]))
         OR (source_table = 'transformation_outputs' AND source_id = ANY($2::uuid[]))
      `,
      [inputIds, outputIds]
    );

    await client.query(
      `
      DELETE FROM lots
      WHERE id = $1
      `,
      [targetLot.id]
    );

    await client.query(
      `
      UPDATE transformation_inputs
      SET
        line_status = 'pending',
        updated_at = NOW()
      WHERE transformation_id = $1
      `,
      [transformationId]
    );

    await client.query(
      `
      UPDATE transformation_outputs
      SET
        created_lot_id = NULL,
        line_status = 'pending',
        unit_cost_ex_vat = 0,
        total_cost_ex_vat = 0,
        updated_at = NOW()
      WHERE transformation_id = $1
      `,
      [transformationId]
    );

    await client.query(
      `
      UPDATE transformations
      SET
        status = 'cancelled',
        updated_by = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [req.user.id, transformationId]
    );

    const impactedArticleIds = new Set();
    impactedArticleIds.add(output.article_id);

    for (const input of inputs) {
      impactedArticleIds.add(input.article_id);
    }

    for (const articleId of impactedArticleIds) {
      await recomputeArticleStock(client, articleId, transformation.store_id, transformation.department_id);
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Transformation annulée et stock restauré.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/transformations/:id/cancel-validated :', err);
    res.status(500).json({ error: err.message || 'Erreur annulation transformation' });
  } finally {
    client.release();
  }
});

module.exports = router;
