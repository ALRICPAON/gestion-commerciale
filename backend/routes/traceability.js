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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
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
      ${lotStatusSql()} AS status
      ${extraColumns}
    FROM lots l
    JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
    LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
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
  };
}

router.get('/clients', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const search = clean(req.query.search);
    const params = [req.user.store_id];
    let where = 'WHERE c.store_id = $1 AND c.status <> \'inactive\'';

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
    let where = 'WHERE l.store_id = $1';

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
      fifo_consumption: lot.delivered_clients,
    });
  } catch (err) {
    console.error('Erreur GET /api/traceability/lots/:lotId :', err);
    res.status(500).json({ error: 'Erreur serveur détail lot' });
  }
});

module.exports = router;
