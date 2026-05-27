const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

function getTraceabilityMovementLabel(movementType) {
  switch (movementType) {
    case 'purchase_in':
      return 'Entrée achat';

    case 'sale_out':
      return 'Sortie vente';

    case 'inventory_sale_out':
      return 'Sortie inventaire';

    case 'waste_out':
      return 'Sortie casse';

    case 'transfer_out':
      return 'Sortie rétrocession';

    case 'transformation_in':
      return 'Entrée transformation';

    case 'transformation_out':
      return 'Sortie transformation';

    case 'adjustment_out':
      return 'Sortie ajustement';

    case 'adjustment_in':
      return 'Entrée ajustement';

    default:
      return movementType || 'Mouvement';
  }
}

function normalizePhotoUrls(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter(Boolean).map((url) => String(url).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter(Boolean).map((url) => String(url).trim()).filter(Boolean);
        }
      } catch {
        return [trimmed];
      }
    }

    return [trimmed];
  }

  return [];
}

function buildSanitaryPhotoFields(lot, trace) {
  const urls = [];

  const addUrl = (url) => {
    if (!url) return;
    const normalized = String(url).trim();
    if (normalized && !urls.includes(normalized)) {
      urls.push(normalized);
    }
  };

  normalizePhotoUrls(lot.metadata_sanitary_photo_urls).forEach(addUrl);
  addUrl(lot.metadata_sanitary_photo_url);

  normalizePhotoUrls(lot.fallback_sanitary_photo_urls).forEach(addUrl);
  addUrl(lot.fallback_sanitary_photo_url);

  addUrl(lot.lot_sanitary_photo_url || lot.sanitary_photo_url);
  addUrl(trace.sanitary_photo_url);
  normalizePhotoUrls(trace.source_photos).forEach(addUrl);

  return {
    sanitary_photo_url: urls[0] || null,
    sanitary_photo_urls: urls,
  };
}

// =========================================================
// TRACEABILITY V2
// =========================================================

