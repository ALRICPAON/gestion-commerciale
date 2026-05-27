const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');
const { assertDepartmentBelongsToStore } = require('../utils/departmentHelpers');

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { department_id } = req.query;

    if (!department_id) {
      return res.status(400).json({
        error: 'department_id requis',
      });
    }

    const result = await req.dbPool.query(
      `
      SELECT
        f.*,
        r.name AS recipe_name,
        a.designation AS output_article_name,
        a.plu AS output_article_plu
      FROM fabrications f
      LEFT JOIN recipes r
        ON r.id = f.recipe_id
      LEFT JOIN articles a
        ON a.id = f.output_article_id
      WHERE f.department_id = $1
        AND f.store_id = $2
      ORDER BY f.created_at DESC
      `,
      [department_id, req.user.store_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('GET /api/fabrications error:', error);

    res.status(500).json({
      error: 'Erreur chargement fabrications',
    });
  }
});

router.post('/', authenticateToken, attachDbContext, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      department_id,
      recipe_id,
      planned_quantity,
      notes,
    } = req.body;

    if (!department_id) {
      return res.status(400).json({
        error: 'department_id requis',
      });
    }

    await client.query('BEGIN');

    const department = await assertDepartmentBelongsToStore(client, department_id, req.user.store_id);

    if (!department) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Rayon invalide pour ce magasin',
      });
    }

    let recipe = null;

    if (recipe_id) {
      const recipeResult = await client.query(
        `
        SELECT *
        FROM recipes
        WHERE id = $1
          AND store_id = $2
          AND department_id = $3
        LIMIT 1
        `,
        [recipe_id, req.user.store_id, department_id]
      );

      recipe = recipeResult.rows[0];

      if (!recipe) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'Recette introuvable',
        });
      }
    }

    const finalPlannedQuantity = Number(planned_quantity || recipe?.output_quantity || 1);
    const baseOutputQuantity = Number(recipe?.output_quantity || 1);
    const ratio = baseOutputQuantity > 0 ? finalPlannedQuantity / baseOutputQuantity : 1;

    const fabricationResult = await client.query(
      `
      INSERT INTO fabrications (
        store_id,
        department_id,
        recipe_id,
        output_article_id,
        name,
        planned_quantity,
        output_unit,
        notes,
        created_by,
        updated_by
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $9
      )
      RETURNING *
      `,
      [
        req.user.store_id,
        department_id,
        recipe?.id || null,
        recipe?.output_article_id || null,
        recipe?.name || 'Nouvelle fabrication',
        finalPlannedQuantity,
        recipe?.output_unit || 'kg',
        notes || null,
        req.user.id,
      ]
    );

    const fabrication = fabricationResult.rows[0];

    if (recipe_id) {
      const ingredientsResult = await client.query(
  `
  SELECT *
  FROM recipe_ingredients
  WHERE recipe_id = $1
  ORDER BY created_at ASC
  `,
  [recipe_id]
);

      let lineNumber = 1;

      for (const ingredient of ingredientsResult.rows) {
        const scaledQuantity = Number(ingredient.quantity || 0) * ratio;

        await client.query(
          `
          INSERT INTO fabrication_lines (
            fabrication_id,
            store_id,
            department_id,
            article_id,
            line_number,
            planned_quantity,
            unit
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
          )
          `,
          [
            fabrication.id,
            req.user.store_id,
            department_id,
            ingredient.article_id,
            lineNumber,
            scaledQuantity,
            ingredient.unit || 'kg',
          ]
        );

        lineNumber += 1;
      }
    }

    await client.query(
      `
      INSERT INTO fabrication_metadata (
        fabrication_id,
        meta_key,
        meta_value
      )
      VALUES (
        $1,
        'v2_fabrication',
        '{}'::jsonb
      )
      ON CONFLICT (fabrication_id, meta_key)
      DO NOTHING
      `,
      [fabrication.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      fabrication_id: fabrication.id,
      fabrication,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('POST /api/fabrications error:', error);

    res.status(500).json({
      error: 'Erreur creation fabrication',
    });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { id } = req.params;

    const fabricationResult = await req.dbPool.query(
      `
      SELECT
        f.*,
        r.name AS recipe_name,
r.procedure AS recipe_procedure,
a.plu AS output_article_plu,
        a.designation AS output_article_name
      FROM fabrications f
      LEFT JOIN recipes r
        ON r.id = f.recipe_id
      LEFT JOIN articles a
        ON a.id = f.output_article_id
      WHERE f.id = $1
        AND f.store_id = $2
      LIMIT 1
      `,
      [id, req.user.store_id]
    );

    const fabrication = fabricationResult.rows[0];

    if (!fabrication) {
      return res.status(404).json({
        error: 'Fabrication introuvable',
      });
    }

    const linesResult = await req.dbPool.query(
      `
      SELECT
        fl.*,
        a.plu,
        a.designation AS article_name
      FROM fabrication_lines fl
      LEFT JOIN articles a
        ON a.id = fl.article_id
      WHERE fl.fabrication_id = $1
      ORDER BY fl.line_number ASC
      `,
      [id]
    );

    res.json({
      ...fabrication,
      lines: linesResult.rows,
    });
  } catch (error) {
    console.error('GET /api/fabrications/:id error:', error);

    res.status(500).json({
      error: 'Erreur chargement fabrication',
    });
  }
});

