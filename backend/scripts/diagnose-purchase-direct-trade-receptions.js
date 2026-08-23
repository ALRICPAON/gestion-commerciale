const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function intValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  const storeId = argValue('store-id') || process.env.ALTA_STORE_ID || process.env.STORE_ID;
  if (!storeId) throw new Error('--store-id ou ALTA_STORE_ID requis');

  const db = getDefaultPool();
  const result = await db.query(
    `WITH purchase_lots AS (
       SELECT
         p.id AS purchase_id,
         p.bl_number,
         p.receipt_date,
         p.supplier_id,
         s.name AS supplier_name,
         l.id AS lot_id,
         l.lot_code,
         l.supplier_lot_number
       FROM purchases p
       JOIN lots l ON l.purchase_id = p.id AND l.store_id = p.store_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
       WHERE p.store_id = $1::uuid
         AND p.status IN ('received', 'received_pending_invoice', 'invoice_matched', 'invoice_difference', 'invoice_validated', 'cost_adjusted', 'sent_pennylane', 'closed')
     ),
     downstream AS (
       SELECT
         pl.purchase_id,
         COUNT(DISTINCT sd.id)::int AS delivery_note_count,
         COUNT(DISTINCT COALESCE(sl.delivered_client_id, sd.client_id))::int AS delivered_client_count,
         BOOL_OR(LOWER(COALESCE(sd.origin, '')) = 'negoce') AS has_negoce_sale,
         JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
           'delivery_note_id', sd.id,
           'reference_number', sd.reference_number,
           'origin', sd.origin,
           'delivered_client_id', COALESCE(sl.delivered_client_id, sd.client_id),
           'delivered_client_name', COALESCE(sl.delivered_client_name_snapshot, sd.delivered_client_name_snapshot, c.name)
         )) FILTER (WHERE sd.id IS NOT NULL) AS delivered_clients
       FROM purchase_lots pl
       LEFT JOIN sale_line_allocations sla ON sla.lot_id = pl.lot_id
       LEFT JOIN sales_lines sl ON sl.id = sla.sales_line_id AND sl.store_id = $1::uuid
       LEFT JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = $1::uuid
       LEFT JOIN clients c ON c.id = COALESCE(sl.delivered_client_id, sd.client_id) AND c.store_id = $1::uuid
       GROUP BY pl.purchase_id
     ),
     evidence AS (
       SELECT
         qer.source_record_id AS purchase_id,
         qer.id AS evidence_id,
         qer.payload,
         qer.payload #>> '{controls,overall_status}' AS overall_status,
         qer.payload #>> '{controls,temperature,status}' AS temperature_status,
         qer.payload #>> '{controls,freshness,status}' AS freshness_status,
         qer.payload #>> '{controls,packaging,status}' AS packaging_status,
         qer.payload #>> '{controls,label_conformity,status}' AS label_status
       FROM quality_evidence_records qer
       WHERE qer.store_id = $1::uuid
         AND qer.evidence_type = 'reception_record'
         AND qer.source_record_type = 'purchases'
         AND qer.archived_at IS NULL
     ),
     candidates AS (
       SELECT
         pl.purchase_id,
         MIN(pl.bl_number) AS bl_number,
         MIN(pl.receipt_date) AS receipt_date,
         MIN(pl.supplier_name) AS supplier_name,
         COUNT(DISTINCT pl.lot_id)::int AS lot_count,
         COALESCE(d.delivery_note_count, 0) AS delivery_note_count,
         COALESCE(d.delivered_client_count, 0) AS delivered_client_count,
         COALESCE(d.has_negoce_sale, false) AS has_negoce_sale,
         d.delivered_clients,
         e.evidence_id,
         e.overall_status,
         e.temperature_status,
         e.freshness_status,
         e.packaging_status,
         e.label_status,
         (
           e.overall_status = 'conform'
           OR e.temperature_status = 'conform'
           OR e.freshness_status = 'conform'
           OR e.packaging_status = 'conform'
           OR e.label_status = 'conform'
         ) AS has_conform_physical_controls
       FROM purchase_lots pl
       LEFT JOIN downstream d ON d.purchase_id = pl.purchase_id
       LEFT JOIN evidence e ON e.purchase_id = pl.purchase_id
       GROUP BY
         pl.purchase_id,
         d.delivery_note_count,
         d.delivered_client_count,
         d.has_negoce_sale,
         d.delivered_clients,
         e.evidence_id,
         e.overall_status,
         e.temperature_status,
         e.freshness_status,
         e.packaging_status,
         e.label_status
     )
     SELECT
       COUNT(*)::int AS received_purchase_count,
       COUNT(*) FILTER (WHERE has_negoce_sale)::int AS probable_direct_trade_count,
       COUNT(*) FILTER (WHERE has_negoce_sale AND has_conform_physical_controls)::int AS probable_direct_trade_with_conform_controls_count,
       COUNT(*) FILTER (WHERE evidence_id IS NULL)::int AS missing_reception_record_count,
       COALESCE(JSONB_AGG(
         JSONB_BUILD_OBJECT(
           'purchase_id', purchase_id,
           'bl_number', bl_number,
           'receipt_date', receipt_date,
           'supplier_name', supplier_name,
           'lot_count', lot_count,
           'delivery_note_count', delivery_note_count,
           'delivered_client_count', delivered_client_count,
           'has_negoce_sale', has_negoce_sale,
           'has_conform_physical_controls', has_conform_physical_controls,
           'overall_status', overall_status,
           'temperature_status', temperature_status,
           'freshness_status', freshness_status,
           'packaging_status', packaging_status,
           'label_status', label_status,
           'delivered_clients', COALESCE(delivered_clients, '[]'::jsonb)
         )
         ORDER BY receipt_date DESC NULLS LAST, purchase_id
       ) FILTER (WHERE has_negoce_sale), '[]'::jsonb) AS probable_direct_trade_samples
     FROM candidates`,
    [storeId]
  );

  const row = result.rows[0] || {};
  console.log(JSON.stringify({
    ok: true,
    mode: 'read_only',
    store_id: storeId,
    received_purchase_count: intValue(row.received_purchase_count),
    probable_direct_trade_count: intValue(row.probable_direct_trade_count),
    probable_direct_trade_with_conform_controls_count: intValue(row.probable_direct_trade_with_conform_controls_count),
    missing_reception_record_count: intValue(row.missing_reception_record_count),
    probable_direct_trade_samples: row.probable_direct_trade_samples || [],
    rule: 'Diagnostic uniquement: aucune correction historique, aucune modification de lots, achats, ventes ou preuves.',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(() => closeAllPools());