// LISTE DES LOTS POUR TRAÇABILITÉ
router.get('/lots', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const {
      department_id = '',
      from = '',
      to = '',
      plu = '',
      supplier = '',
      status = '',
      source_type = '',
      movement_type = '',
      limit = '30',
      offset = '0',
    } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const safeLimit = Math.min(Number(limit) || 30, 100);
    const safeOffset = Number(offset) || 0;

    const departmentCheck = await req.dbPool.query(
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
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    const params = [req.user.store_id, department_id];
    let where = `
      WHERE l.store_id = $1
        AND l.department_id = $2
    `;

    if (plu) {
      params.push(String(plu).trim());
      where += ` AND a.plu = $${params.length}`;
    }

    if (supplier) {
      params.push(`%${String(supplier).trim()}%`);
      where += ` AND s.name ILIKE $${params.length}`;
    }

    if (source_type) {
      params.push(String(source_type).trim());
      where += ` AND l.source_type = $${params.length}`;
    }

    if (status === 'open') {
      where += ` AND l.qty_remaining > 0`;
    }

    if (status === 'closed') {
      where += ` AND l.qty_remaining <= 0`;
    }

    if (from) {
      params.push(from);
      where += ` AND l.created_at::date >= $${params.length}::date`;
    }

    if (to) {
      params.push(to);
      where += ` AND l.created_at::date <= $${params.length}::date`;
    }

    params.push(safeLimit);
    params.push(safeOffset);

    const lotsResult = await req.dbPool.query(
      `
      SELECT
        l.id AS lot_id,
        l.lot_code,
        l.source_type,
        l.qty_initial,
        l.qty_remaining,
        l.unit_cost_ex_vat,
        l.dlc,
        l.sanitary_photo_url AS lot_sanitary_photo_url,
        l.traceability_data,
        l.created_at,

        l.purchase_id,
        l.purchase_line_id,
        l.article_id,
        l.supplier_id,

        a.plu AS article_plu,
        a.designation AS article_label,

        s.name AS supplier_name,

        plm.sanitary_photo_url AS metadata_sanitary_photo_url,
        plm.sanitary_photo_urls AS metadata_sanitary_photo_urls

      FROM lots l
      LEFT JOIN articles a
        ON a.id = l.article_id
      LEFT JOIN suppliers s
        ON s.id = l.supplier_id
      LEFT JOIN LATERAL (
        SELECT
          (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.sanitary_photo_url, '') ORDER BY CASE WHEN m.meta_key = 'v2_line' THEN 0 ELSE 1 END), NULL))[1] AS sanitary_photo_url,
          COALESCE(
            JSONB_AGG(DISTINCT url_elem) FILTER (WHERE url_elem IS NOT NULL),
            '[]'::jsonb
          ) AS sanitary_photo_urls
        FROM purchase_line_metadata m
        LEFT JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(m.sanitary_photo_urls, '[]'::jsonb)) AS url_elem ON true
        WHERE m.purchase_line_id = l.purchase_line_id
          AND m.meta_key IN ('v2_line', 'firebase_v1')
      ) plm ON l.purchase_line_id IS NOT NULL
      ${where}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

    const lots = lotsResult.rows;

    if (lots.length === 0) {
      return res.json([]);
    }

    const lotIds = lots.map((lot) => lot.lot_id);

    const movementParams = [lotIds];
    let movementWhere = `WHERE sm.lot_id = ANY($1::uuid[])`;

    if (movement_type) {
      movementParams.push(String(movement_type).trim());
      movementWhere += ` AND sm.movement_type = $2`;
    }

    const movementsResult = await req.dbPool.query(
      `
      SELECT
        sm.id,
        sm.lot_id,
        sm.movement_type,
        sm.quantity,
        sm.unit_cost_ex_vat,
        sm.source_table,
        sm.source_id,
        sm.notes,
        sm.created_at
      FROM stock_movements sm
      ${movementWhere}
      ORDER BY sm.created_at ASC, sm.id ASC
      `,
      movementParams
    );

    const movementsByLot = new Map();
    for (const movement of movementsResult.rows) {
      if (!movementsByLot.has(movement.lot_id)) {
        movementsByLot.set(movement.lot_id, []);
      }
      movementsByLot.get(movement.lot_id).push({
        id: movement.id,
        movement_type: movement.movement_type,
        movement_label: getTraceabilityMovementLabel(movement.movement_type),
        quantity: Number(movement.quantity || 0),
        unit_cost_ex_vat: Number(movement.unit_cost_ex_vat || 0),
        source_table: movement.source_table,
        source_id: movement.source_id,
        notes: movement.notes,
        created_at: movement.created_at,
      });
    }

    const response = lots
      .map((lot) => {
        const trace = lot.traceability_data || {};
        const movements = movementsByLot.get(lot.lot_id) || [];

        if (movement_type && movements.length === 0) {
          return null;
        }

        const qtyInitial = Number(lot.qty_initial || 0);
        const qtyRemaining = Number(lot.qty_remaining || 0);
        const sanitaryPhotos = buildSanitaryPhotoFields(lot, trace);

        let statusLabel = 'open';
        if (qtyRemaining <= 0) {
          statusLabel = 'closed';
        } else if (qtyRemaining < qtyInitial) {
          statusLabel = 'partial';
        }

        return {
          lot_id: lot.lot_id,
          lot_code: lot.lot_code,
          source_type: lot.source_type,
          article_id: lot.article_id,
          article_plu: lot.article_plu,
          article_label: lot.article_label,
          supplier_id: lot.supplier_id,
          supplier_name: lot.supplier_name,
          purchase_id: lot.purchase_id,
          purchase_line_id: lot.purchase_line_id,
          qty_initial: qtyInitial,
          qty_remaining: qtyRemaining,
          unit_cost_ex_vat: Number(lot.unit_cost_ex_vat || 0),
          dlc: lot.dlc,
          created_at: lot.created_at,
          sanitary_photo_url: sanitaryPhotos.sanitary_photo_url,
          sanitary_photo_urls: sanitaryPhotos.sanitary_photo_urls,
          traceability: {
            latin_name: trace.latin_name || null,
            fao_zone: trace.fao_zone || null,
            sous_zone: trace.sous_zone || null,
            fishing_gear: trace.fishing_gear || null,
            production_method: trace.production_method || null,
            allergens: trace.allergens || null,
            origin_label: trace.origin_label || null,
            source_type: trace.source_type || null,
            fabrication_id: trace.fabrication_id || null,
            fabrication_name: trace.fabrication_name || null,
            source_lots: trace.source_lots || [],
            source_photos: trace.source_photos || [],
            source_dlcs: trace.source_dlcs || [],
            source_lot_codes: trace.source_lot_codes || [],
          },
          status: statusLabel,
          has_sale_out: movements.some((m) =>
  ['sale_out', 'inventory_sale_out', 'waste_out', 'transfer_out'].includes(m.movement_type)
),
has_purchase_in: movements.some((m) => m.movement_type === 'purchase_in'),
has_waste_out: movements.some((m) => m.movement_type === 'waste_out'),
has_transfer_out: movements.some((m) => m.movement_type === 'transfer_out'),
has_inventory_sale_out: movements.some((m) => m.movement_type === 'inventory_sale_out'),
          movements_preview: movements.slice(-5),
        };
      })
      .filter(Boolean);

    res.json(response);
  } catch (err) {
    console.error('Erreur GET /api/traceability/lots :', err);
    res.status(500).json({ error: 'Erreur serveur traçabilité lots' });
  }
});

// DETAIL D'UN LOT POUR TRAÇABILITÉ
router.get('/lots/:lotId', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const lotId = req.params.lotId;

    const lotResult = await req.dbPool.query(
      `
      SELECT
        l.*,
        a.plu AS article_plu,
        a.designation AS article_label,
        s.name AS supplier_name,
        p.purchase_date,
        p.bl_number,
        pl.line_number,
        pl.supplier_reference,
        pl.supplier_label,
        l.sanitary_photo_url AS lot_sanitary_photo_url,
        plm.sanitary_photo_url AS metadata_sanitary_photo_url,
        plm.sanitary_photo_urls AS metadata_sanitary_photo_urls,
        fallback_plm.sanitary_photo_url AS fallback_sanitary_photo_url,
        fallback_plm.sanitary_photo_urls AS fallback_sanitary_photo_urls,
        COALESCE(plm.notes, fallback_plm.notes) AS metadata_notes
      FROM lots l
      LEFT JOIN articles a
        ON a.id = l.article_id
      LEFT JOIN suppliers s
        ON s.id = l.supplier_id
      LEFT JOIN purchases p
        ON p.id = l.purchase_id
      LEFT JOIN purchase_lines pl
        ON pl.id = l.purchase_line_id
      LEFT JOIN LATERAL (
        SELECT
          (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.sanitary_photo_url, '') ORDER BY CASE WHEN m.meta_key = 'v2_line' THEN 0 ELSE 1 END), NULL))[1] AS sanitary_photo_url,
          COALESCE(
            JSONB_AGG(DISTINCT url_elem) FILTER (WHERE url_elem IS NOT NULL),
            '[]'::jsonb
          ) AS sanitary_photo_urls,
          (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.notes, '') ORDER BY CASE WHEN m.meta_key = 'v2_line' THEN 0 ELSE 1 END), NULL))[1] AS notes
        FROM purchase_line_metadata m
        LEFT JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(m.sanitary_photo_urls, '[]'::jsonb)) AS url_elem ON true
        WHERE m.purchase_line_id = l.purchase_line_id
          AND m.meta_key IN ('v2_line', 'firebase_v1')
      ) plm ON l.purchase_line_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT
          (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.sanitary_photo_url, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS sanitary_photo_url,
          COALESCE(
            JSONB_AGG(DISTINCT url_elem) FILTER (WHERE url_elem IS NOT NULL),
            '[]'::jsonb
          ) AS sanitary_photo_urls,
          (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.notes, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS notes
        FROM purchase_line_metadata m
        JOIN purchase_lines pl_fb
          ON pl_fb.id = m.purchase_line_id
        JOIN purchases p_fb
          ON p_fb.id = pl_fb.purchase_id
        LEFT JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(m.sanitary_photo_urls, '[]'::jsonb)) AS url_elem ON true
        WHERE l.purchase_line_id IS NULL
          AND m.meta_key = 'firebase_v1'
          AND p_fb.store_id = l.store_id
          AND p_fb.department_id = l.department_id
          AND NULLIF(l.traceability_data ->> 'firebase_ligne_id', '') IS NOT NULL
          AND NULLIF(m.meta_value, '')::jsonb ->> 'ligneId' = l.traceability_data ->> 'firebase_ligne_id'
          AND (
            NULLIF(l.traceability_data ->> 'firebase_achat_id', '') IS NULL
            OR NULLIF(m.meta_value, '')::jsonb ->> 'achatId' = l.traceability_data ->> 'firebase_achat_id'
          )
      ) fallback_plm ON true
      WHERE l.id = $1
        AND l.store_id = $2
      LIMIT 1
      `,
      [lotId, req.user.store_id]
    );

    if (lotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lot introuvable' });
    }

    const lot = lotResult.rows[0];
    const trace = lot.traceability_data || {};
    const sanitaryPhotos = buildSanitaryPhotoFields(lot, trace);

    const movementsResult = await req.dbPool.query(
      `
      SELECT
        sm.id,
        sm.lot_id,
        sm.movement_type,
        sm.quantity,
        sm.unit_cost_ex_vat,
        sm.source_table,
        sm.source_id,
        sm.notes,
        sm.created_at
      FROM stock_movements sm
      WHERE sm.lot_id = $1
      ORDER BY sm.created_at ASC, sm.id ASC
      `,
      [lotId]
    );

    const movements = movementsResult.rows.map((movement) => ({
      id: movement.id,
      movement_type: movement.movement_type,
      movement_label: getTraceabilityMovementLabel(movement.movement_type),
      quantity: Number(movement.quantity || 0),
      unit_cost_ex_vat: Number(movement.unit_cost_ex_vat || 0),
      source_table: movement.source_table,
      source_id: movement.source_id,
      notes: movement.notes,
      created_at: movement.created_at,
    }));

    const fifoConsumption = [];

    for (const movement of movements) {
  if ([
    'sale_out',
    'inventory_sale_out',
    'waste_out',
    'transfer_out'
  ].includes(movement.movement_type)) {
        let sourceDocument = null;

        if (movement.source_table === 'sales_lines' && movement.source_id) {
          const saleLineResult = await req.dbPool.query(
            `
            SELECT
              sl.id AS sales_line_id,
              sl.line_number,
              sd.id AS sales_document_id,
              sd.document_type,
              sd.reference_number,
              sd.document_date,
              sd.status
            FROM sales_lines sl
            JOIN sales_documents sd
              ON sd.id = sl.sales_document_id
            WHERE sl.id = $1
            LIMIT 1
            `,
            [movement.source_id]
          );

          if (saleLineResult.rows.length > 0) {
            sourceDocument = saleLineResult.rows[0];
          }
        }

        fifoConsumption.push({
          movement_id: movement.id,
          quantity_out: Number(movement.quantity || 0),
          created_at: movement.created_at,
          source_table: movement.source_table,
          source_id: movement.source_id,
          document: sourceDocument,
        });
      }
    }

    res.json({
      lot: {
        lot_id: lot.id,
        lot_code: lot.lot_code,
        source_type: lot.source_type,
        article_id: lot.article_id,
        article_plu: lot.article_plu,
        article_label: lot.article_label,
        supplier_id: lot.supplier_id,
        supplier_name: lot.supplier_name,
        purchase_id: lot.purchase_id,
        purchase_line_id: lot.purchase_line_id,
        purchase_date: lot.purchase_date,
        bl_number: lot.bl_number,
        purchase_line_number: lot.line_number,
        supplier_reference: lot.supplier_reference,
        supplier_label: lot.supplier_label,
        qty_initial: Number(lot.qty_initial || 0),
        qty_remaining: Number(lot.qty_remaining || 0),
        unit_cost_ex_vat: Number(lot.unit_cost_ex_vat || 0),
        dlc: lot.dlc,
        created_at: lot.created_at,
        sanitary_photo_url: sanitaryPhotos.sanitary_photo_url,
        sanitary_photo_urls: sanitaryPhotos.sanitary_photo_urls,
        metadata_notes: lot.metadata_notes || null,
        traceability: {
          latin_name: trace.latin_name || null,
          fao_zone: trace.fao_zone || null,
          sous_zone: trace.sous_zone || null,
          fishing_gear: trace.fishing_gear || null,
          production_method: trace.production_method || null,
          allergens: trace.allergens || null,
          origin_label: trace.origin_label || null,
          source_type: trace.source_type || null,
          fabrication_id: trace.fabrication_id || null,
          fabrication_name: trace.fabrication_name || null,
          source_lots: trace.source_lots || [],
          source_photos: trace.source_photos || [],
          source_dlcs: trace.source_dlcs || [],
          source_lot_codes: trace.source_lot_codes || [],
        },
      },
      movements,
      fifo_consumption: fifoConsumption,
    });
  } catch (err) {
    console.error('Erreur GET /api/traceability/lots/:lotId :', err);
    res.status(500).json({ error: 'Erreur serveur détail lot' });
  }
});

module.exports = router;