router.patch('/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const { id } = req.params;
    const { used_quantity } = req.body;
    const quantity = Number(used_quantity || 0);

    if (quantity <= 0) {
      return res.status(400).json({
        error: 'Quantité utilisée doit être supérieure à 0',
      });
    }

    const lineResult = await req.dbPool.query(
      `
      SELECT
        fl.id,
        fl.fabrication_id,
        f.status
      FROM fabrication_lines fl
      JOIN fabrications f
        ON f.id = fl.fabrication_id
      WHERE fl.id = $1
        AND fl.store_id = $2
      LIMIT 1
      `,
      [id, req.user.store_id]
    );

    const line = lineResult.rows[0];

    if (!line) {
      return res.status(404).json({
        error: 'Ligne de fabrication introuvable',
      });
    }

    if (!['draft', 'in_progress'].includes(line.status)) {
      return res.status(400).json({
        error: 'Fabrication non modifiable',
      });
    }

    const updateResult = await req.dbPool.query(
      `
      UPDATE fabrication_lines
      SET
        used_quantity = $2,
        updated_at = NOW()
      WHERE id = $1
        AND store_id = $3
      RETURNING *
      `,
      [id, quantity, req.user.store_id]
    );

    res.json({
      ok: true,
      line: updateResult.rows[0],
    });
  } catch (error) {
    console.error('PATCH /api/fabrications/lines/:id error:', error);

    res.status(500).json({
      error: 'Erreur mise à jour ligne de fabrication',
    });
  }
});

router.patch('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      planned_quantity,
      produced_quantity,
      status,
      notes,
      dlc_date,
    } = req.body;

    const allowedStatuses = ['draft', 'in_progress', 'validated', 'cancelled'];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Statut fabrication invalide',
      });
    }

    const result = await req.dbPool.query(
      `
      UPDATE fabrications
      SET
        name = COALESCE($2, name),
        planned_quantity = COALESCE($3, planned_quantity),
        produced_quantity = COALESCE($4, produced_quantity),
        status = COALESCE($5, status),
        notes = COALESCE($6, notes),
        dlc_date = COALESCE($7::date, dlc_date),
        updated_by = $8,
        updated_at = NOW()
      WHERE id = $1
        AND store_id = $9
        AND status IN ('draft', 'in_progress')
      RETURNING *
      `,
      [
        id,
        name || null,
        planned_quantity ?? null,
        produced_quantity ?? null,
        status || null,
        notes ?? null,
        dlc_date || null,
        req.user.id,
        req.user.store_id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: 'Fabrication introuvable ou non modifiable',
      });
    }

    res.json({
      ok: true,
      fabrication: result.rows[0],
    });
  } catch (error) {
    console.error('PATCH /api/fabrications/:id error:', error);

    res.status(500).json({
      error: 'Erreur modification fabrication',
    });
  }
});

