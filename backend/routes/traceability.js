const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const {
  blockLotForQuality,
  errorBody: lotQualityErrorBody,
  releaseLotForQuality,
} = require('../services/quality/lotBlocking');
const {
  analyzeLotRecallImpact,
  createProductRecallDraft,
  getActiveCampaign,
  getProductRecallCampaign,
  sendProductRecallNotifications,
} = require('../services/productRecallService');
const {
  buildTraceabilityTestSnapshot,
  completeTraceabilityTest,
  searchTraceabilityTestLots,
} = require('../services/quality/traceabilityTestService');

const router = express.Router();

const QUALITY_BLOCK_REASON_TYPES = new Set([
  'supplier_recall',
  'health_alert',
  'quality_suspicion',
  'traceability_issue',
  'authority_request',
  'other',
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function safeLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
}

function safeOffset(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function lotStatusSql() {
  return `
    CASE
      WHEN COALESCE(l.qty_remaining, 0) <= 0 THEN 'closed'
      WHEN COALESCE(l.qty_initial, 0) > 0 AND COALESCE(l.qty_remaining, 0) < COALESCE(l.qty_initial, 0) THEN 'partial'
      ELSE 'open'
    END
  `;
}

function movementLabel(type) {
  switch (type) {
    case 'purchase_in': return 'Entrée achat';
    case 'sale_out': return 'Sortie vente';
    case 'inventory_sale_out': return 'Sortie inventaire';
    case 'forced_stock_exit': return 'Sortie forcée';
    case 'waste_out': return 'Sortie casse';
    case 'transfer_out': return 'Sortie transfert';
    case 'transformation_in': return 'Entrée transformation';
    case 'transformation_out': return 'Sortie transformation';
    case 'fabrication_in': return 'Entrée fabrication';
    case 'fabrication_out': return 'Sortie fabrication';
    case 'adjustment_in': return 'Entrée ajustement';
    case 'adjustment_out': return 'Sortie ajustement';
    case 'packing_source_out': return 'Colisage - consommation produit';
    case 'packing_material_out': return 'Colisage - consommation emballage';
    case 'packing_output_in': return 'Colisage - entree produit';
    default: return type || 'Mouvement';
  }
}

function normalizePhotos(row) {
  const urls = [];
  const add = (value) => {
    if (!value) return;
    const text = String(value).trim();
    if (text && !urls.includes(text)) urls.push(text);
  };

  add(row.sanitary_photo_url);
  if (Array.isArray(row.sanitary_photo_urls)) row.sanitary_photo_urls.forEach(add);
  return urls;
}

function mapTraceability(row) {
  return {
    latin_name: row.latin_name || null,
    fao_zone: row.fao_zone || null,
    sous_zone: row.sous_zone || null,
    fishing_gear: row.fishing_gear || null,
    production_method: row.production_method || null,
    origin_label: row.origin_label || null,
    allergens: row.allergens || null,
  };
}

function lotSelectSql(extraColumns = '') {
  return `
    SELECT
      l.id AS lot_id,
      l.lot_code,
      l.supplier_lot_number,
      l.source_type,
      l.qty_initial,
      l.qty_remaining,
      l.unit_cost_ex_vat,
      l.dlc,
      l.created_at,
      l.article_id,
      a.plu AS article_plu,
      a.designation AS article_label,
      a.unit AS article_unit,
      COALESCE(a.article_category, 'product') AS article_category,
      a.family_name,
      l.purchase_id,
      l.purchase_line_id,
      p.purchase_date,
      p.receipt_date,
      p.bl_number,
      p.invoice_number,
      pl.line_number AS purchase_line_number,
      pl.supplier_reference,
      pl.supplier_label,
      l.supplier_id,
      s.code AS supplier_code,
      s.name AS supplier_name,
      COALESCE(plm.latin_name, l.traceability_data->>'latin_name', a.latin_name) AS latin_name,
      COALESCE(plm.fao_zone, l.traceability_data->>'fao_zone', a.fao_zone) AS fao_zone,
      COALESCE(plm.sous_zone, l.traceability_data->>'sous_zone', a.sous_zone) AS sous_zone,
      COALESCE(plm.fishing_gear, l.traceability_data->>'fishing_gear', a.fishing_gear) AS fishing_gear,
      COALESCE(plm.production_method, l.traceability_data->>'production_method', a.production_method) AS production_method,
      COALESCE(plm.origin_label, l.traceability_data->>'origin_label') AS origin_label,
      COALESCE(plm.allergens, l.traceability_data->>'allergens', a.allergens) AS allergens,
      plm.sanitary_photo_url,
      COALESCE(plm.sanitary_photo_urls, '[]'::jsonb) AS sanitary_photo_urls,
      COALESCE(l.quality_status, 'available') AS quality_status,
      l.quality_block_reason,
      l.quality_block_reason_type,
      l.quality_block_comment,
      l.quality_blocked_at,
      l.quality_blocked_by,
      blocker.email AS quality_blocked_by_email,
      l.quality_released_at,
      l.quality_released_by,
      releaser.email AS quality_released_by_email,
      l.quality_release_reason,
      l.quality_release_comment,
      l.quality_non_conformity_id,
      qnc.title AS quality_non_conformity_title,
      qnc.status AS quality_non_conformity_status,
      ${lotStatusSql()} AS status
      ${extraColumns}
    FROM lots l
    JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
    LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
    LEFT JOIN users blocker ON blocker.id = l.quality_blocked_by
    LEFT JOIN users releaser ON releaser.id = l.quality_released_by
    LEFT JOIN quality_non_conformities qnc ON qnc.id = l.quality_non_conformity_id AND qnc.store_id = l.store_id
    LEFT JOIN purchases p ON p.id = l.purchase_id AND p.store_id = l.store_id
    LEFT JOIN purchase_lines pl ON pl.id = l.purchase_line_id AND pl.store_id = l.store_id
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.latin_name, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS latin_name,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.fao_zone, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS fao_zone,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.sous_zone, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS sous_zone,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.fishing_gear, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS fishing_gear,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.production_method, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS production_method,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.origin_label, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS origin_label,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.allergens, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS allergens,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.sanitary_photo_url, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS sanitary_photo_url,
        COALESCE(JSONB_AGG(DISTINCT url_elem) FILTER (WHERE url_elem IS NOT NULL), '[]'::jsonb) AS sanitary_photo_urls
      FROM purchase_line_metadata m
      LEFT JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(m.sanitary_photo_urls, '[]'::jsonb)) AS url_elem ON true
      WHERE m.purchase_line_id = l.purchase_line_id
    ) plm ON true
  `;
}

function deliveredClientsSql(lotCondition, limitClause = '') {
  return `
    SELECT
      sd.id AS delivery_note_id,
      sd.reference_number AS delivery_note_reference,
      sd.document_date AS delivery_note_date,
      sd.document_type,
      delivered.id AS delivered_client_id,
      COALESCE(sd.delivered_client_name_snapshot, delivered.name) AS delivered_client_name,
      COALESCE(sd.delivered_client_code_snapshot, delivered.code) AS delivered_client_code,
      COALESCE(sd.delivered_client_store_identifier, delivered.store_identifier) AS delivered_store_identifier,
      billed.id AS billed_client_id,
      COALESCE(sd.billed_client_name_snapshot, billed.name) AS billed_client_name,
      COALESCE(sd.billed_client_code_snapshot, billed.code) AS billed_client_code,
      SUM(sla.quantity) AS delivered_quantity,
      MIN(sla.created_at) AS allocated_at
    FROM sale_line_allocations sla
    JOIN sales_lines sl ON sl.id = sla.sales_line_id AND sl.store_id = $1
    JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
    LEFT JOIN clients delivered ON delivered.id = sd.client_id AND delivered.store_id = sd.store_id
    LEFT JOIN clients billed ON billed.id = COALESCE(sd.billed_client_id, delivered.billed_client_id, sd.client_id) AND billed.store_id = sd.store_id
    WHERE ${lotCondition}
    GROUP BY
      sd.id,
      sd.reference_number,
      sd.document_date,
      sd.document_type,
      sd.delivered_client_name_snapshot,
      sd.delivered_client_code_snapshot,
      sd.delivered_client_store_identifier,
      sd.billed_client_name_snapshot,
      sd.billed_client_code_snapshot,
      delivered.id,
      delivered.name,
      delivered.code,
      delivered.store_identifier,
      billed.id,
      billed.name,
      billed.code
    ORDER BY sd.document_date DESC, sd.reference_number DESC NULLS LAST
    ${limitClause}
  `;
}

function mapPackingOperation(row) {
  if (!row) return null;
  return {
    packing_operation_id: row.packing_operation_id,
    status: row.status,
    created_at: row.created_at,
    validated_at: row.validated_at,
    output_lot_id: row.output_lot_id,
    output_lot_code: row.output_lot_code,
    output_article_id: row.output_article_id,
    output_article_plu: row.output_article_plu,
    output_article_designation: row.output_article_designation,
    total_output_quantity: Number(row.total_output_quantity || 0),
    package_count: Number(row.package_count || 0),
    quantity_per_package: Number(row.quantity_per_package || 0),
    fish_cost_ex_vat: Number(row.fish_cost_ex_vat || 0),
    packaging_cost_ex_vat: Number(row.packaging_cost_ex_vat || 0),
    total_cost_ex_vat: Number(row.total_cost_ex_vat || 0),
    unit_cost_ex_vat: Number(row.unit_cost_ex_vat || 0),
  };
}

function mapPackingSource(row) {
  return {
    line_id: row.line_id,
    lot_id: row.lot_id,
    lot_code: row.lot_code,
    supplier_lot_number: row.supplier_lot_number,
    article_id: row.article_id,
    article_plu: row.article_plu,
    article_designation: row.article_designation,
    quantity_used: Number(row.quantity_used || 0),
    unit_cost_ex_vat: Number(row.unit_cost_ex_vat || 0),
    line_cost_ex_vat: Number(row.line_cost_ex_vat || 0),
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    dlc: row.dlc,
    purchase_id: row.purchase_id,
    purchase_line_id: row.purchase_line_id,
    purchase_date: row.purchase_date,
    receipt_date: row.receipt_date,
    bl_number: row.bl_number,
  };
}

function mapPackingMaterial(row) {
  return {
    line_id: row.line_id,
    lot_id: row.lot_id,
    lot_code: row.lot_code,
    supplier_lot_number: row.supplier_lot_number,
    article_id: row.article_id,
    article_plu: row.article_plu,
    article_designation: row.article_designation,
    quantity_used: Number(row.quantity_used || 0),
    unit: row.unit,
    unit_cost_ex_vat: Number(row.unit_cost_ex_vat || 0),
    line_cost_ex_vat: Number(row.line_cost_ex_vat || 0),
  };
}

async function fetchPackingTrace(db, storeId, lotId) {
  const producedResult = await db.query(
    `SELECT
       po.id AS packing_operation_id,
       po.status,
       po.created_at,
       po.validated_at,
       po.output_lot_id,
       out_lot.lot_code AS output_lot_code,
       po.output_article_id,
       out_article.plu AS output_article_plu,
       out_article.designation AS output_article_designation,
       po.total_output_quantity,
       po.package_count,
       po.quantity_per_package,
       po.fish_cost_ex_vat,
       po.packaging_cost_ex_vat,
       po.total_cost_ex_vat,
       po.unit_cost_ex_vat
     FROM packing_operations po
     JOIN articles out_article ON out_article.id = po.output_article_id AND out_article.store_id = po.store_id
     LEFT JOIN lots out_lot ON out_lot.id = po.output_lot_id AND out_lot.store_id = po.store_id
     WHERE po.store_id = $1::uuid
       AND po.output_lot_id = $2::uuid
     LIMIT 1`,
    [storeId, lotId]
  );

  const producedBy = mapPackingOperation(producedResult.rows[0]);
  let sourceLots = [];
  let materials = [];

  if (producedBy) {
    const sourceResult = await db.query(
      `SELECT
         psl.id AS line_id,
         psl.lot_id,
         l.lot_code,
         l.supplier_lot_number,
         psl.article_id,
         a.plu AS article_plu,
         a.designation AS article_designation,
         psl.quantity_used,
         psl.unit_cost_ex_vat,
         psl.line_cost_ex_vat,
         l.supplier_id,
         s.name AS supplier_name,
         l.dlc,
         l.purchase_id,
         l.purchase_line_id,
         p.purchase_date,
         p.receipt_date,
         p.bl_number
       FROM packing_source_lots psl
       JOIN lots l ON l.id = psl.lot_id AND l.store_id = psl.store_id
       JOIN articles a ON a.id = psl.article_id AND a.store_id = psl.store_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
       LEFT JOIN purchases p ON p.id = l.purchase_id AND p.store_id = l.store_id
       WHERE psl.store_id = $1::uuid
         AND psl.packing_operation_id = $2::uuid
       ORDER BY psl.created_at ASC, psl.id ASC`,
      [storeId, producedBy.packing_operation_id]
    );
    sourceLots = sourceResult.rows.map(mapPackingSource);

    const materialResult = await db.query(
      `SELECT
         pm.id AS line_id,
         pm.lot_id,
         l.lot_code,
         l.supplier_lot_number,
         pm.article_id,
         a.plu AS article_plu,
         a.designation AS article_designation,
         a.unit,
         pm.quantity_used,
         pm.unit_cost_ex_vat,
         pm.line_cost_ex_vat
       FROM packing_materials pm
       JOIN lots l ON l.id = pm.lot_id AND l.store_id = pm.store_id
       JOIN articles a ON a.id = pm.article_id AND a.store_id = pm.store_id
       WHERE pm.store_id = $1::uuid
         AND pm.packing_operation_id = $2::uuid
       ORDER BY pm.created_at ASC, pm.id ASC`,
      [storeId, producedBy.packing_operation_id]
    );
    materials = materialResult.rows.map(mapPackingMaterial);
  }

  const usedResult = await db.query(
    `SELECT
       psl.id AS line_id,
       po.id AS packing_operation_id,
       po.status,
       po.created_at,
       po.validated_at,
       po.output_lot_id,
       out_lot.lot_code AS output_lot_code,
       po.output_article_id,
       out_article.plu AS output_article_plu,
       out_article.designation AS output_article_designation,
       po.total_output_quantity,
       po.package_count,
       po.quantity_per_package,
       po.fish_cost_ex_vat,
       po.packaging_cost_ex_vat,
       po.total_cost_ex_vat,
       po.unit_cost_ex_vat,
       psl.quantity_used
     FROM packing_source_lots psl
     JOIN packing_operations po ON po.id = psl.packing_operation_id AND po.store_id = psl.store_id
     JOIN articles out_article ON out_article.id = po.output_article_id AND out_article.store_id = po.store_id
     LEFT JOIN lots out_lot ON out_lot.id = po.output_lot_id AND out_lot.store_id = po.store_id
     WHERE psl.store_id = $1::uuid
       AND psl.lot_id = $2::uuid
     ORDER BY po.validated_at DESC NULLS LAST, po.created_at DESC, po.id DESC`,
    [storeId, lotId]
  );

  const usedIn = usedResult.rows.map((row) => ({
    ...mapPackingOperation(row),
    line_id: row.line_id,
    source_quantity_used: Number(row.quantity_used || 0),
  }));

  return { produced_by: producedBy, source_lots: sourceLots, materials, used_in: usedIn };
}

function mapDeliveredClient(row) {
  return {
    delivery_note_id: row.delivery_note_id,
    delivery_note_reference: row.delivery_note_reference,
    delivery_note_date: row.delivery_note_date,
    document_type: row.document_type,
    delivered_client_id: row.delivered_client_id,
    delivered_client_name: row.delivered_client_name,
    delivered_client_code: row.delivered_client_code,
    delivered_store_identifier: row.delivered_store_identifier,
    billed_client_id: row.billed_client_id,
    billed_client_name: row.billed_client_name,
    billed_client_code: row.billed_client_code,
    delivered_quantity: Number(row.delivered_quantity || 0),
    allocated_at: row.allocated_at,
    sale_detail_url: row.delivery_note_id ? `./sale-detail.html?id=${row.delivery_note_id}` : null,
  };
}

function mapLot(row) {
  const deliveredClients = Array.isArray(row.delivered_clients) ? row.delivered_clients : [];
  const photos = normalizePhotos(row);
  return {
    lot_id: row.lot_id,
    lot_code: row.lot_code,
    supplier_lot_number: row.supplier_lot_number,
    status: row.status,
    source_type: row.source_type,
    qty_initial: Number(row.qty_initial || 0),
    qty_remaining: Number(row.qty_remaining || 0),
    unit_cost_ex_vat: Number(row.unit_cost_ex_vat || 0),
    dlc: row.dlc,
    created_at: row.created_at,
    article_id: row.article_id,
    article_plu: row.article_plu,
    article_label: row.article_label,
    article_unit: row.article_unit,
    family_name: row.family_name,
    supplier_id: row.supplier_id,
    supplier_code: row.supplier_code,
    supplier_name: row.supplier_name,
    purchase_id: row.purchase_id,
    purchase_line_id: row.purchase_line_id,
    purchase_date: row.purchase_date,
    receipt_date: row.receipt_date,
    bl_number: row.bl_number,
    invoice_number: row.invoice_number,
    purchase_line_number: row.purchase_line_number,
    supplier_reference: row.supplier_reference,
    supplier_label: row.supplier_label,
    sanitary_photo_url: photos[0] || null,
    sanitary_photo_urls: photos,
    traceability: mapTraceability(row),
    delivered_clients: deliveredClients.map(mapDeliveredClient),
    delivered_clients_count: Number(row.delivered_clients_count || deliveredClients.length || 0),
    quality: {
      status: row.quality_status || 'available',
      block_reason: row.quality_block_reason || null,
      block_reason_type: row.quality_block_reason_type || null,
      block_comment: row.quality_block_comment || null,
      blocked_at: row.quality_blocked_at || null,
      blocked_by: row.quality_blocked_by || null,
      blocked_by_email: row.quality_blocked_by_email || null,
      released_at: row.quality_released_at || null,
      released_by: row.quality_released_by || null,
      released_by_email: row.quality_released_by_email || null,
      release_reason: row.quality_release_reason || null,
      release_comment: row.quality_release_comment || null,
      non_conformity_id: row.quality_non_conformity_id || null,
      non_conformity_title: row.quality_non_conformity_title || null,
      non_conformity_status: row.quality_non_conformity_status || null,
    },
  };
}

router.get('/clients', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const search = clean(req.query.search);
    const params = [req.user.store_id];
    let where = "WHERE c.store_id = $1 AND COALESCE(c.status, 'active') <> 'inactive'";

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (
        c.name ILIKE $${params.length}
        OR COALESCE(c.code, '') ILIKE $${params.length}
        OR COALESCE(c.store_identifier, '') ILIKE $${params.length}
      )`;
    }

    params.push(safeLimit(req.query.limit, 20, 50));

    const result = await req.dbPool.query(
      `
      SELECT id, code, name, store_identifier
      FROM clients c
      ${where}
      ORDER BY c.name ASC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/traceability/clients :', err);
    res.status(500).json({ error: 'Erreur serveur recherche clients' });
  }
});