router.delete('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await req.dbPool.query(
      `
      SELECT status
      FROM fabrications
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [id, req.user.store_id]
    );

    const fabrication = checkResult.rows[0];

    if (!fabrication) {
      return res.status(404).json({
        error: 'Fabrication introuvable',
      });
    }

    if (!['draft', 'in_progress'].includes(fabrication.status)) {
  return res.status(400).json({
    error: 'Suppression impossible'
  });
}

    await req.dbPool.query(
      `
      DELETE FROM fabrications
      WHERE id = $1
        AND store_id = $2
      `,
      [id, req.user.store_id]
    );

    res.json({
      ok: true,
    });
  } catch (error) {
    console.error('DELETE /api/fabrications/:id error:', error);

    res.status(500).json({
      error: 'Erreur suppression fabrication',
    });
  }
});

router.post('/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const fabricationResult = await client.query(
      `
      SELECT
        f.*,
        a.plu AS output_article_plu
      FROM fabrications f
      LEFT JOIN articles a
        ON a.id = f.output_article_id
      WHERE f.id = $1
        AND f.store_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [id, req.user.store_id]
    );

    const fabrication = fabricationResult.rows[0];

    if (!fabrication) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fabrication introuvable' });
    }

    if (!['draft', 'in_progress'].includes(fabrication.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document déjà validé ou non modifiable' });
    }

    if (!fabrication.output_article_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Produit fini manquant' });
    }

    const producedQty = Number(fabrication.produced_quantity || fabrication.planned_quantity || 0);

    if (producedQty <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quantité produite invalide' });
    }

    const linesResult = await client.query(
      `
      SELECT *
      FROM fabrication_lines
      WHERE fabrication_id = $1
      ORDER BY line_number ASC
      `,
      [id]
    );

    const lines = linesResult.rows;

    if (!lines.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun ingrédient à consommer' });
    }

    let totalInputCost = 0;
    const impactedArticleIds = new Set();

    const sourceTraceability = [];
const sourceAllergens = [];
const sourcePhotos = [];
const sourceDlcs = [];

    for (const line of lines) {
      if (!line.article_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Ligne ${line.line_number} sans article`,
        });
      }

      const qtyToConsume = Number(line.used_quantity || line.planned_quantity || 0);

      if (qtyToConsume <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Quantité invalide ligne ${line.line_number}`,
        });
      }

      const lotsResult = await client.query(
        `
        SELECT
          id,
          lot_code,
          qty_remaining,
          unit_cost_ex_vat,
          created_at
        FROM lots
        WHERE store_id = $1
          AND department_id = $2
          AND article_id = $3
          AND qty_remaining > 0
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
        `,
        [
          fabrication.store_id,
          fabrication.department_id,
          line.article_id,
        ]
      );

      const lots = lotsResult.rows;
      const totalAvailable = lots.reduce(
        (sum, lot) => sum + Number(lot.qty_remaining || 0),
        0
      );

      if (totalAvailable + 0.0001 < qtyToConsume) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Stock insuffisant ligne ${line.line_number}`,
        });
      }

      let remainingToConsume = qtyToConsume;
      let lineCost = 0;

      for (const lot of lots) {
        if (remainingToConsume <= 0) break;

        const lotQty = Number(lot.qty_remaining || 0);
        const consumeQty = Math.min(lotQty, remainingToConsume);
        const unitCost = Number(lot.unit_cost_ex_vat || 0);
        const lotUpdate = await client.query(
          `
          UPDATE lots
          SET qty_remaining = qty_remaining - $1
          WHERE id = $2
            AND qty_remaining >= $1
          RETURNING id, qty_remaining
          `,
          [consumeQty, lot.id]
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
            'fabrication_lines',
            $7,
            $8,
            NOW(),
            $9
          )
          `,
          [
            fabrication.store_id,
            fabrication.department_id,
            line.article_id,
            lot.id,
            consumeQty,
            unitCost,
            line.id,
            `Sortie fabrication ${fabrication.id}`,
            req.user.id,
          ]
        );

        lineCost += consumeQty * unitCost;
        remainingToConsume -= consumeQty;

        const lotDetailResult = await client.query(
  `
  SELECT
    l.id,
    l.lot_code,
    l.dlc,
    l.traceability_data,
    a.plu,
    a.designation,
    plm.sanitary_photo_url,
    plm.allergens
  FROM lots l
  LEFT JOIN articles a
    ON a.id = l.article_id
  LEFT JOIN purchase_line_metadata plm
    ON plm.purchase_line_id = l.purchase_line_id
   AND plm.meta_key = 'v2_line'
  WHERE l.id = $1
  LIMIT 1
  `,
  [lot.id]
);

const lotDetail = lotDetailResult.rows[0];