router.get('/lots', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    let where = "WHERE l.store_id = $1 AND COALESCE(a.article_category, 'product') = 'product'";

    const from = clean(req.query.from);
    if (from) {
      params.push(from);
      where += ` AND l.created_at::date >= $${params.length}::date`;
    }

    const to = clean(req.query.to);
    if (to) {
      params.push(to);
      where += ` AND l.created_at::date <= $${params.length}::date`;
    }

    const plu = clean(req.query.plu);
    if (plu) {
      params.push(`%${plu}%`);
      where += ` AND a.plu ILIKE $${params.length}`;
    }

    const lot = clean(req.query.lot);
    if (lot) {
      params.push(`%${lot}%`);
      where += ` AND (l.lot_code ILIKE $${params.length} OR COALESCE(l.supplier_lot_number, '') ILIKE $${params.length})`;
    }

    const supplier = clean(req.query.supplier);
    if (supplier) {
      params.push(`%${supplier}%`);
      where += ` AND (COALESCE(s.name, '') ILIKE $${params.length} OR COALESCE(s.code, '') ILIKE $${params.length})`;
    }

    const sourceType = clean(req.query.source_type);
    if (sourceType) {
      params.push(sourceType);
      where += ` AND l.source_type = $${params.length}`;
    }

    const status = clean(req.query.status);
    if (status === 'open') where += ` AND COALESCE(l.qty_remaining, 0) >= COALESCE(l.qty_initial, 0) AND COALESCE(l.qty_remaining, 0) > 0`;
    if (status === 'partial') where += ` AND COALESCE(l.qty_remaining, 0) > 0 AND COALESCE(l.qty_remaining, 0) < COALESCE(l.qty_initial, 0)`;
    if (status === 'closed') where += ` AND COALESCE(l.qty_remaining, 0) <= 0`;

    const qualityStatus = clean(req.query.quality_status);
    if (['available', 'blocked'].includes(qualityStatus)) {
      params.push(qualityStatus);
      where += ` AND COALESCE(l.quality_status, 'available') = $${params.length}`;
    }

    const movementType = clean(req.query.movement_type);
    if (movementType) {
      params.push(movementType);
      where += ` AND EXISTS (
        SELECT 1 FROM stock_movements sm
        WHERE sm.store_id = l.store_id
          AND sm.lot_id = l.id
          AND sm.movement_type = $${params.length}
      )`;
    }

    const client = clean(req.query.client);
    if (client) {
      params.push(`%${client}%`);
      where += ` AND EXISTS (
        SELECT 1
        FROM sale_line_allocations sla_filter
        JOIN sales_lines sl_filter ON sl_filter.id = sla_filter.sales_line_id AND sl_filter.store_id = l.store_id
        JOIN sales_documents sd_filter ON sd_filter.id = sl_filter.sales_document_id AND sd_filter.store_id = sl_filter.store_id
        LEFT JOIN clients delivered_filter ON delivered_filter.id = sd_filter.client_id AND delivered_filter.store_id = sd_filter.store_id
        LEFT JOIN clients billed_filter ON billed_filter.id = COALESCE(sd_filter.billed_client_id, delivered_filter.billed_client_id, sd_filter.client_id) AND billed_filter.store_id = sd_filter.store_id
        WHERE sla_filter.lot_id = l.id
          AND (
            COALESCE(sd_filter.delivered_client_name_snapshot, delivered_filter.name, '') ILIKE $${params.length}
            OR COALESCE(sd_filter.delivered_client_code_snapshot, delivered_filter.code, '') ILIKE $${params.length}
            OR COALESCE(sd_filter.delivered_client_store_identifier, delivered_filter.store_identifier, '') ILIKE $${params.length}
            OR COALESCE(sd_filter.billed_client_name_snapshot, billed_filter.name, '') ILIKE $${params.length}
            OR COALESCE(sd_filter.billed_client_code_snapshot, billed_filter.code, '') ILIKE $${params.length}
            OR COALESCE(billed_filter.store_identifier, '') ILIKE $${params.length}
          )
      )`;
    }

    params.push(safeLimit(req.query.limit));
    params.push(safeOffset(req.query.offset));

    const result = await req.dbPool.query(
      `
      ${lotSelectSql(`,
      COALESCE(delivered_preview.delivered_clients, '[]'::jsonb) AS delivered_clients,
      COALESCE(delivered_preview.delivered_clients_count, 0) AS delivered_clients_count`)}
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(JSONB_AGG(TO_JSONB(dc) ORDER BY dc.delivery_note_date DESC, dc.delivery_note_reference DESC NULLS LAST), '[]'::jsonb) AS delivered_clients,
          COUNT(*)::int AS delivered_clients_count
        FROM (${deliveredClientsSql('sla.lot_id = l.id', 'LIMIT 5')}) dc
      ) delivered_preview ON true
      ${where}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

    res.json(result.rows.map(mapLot));
  } catch (err) {
    console.error('Erreur GET /api/traceability/lots :', err);
    res.status(500).json({ error: 'Erreur serveur traçabilité lots' });
  }
});

router.get('/lots/:lotId', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const lotId = clean(req.params.lotId);
    if (!lotId || !isUuid(lotId)) return res.status(400).json({ error: 'ID lot invalide' });

    const lotResult = await req.dbPool.query(
      `
      ${lotSelectSql()}
      WHERE l.store_id = $1
        AND l.id = $2
      LIMIT 1
      `,
      [req.user.store_id, lotId]
    );

    if (!lotResult.rows.length) return res.status(404).json({ error: 'Lot introuvable' });

    const movementsResult = await req.dbPool.query(
      `
      SELECT
        sm.id,
        sm.movement_type,
        sm.quantity,
        sm.unit_cost_ex_vat,
        sm.source_table,
        sm.source_id,
        sm.notes,
        sm.created_at
      FROM stock_movements sm
      WHERE sm.store_id = $1
        AND sm.lot_id = $2
      ORDER BY sm.created_at ASC, sm.id ASC
      `,
      [req.user.store_id, lotId]
    );

    const deliveredResult = await req.dbPool.query(
      `
      SELECT *
      FROM (${deliveredClientsSql('sla.lot_id = $2', '')}) delivered_clients
      `,
      [req.user.store_id, lotId]
    );

    const historyResult = await req.dbPool.query(
      `
      SELECT
        h.id,
        h.previous_status,
        h.new_status,
        h.reason_type,
        h.reason,
        h.comment,
        h.source_type,
        h.source_id,
        h.quality_non_conformity_id,
        h.changed_by,
        u.email AS changed_by_email,
        h.changed_at,
        qnc.title AS quality_non_conformity_title,
        qnc.status AS quality_non_conformity_status
      FROM quality_lot_status_history h
      LEFT JOIN users u ON u.id = h.changed_by
      LEFT JOIN quality_non_conformities qnc ON qnc.id = h.quality_non_conformity_id AND qnc.store_id = h.store_id
      WHERE h.store_id = $1
        AND h.lot_id = $2
      ORDER BY h.changed_at DESC, h.id DESC
      LIMIT 100
      `,
      [req.user.store_id, lotId]
    );

    const packingTrace = await fetchPackingTrace(req.dbPool, req.user.store_id, lotId);

    const lot = mapLot({ ...lotResult.rows[0], delivered_clients: deliveredResult.rows, delivered_clients_count: deliveredResult.rows.length });
    const movements = movementsResult.rows.map((movement) => ({
      id: movement.id,
      movement_type: movement.movement_type,
      movement_label: movementLabel(movement.movement_type),
      quantity: Number(movement.quantity || 0),
      unit_cost_ex_vat: Number(movement.unit_cost_ex_vat || 0),
      source_table: movement.source_table,
      source_id: movement.source_id,
      notes: movement.notes,
      created_at: movement.created_at,
    }));

    res.json({
      lot,
      movements,
      packing_trace: packingTrace,
      quality_history: historyResult.rows,
      fifo_consumption: lot.delivered_clients,
    });
  } catch (err) {
    console.error('Erreur GET /api/traceability/lots/:lotId :', err);
    res.status(500).json({ error: 'Erreur serveur détail lot' });
  }
});

router.get('/lots/:lotId/recall-analysis', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const lotId = clean(req.params.lotId);
    const result = await analyzeLotRecallImpact({
      db: req.dbPool,
      storeId: req.user.store_id,
      lotId,
    });
    return res.json(result);
  } catch (err) {
    console.error('Erreur GET /api/traceability/lots/:lotId/recall-analysis :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur analyse retrait/rappel lot'));
  }
});

router.get('/traceability-tests/lots', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await searchTraceabilityTestLots({
      db: req.dbPool,
      storeId: req.user.store_id,
      search: req.query.search,
      limit: req.query.limit,
    });
    return res.json(result);
  } catch (err) {
    console.error('Erreur GET /api/traceability/traceability-tests/lots :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur recherche lots test tracabilite'));
  }
});

router.get('/lots/:lotId/traceability-test', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const lotId = clean(req.params.lotId);
    const result = await buildTraceabilityTestSnapshot({
      db: req.dbPool,
      storeId: req.user.store_id,
      lotId,
    });
    return res.json({
      ...result,
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Erreur GET /api/traceability/lots/:lotId/traceability-test :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur preparation test tracabilite'));
  }
});

router.post('/lots/:lotId/traceability-test', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const lotId = clean(req.params.lotId);
    await client.query('BEGIN');
    const result = await completeTraceabilityTest({
      db: client,
      storeId: req.user.store_id,
      lotId,
      userId: req.user.id,
      result: req.body?.result,
      observation: req.body?.observation,
      correctiveAction: req.body?.corrective_action,
      startedAt: req.body?.started_at,
    });
    await client.query('COMMIT');
    return res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/traceability/lots/:lotId/traceability-test :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur validation test tracabilite'));
  } finally {
    client.release();
  }
});

router.get('/recalls/:campaignId', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const campaignId = clean(req.params.campaignId);
    const result = await getProductRecallCampaign({
      db: req.dbPool,
      storeId: req.user.store_id,
      campaignId,
    });
    return res.json(result);
  } catch (err) {
    console.error('Erreur GET /api/traceability/recalls/:campaignId :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur lecture rappel produit'));
  }
});

router.post('/lots/:lotId/recall', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const lotId = clean(req.params.lotId);
    await client.query('BEGIN');
    const result = await createProductRecallDraft({
      db: client,
      storeId: req.user.store_id,
      lotId,
      userId: req.user.id,
      recallType: req.body.recall_type,
      reason: req.body.reason,
      comment: req.body.comment,
    });
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/traceability/lots/:lotId/recall :', err);
    if (err.code === 'PRODUCT_RECALL_ACTIVE_EXISTS' && err.needsActiveCampaignLookup) {
      const existing = await getActiveCampaign(req.dbPool, req.user.store_id, clean(req.params.lotId)).catch(() => null);
      if (existing) {
        err.details = {
          campaign_id: existing.id,
          status: existing.status,
        };
      }
    }
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur creation campagne retrait/rappel'));
  } finally {
    client.release();
  }
});

router.post('/recalls/:campaignId/send', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const campaignId = clean(req.params.campaignId);
    const recipientIds = Array.isArray(req.body?.recipient_ids)
      ? req.body.recipient_ids.filter(Boolean)
      : [];
    const result = await sendProductRecallNotifications({
      db: req.dbPool,
      storeId: req.user.store_id,
      campaignId,
      recipientIds,
      userId: req.user.id,
    });
    return res.json(result);
  } catch (err) {
    console.error('Erreur POST /api/traceability/recalls/:campaignId/send :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur envoi notifications rappel produit'));
  }
});

router.post('/lots/:lotId/block-quality', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const lotId = clean(req.params.lotId);
    const reasonType = clean(req.body.reason_type);
    const reason = clean(req.body.reason);
    const comment = clean(req.body.comment);
    const qualityNonConformityId = clean(req.body.quality_non_conformity_id);
    if (!lotId || !isUuid(lotId)) return res.status(400).json({ error: 'ID lot invalide' });
    if (!QUALITY_BLOCK_REASON_TYPES.has(reasonType)) return res.status(400).json({ error: 'Type de blocage invalide' });
    if (!reason) return res.status(400).json({ error: 'Motif de blocage obligatoire' });
    if (reasonType === 'other' && !comment) return res.status(400).json({ error: 'Commentaire obligatoire pour un blocage autre' });
    if (qualityNonConformityId && !isUuid(qualityNonConformityId)) return res.status(400).json({ error: 'ID non-conformite invalide' });

    await client.query('BEGIN');
    const result = await blockLotForQuality(client, {
      storeId: req.user.store_id,
      lotId,
      userId: req.user.id,
      reason,
      reasonType,
      comment,
      sourceType: 'traceability_manual',
      sourceId: lotId,
      qualityNonConformityId,
    });
    await client.query('COMMIT');
    return res.json({ ok: true, lot: mapLot({ ...result.lot, lot_id: result.lot.id }), history: result.history });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/traceability/lots/:lotId/block-quality :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur blocage qualite lot'));
  } finally {
    client.release();
  }
});

router.post('/lots/:lotId/release-quality', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const lotId = clean(req.params.lotId);
    const reason = clean(req.body.reason);
    const comment = clean(req.body.comment);
    if (!lotId || !isUuid(lotId)) return res.status(400).json({ error: 'ID lot invalide' });

    await client.query('BEGIN');
    const result = await releaseLotForQuality(client, {
      storeId: req.user.store_id,
      lotId,
      userId: req.user.id,
      reason,
      comment,
      sourceType: 'traceability_manual_release',
      sourceId: lotId,
    });
    await client.query('COMMIT');
    return res.json({ ok: true, lot: mapLot({ ...result.lot, lot_id: result.lot.id }), history: result.history });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/traceability/lots/:lotId/release-quality :', err);
    return res.status(err.status || 500).json(lotQualityErrorBody(err, 'Erreur liberation qualite lot'));
  } finally {
    client.release();
  }
});

module.exports = router;