if (lotDetail) {
  const trace = lotDetail.traceability_data || {};

  sourceTraceability.push({
    lot_id: lotDetail.id,
    lot_code: lotDetail.lot_code,
    plu: lotDetail.plu,
    designation: lotDetail.designation,
    quantity_used: consumeQty,
    unit_cost_ex_vat: unitCost,
    dlc: lotDetail.dlc || null,
    sanitary_photo_url:
      lotDetail.sanitary_photo_url ||
      trace.sanitary_photo_url ||
      null,
    allergens:
      lotDetail.allergens ||
      trace.allergens ||
      null,
    latin_name: trace.latin_name || null,
    fao_zone: trace.fao_zone || null,
    sous_zone: trace.sous_zone || null,
    fishing_gear: trace.fishing_gear || null,
    production_method: trace.production_method || null,
    origin_label: trace.origin_label || null,
  });

  if (lotDetail.dlc) {
    sourceDlcs.push(lotDetail.dlc);
  }

  const photo =
    lotDetail.sanitary_photo_url ||
    trace.sanitary_photo_url ||
    null;

  if (photo) {
    sourcePhotos.push(photo);
  }

  const allergens =
    lotDetail.allergens ||
    trace.allergens ||
    null;

  if (allergens) {
    if (Array.isArray(allergens)) {
      sourceAllergens.push(...allergens);
    } else {
      sourceAllergens.push(...String(allergens).split(/[;,]/));
    }
  }
}
      }

      totalInputCost += lineCost;
      impactedArticleIds.add(line.article_id);

      await client.query(
        `
        UPDATE fabrication_lines
        SET
          used_quantity = $1,
          line_status = 'validated',
          updated_at = NOW()
        WHERE id = $2
        `,
        [qtyToConsume, line.id]
      );
    }

    const unitCostOutput = producedQty > 0
      ? Number((totalInputCost / producedQty).toFixed(4))
      : 0;

    const lotCode = `FAB-${String(fabrication.output_article_plu || 'NOPLU')
      .replace(/\\s+/g, '')
      .toUpperCase()}-${String(fabrication.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const outputLotResult = await client.query(
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
        NULL,
        $4,
        NULL,
        'fabrication',
        $5,
        $5,
        $6,
        $7,
        $8::jsonb,
        NOW()
      )
      RETURNING id, lot_code
      `,
      [
        fabrication.store_id,
        fabrication.department_id,
        fabrication.output_article_id,
        lotCode,
        producedQty,
        unitCostOutput,
        fabrication.dlc_date || null,
        JSON.stringify({
  source_type: 'fabrication',
  fabrication_id: fabrication.id,
  recipe_id: fabrication.recipe_id,
  fabrication_name: fabrication.name,

  total_input_cost_ex_vat: totalInputCost,
  produced_quantity: producedQty,

  source_lots: sourceTraceability,

  source_photos: [...new Set(sourcePhotos.filter(Boolean))],

  source_dlcs: [...new Set(sourceDlcs.filter(Boolean))],

  allergens: [
    ...new Set(
      sourceAllergens
        .map((a) => String(a).trim())
        .filter(Boolean)
    ),
  ],

  source_lot_codes: [
    ...new Set(
      sourceTraceability
        .map((row) => row.lot_code)
        .filter(Boolean)
    ),
  ],
})
      ]
    );

    const outputLot = outputLotResult.rows[0];

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
        'fabrications',
        $7,
        $8,
        NOW(),
        $9
      )
      `,
      [
        fabrication.store_id,
        fabrication.department_id,
        fabrication.output_article_id,
        outputLot.id,
        producedQty,
        unitCostOutput,
        fabrication.id,
        `Entrée fabrication ${fabrication.id}`,
        req.user.id,
      ]
    );

    await client.query(
      `
      UPDATE fabrications
      SET
        status = 'validated',
        produced_quantity = $2,
        updated_by = $3,
        updated_at = NOW()
      WHERE id = $1
      `,
      [fabrication.id, producedQty, req.user.id]
    );

    impactedArticleIds.add(fabrication.output_article_id);

    for (const articleId of impactedArticleIds) {
      await recomputeArticleStock(
        client,
        articleId,
        fabrication.store_id,
        fabrication.department_id
      );
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Fabrication validée avec succès',
      created_lot: outputLot,
      total_input_cost_ex_vat: totalInputCost,
      unit_cost_ex_vat: unitCostOutput,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('POST /api/fabrications/:id/validate error:', error);

    res.status(500).json({
      error: error.message || 'Erreur validation fabrication',
    });
  } finally {
    client.release();
  }
});

router.post('/:id/cancel-validated', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const fabricationResult = await client.query(
      `
      SELECT *
      FROM fabrications
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [id, req.user.store_id]
    );

    const fabrication = fabricationResult.rows[0];

    if (!fabrication) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fabrication introuvable' });
    }

    if (fabrication.status !== 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Seule une fabrication validée peut être annulée' });
    }

    const linesResult = await client.query(
      `
      SELECT id, article_id
      FROM fabrication_lines
      WHERE fabrication_id = $1
      `,
      [fabrication.id]
    );

    const fabricationLineIds = linesResult.rows.map((row) => row.id);
    const ingredientArticleIds = linesResult.rows
      .map((row) => row.article_id)
      .filter(Boolean);

    let outputLotResult = await client.query(
      `
      SELECT l.*
      FROM lots l
      WHERE l.store_id = $1
        AND l.source_type = 'fabrication'
        AND l.traceability_data->>'fabrication_id' = $2
      LIMIT 1
      `,
      [fabrication.store_id, fabrication.id]
    );

    let outputLot = outputLotResult.rows[0];

    if (!outputLot) {
      const outputLotIdResult = await client.query(
        `
        SELECT lot_id
        FROM stock_movements
        WHERE store_id = $1
          AND source_table = 'fabrications'
          AND source_id = $2
        LIMIT 1
        `,
        [fabrication.store_id, fabrication.id]
      );

      if (outputLotIdResult.rows.length > 0) {
        const fallbackLot = await client.query(
          `
          SELECT *
          FROM lots
          WHERE id = $1
          LIMIT 1
          `,
          [outputLotIdResult.rows[0].lot_id]
        );

        outputLot = fallbackLot.rows[0];
      }
    }

    if (!outputLot) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Lot produit fini introuvable' });
    }

    if (Number(outputLot.qty_remaining) !== Number(outputLot.qty_initial)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: "Impossible d'annuler : le lot fabriqué a déjà été consommé ou vendu."
      });
    }

    const consumedCheck = await client.query(
      `
      SELECT COUNT(*) as consumed_count
      FROM stock_movements
      WHERE lot_id = $1
        AND movement_type = 'transformation_out'
      `,
      [outputLot.id]
    );

    if (Number(consumedCheck.rows[0].consumed_count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: "Impossible d'annuler : le lot fabriqué a déjà été consommé ou vendu."
      });
    }

    if (fabricationLineIds.length > 0) {
      const ingredientMovementsResult = await client.query(
        `
        SELECT *
        FROM stock_movements
        WHERE source_table = 'fabrication_lines'
          AND source_id = ANY($1::uuid[])
          AND movement_type = 'transformation_out'
        `,
        [fabricationLineIds]
      );

      for (const movement of ingredientMovementsResult.rows) {
        await client.query(
          `
          UPDATE lots
          SET qty_remaining = qty_remaining + $1
          WHERE id = $2
          `,
          [movement.quantity, movement.lot_id]
        );
      }

      await client.query(
        `
        DELETE FROM stock_movements
        WHERE source_table = 'fabrication_lines'
          AND source_id = ANY($1::uuid[])
          AND movement_type = 'transformation_out'
        `,
        [fabricationLineIds]
      );
    }

    await client.query(
      `
      DELETE FROM stock_movements
      WHERE source_table = 'fabrications'
        AND source_id = $1
      `,
      [fabrication.id]
    );

    await client.query(
      `
      DELETE FROM lots
      WHERE id = $1
      `,
      [outputLot.id]
    );

    await client.query(
      `
      UPDATE fabrication_lines
      SET
        line_status = 'pending',
        updated_at = NOW()
      WHERE fabrication_id = $1
      `,
      [fabrication.id]
    );

    await client.query(
      `
      UPDATE fabrications
      SET
        status = 'cancelled',
        updated_by = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [req.user.id, fabrication.id]
    );

    const impactedArticleIds = new Set(ingredientArticleIds);
    if (fabrication.output_article_id) {
      impactedArticleIds.add(fabrication.output_article_id);
    }

    for (const articleId of impactedArticleIds) {
      await recomputeArticleStock(
        client,
        articleId,
        fabrication.store_id,
        fabrication.department_id
      );
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Fabrication annulée et stock restauré.',
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('POST /api/fabrications/:id/cancel-validated error:', error);

    res.status(500).json({
      error: error.message || 'Erreur annulation fabrication',
    });
  } finally {
    client.release();
  }
});

module.exports = router;
