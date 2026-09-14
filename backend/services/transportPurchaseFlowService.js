const purchaseReceiptStockSync = require('./purchaseReceiptStockSync');

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  return Math.round((number(value, 0) + Number.EPSILON) * 100) / 100;
}

function round(value, precision = 4) {
  const parsed = number(value, NaN);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(precision)) : null;
}

function component(code, label, amount, meta = {}) {
  return {
    code,
    label,
    amount_ht: money(amount),
    meta,
  };
}

function buildTransportPurchaseComponents(deliveryNote = {}) {
  const snapshot = deliveryNote.calculation_snapshot || {};
  const components = [];

  components.push(component('base_transport', 'Transport HT', deliveryNote.transport_amount_ht, {
    legs: Array.isArray(snapshot.legs) ? snapshot.legs : [],
  }));

  if (number(deliveryNote.fuel_amount_ht, 0) > 0) {
    components.push(component('fuel_surcharge', 'Surcharge carburant', deliveryNote.fuel_amount_ht, {
      base_transport_ht: money(deliveryNote.transport_amount_ht),
    }));
  }

  if (number(deliveryNote.admin_fee_ht, 0) > 0) {
    components.push(component('admin_fee', 'Frais administratifs transport', deliveryNote.admin_fee_ht, {
      admin_fees: Array.isArray(snapshot.admin_fees) ? snapshot.admin_fees : [],
    }));
  }

  const services = Array.isArray(snapshot.services) ? snapshot.services : [];
  if (services.length) {
    for (const service of services) {
      const label = service.label ? `Prestation logistique - ${service.label}` : 'Prestation logistique';
      components.push(component('logistics_service', label, service.total_ht, { service }));
    }
  } else if (number(deliveryNote.services_amount_ht, 0) > 0) {
    components.push(component('logistics_service', 'Prestations logistiques', deliveryNote.services_amount_ht));
  }

  return components.filter((item) => item.amount_ht > 0);
}

function buildTransportPurchaseLine(item = {}) {
  const amount = money(item.amount_ht);
  return {
    article_id: null,
    supplier_reference: item.code,
    supplier_label: item.label,
    ordered_colis: null,
    ordered_pieces: 1,
    ordered_quantity: 0,
    received_colis: null,
    received_pieces: 1,
    received_quantity: 0,
    stock_quantity: 0,
    unit_price_ex_vat: amount,
    line_amount_ex_vat: amount,
    price_unit: 'piece',
    line_status: 'received',
  };
}

function realTransportUnitCost(deliveryNote = {}) {
  const total = number(deliveryNote.expected_total_ht, 0);
  const weight = number(deliveryNote.total_weight_kg, 0);
  return weight > 0 ? round(total / weight, 4) : null;
}

function allocateTransportAmountByWeight(lines = [], totalAmountHt = 0) {
  const eligible = (lines || [])
    .map((line, index) => ({
      ...line,
      index,
      weight_kg: round(number(line.weight_kg, 0), 3),
    }))
    .filter((line) => number(line.weight_kg, 0) > 0);
  const totalAllocableWeight = eligible.reduce((sum, line) => sum + number(line.weight_kg, 0), 0);
  const total = round(totalAmountHt, 4);

  if (!eligible.length || totalAllocableWeight <= 0 || !total || total <= 0) return [];

  const allocations = eligible.map((line) => {
    const allocatedAmount = round((total * number(line.weight_kg, 0)) / totalAllocableWeight, 4);
    return {
      ...line,
      allocated_amount_ht: allocatedAmount,
      unit_transport_cost_ht: round(allocatedAmount / number(line.weight_kg, 0), 4),
    };
  });

  const allocatedTotal = allocations.reduce((sum, line) => sum + number(line.allocated_amount_ht, 0), 0);
  const remainder = round(total - allocatedTotal, 4);
  if (remainder) {
    const target = allocations.reduce((best, line) => {
      const bestWeight = number(best.weight_kg, 0);
      const lineWeight = number(line.weight_kg, 0);
      if (lineWeight > bestWeight) return line;
      if (lineWeight === bestWeight && line.index > best.index) return line;
      return best;
    }, allocations[0]);
    target.allocated_amount_ht = round(number(target.allocated_amount_ht, 0) + remainder, 4);
    target.unit_transport_cost_ht = round(number(target.allocated_amount_ht, 0) / number(target.weight_kg, 0), 4);
  }

  return allocations;
}

function isTransportPurchaseLocked(purchase = {}) {
  return purchaseReceiptStockSync.isAccountingLockedPurchaseStatus(purchase.status)
    || ['closed', 'cancelled'].includes(String(purchase.status || ''));
}

async function hasLinkedSupplierInvoice(db, storeId, purchaseId) {
  const checks = [
    {
      sql: `SELECT 1
            FROM supplier_invoice_matches sim
            JOIN supplier_invoices si ON si.id = sim.supplier_invoice_id
            WHERE sim.store_id = $1
              AND sim.purchase_id = $2
              AND COALESCE(si.status, '') <> 'cancelled'
            LIMIT 1`,
    },
    {
      sql: `SELECT 1
            FROM supplier_invoice_documents sid
            LEFT JOIN supplier_invoices si ON si.id = sid.supplier_invoice_id
            WHERE sid.store_id = $1
              AND sid.purchase_id = $2
              AND COALESCE(si.status, '') <> 'cancelled'
            LIMIT 1`,
    },
  ];

  for (const check of checks) {
    try {
      const result = await db.query(check.sql, [storeId, purchaseId]);
      if (result.rows.length) return true;
    } catch (error) {
      if (!['42P01', '42703'].includes(error.code)) throw error;
    }
  }
  return false;
}

async function insertShipmentDocumentPurchaseLink(db, {
  storeId,
  shipmentId,
  purchaseId,
  supplierId,
  documentReference,
  weightKg,
}) {
  return db.query(
    `INSERT INTO transport_shipment_documents (
      store_id, shipment_id, purchase_id, supplier_id, document_reference, weight_kg
    )
    SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::numeric
    WHERE $2::uuid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM transport_shipment_documents
        WHERE store_id = $1::uuid
          AND shipment_id = $2::uuid
          AND purchase_id = $3::uuid
      )`,
    [storeId, shipmentId, purchaseId, supplierId, documentReference, weightKg]
  );
}

async function loadTransportDeliveryNote(db, storeId, deliveryNoteId) {
  const result = await db.query(
    `SELECT tdn.*, s.name AS carrier_name
     FROM transport_delivery_notes tdn
     LEFT JOIN suppliers s ON s.id = tdn.carrier_id AND s.store_id = tdn.store_id
     WHERE tdn.id = $1 AND tdn.store_id = $2
     FOR UPDATE OF tdn`,
    [deliveryNoteId, storeId]
  );
  return result.rows[0] || null;
}

async function findLinkedPurchase(db, storeId, deliveryNote) {
  if (deliveryNote.purchase_id) {
    const direct = await db.query(
      `SELECT * FROM purchases WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [deliveryNote.purchase_id, storeId]
    );
    if (direct.rows[0]) return direct.rows[0];
  }

  const linked = await db.query(
    `SELECT *
     FROM purchases
     WHERE store_id = $1
       AND transport_delivery_note_id = $2
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE`,
    [storeId, deliveryNote.id]
  );
  return linked.rows[0] || null;
}

async function upsertTransportPurchase(db, storeId, deliveryNoteId, context = {}) {
  const deliveryNote = await loadTransportDeliveryNote(db, storeId, deliveryNoteId);
  if (!deliveryNote) {
    const error = new Error('BL transport introuvable');
    error.status = 404;
    throw error;
  }
  if (!deliveryNote.carrier_id) {
    const error = new Error('Transporteur obligatoire pour creer l achat transport');
    error.status = 400;
    throw error;
  }

  const components = buildTransportPurchaseComponents(deliveryNote);
  const unitCost = realTransportUnitCost(deliveryNote);
  let purchase = await findLinkedPurchase(db, storeId, deliveryNote);

  if (purchase && (isTransportPurchaseLocked(purchase) || await hasLinkedSupplierInvoice(db, storeId, purchase.id))) {
    const error = new Error('Achat transport deja facture ou verrouille');
    error.status = 409;
    throw error;
  }

  const sourcePayload = {
    transport_delivery_note_id: deliveryNote.id,
    transport_shipment_id: deliveryNote.shipment_id,
    reference_number: deliveryNote.reference_number,
    total_weight_kg: number(deliveryNote.total_weight_kg, 0),
    real_transport_cost_per_kg_ht: unitCost,
    cost_breakdown: {
      transport_amount_ht: money(deliveryNote.transport_amount_ht),
      fuel_amount_ht: money(deliveryNote.fuel_amount_ht),
      admin_fee_ht: money(deliveryNote.admin_fee_ht),
      services_amount_ht: money(deliveryNote.services_amount_ht),
      total_ht: money(deliveryNote.expected_total_ht),
    },
  };

  if (!purchase) {
    const created = await db.query(
      `INSERT INTO purchases (
        id, store_id, client_key, supplier_id, purchase_date, status, purchase_type, order_date, receipt_date,
        bl_number, notes, total_amount_ex_vat, transport_delivery_note_id, transport_shipment_id,
        source_kind, source_reference, source_payload, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, NULL, $2, $3::date, 'received_pending_invoice', 'direct_bl', $3::date, $3::date,
        $4, $5, $6, $7, $8, 'transport_delivery_note', $4, $9::jsonb, $10, $10
      ) RETURNING *`,
      [
        storeId,
        deliveryNote.carrier_id,
        deliveryNote.document_date,
        deliveryNote.reference_number,
        `Achat transport genere depuis BLT ${deliveryNote.reference_number || deliveryNote.id}`,
        money(deliveryNote.expected_total_ht),
        deliveryNote.id,
        deliveryNote.shipment_id,
        JSON.stringify(sourcePayload),
        context.user_id || null,
      ]
    );
    purchase = created.rows[0];
  } else {
    const updated = await db.query(
      `UPDATE purchases
       SET supplier_id = $3,
           purchase_date = $4::date,
           order_date = $4::date,
           receipt_date = $4::date,
           bl_number = $5,
           notes = $6,
           total_amount_ex_vat = $7,
           transport_delivery_note_id = $8,
           transport_shipment_id = $9,
           source_kind = 'transport_delivery_note',
           source_reference = $5,
           source_payload = $10::jsonb,
           updated_by = $11,
           updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [
        purchase.id,
        storeId,
        deliveryNote.carrier_id,
        deliveryNote.document_date,
        deliveryNote.reference_number,
        `Achat transport genere depuis BLT ${deliveryNote.reference_number || deliveryNote.id}`,
        money(deliveryNote.expected_total_ht),
        deliveryNote.id,
        deliveryNote.shipment_id,
        JSON.stringify(sourcePayload),
        context.user_id || null,
      ]
    );
    purchase = updated.rows[0];
    await db.query('DELETE FROM purchase_lines WHERE purchase_id = $1 AND store_id = $2', [purchase.id, storeId]);
  }

  let lineNumber = 1;
  for (const item of components) {
    const purchaseLine = buildTransportPurchaseLine(item);
    const line = await db.query(
      `INSERT INTO purchase_lines (
        id, purchase_id, store_id, client_key, supplier_id, line_number, article_id,
        supplier_reference, supplier_label, ordered_colis, ordered_pieces, ordered_quantity,
        received_colis, received_pieces, received_quantity, stock_quantity,
        unit_price_ex_vat, line_amount_ex_vat, price_unit, line_status
      ) VALUES (
        gen_random_uuid(), $1, $2, NULL, $3, $4, NULL,
        $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'piece', 'received'
      ) RETURNING id`,
      [
        purchase.id,
        storeId,
        deliveryNote.carrier_id,
        lineNumber,
        purchaseLine.supplier_reference,
        purchaseLine.supplier_label,
        purchaseLine.ordered_colis,
        purchaseLine.ordered_pieces,
        purchaseLine.ordered_quantity,
        purchaseLine.received_colis,
        purchaseLine.received_pieces,
        purchaseLine.received_quantity,
        purchaseLine.stock_quantity,
        purchaseLine.unit_price_ex_vat,
        purchaseLine.line_amount_ex_vat,
      ]
    );
    await db.query(
      `INSERT INTO purchase_line_metadata (id, purchase_line_id, meta_key, meta_value)
       VALUES (gen_random_uuid(), $1, 'transport_component', $2::jsonb)
       ON CONFLICT (purchase_line_id, meta_key)
       DO UPDATE SET meta_value = EXCLUDED.meta_value, updated_at = now()`,
      [line.rows[0].id, JSON.stringify({ ...item.meta, component_code: item.code, amount_ht: item.amount_ht })]
    );
    lineNumber += 1;
  }

  await db.query(
    `UPDATE transport_delivery_notes
     SET purchase_id = $3,
         real_transport_cost_per_kg_ht = $4,
         updated_by = $5,
         updated_at = now()
     WHERE id = $1 AND store_id = $2`,
    [deliveryNote.id, storeId, purchase.id, unitCost, context.user_id || null]
  );

  await insertShipmentDocumentPurchaseLink(db, {
    storeId,
    shipmentId: deliveryNote.shipment_id,
    purchaseId: purchase.id,
    supplierId: deliveryNote.carrier_id,
    documentReference: deliveryNote.reference_number,
    weightKg: number(deliveryNote.total_weight_kg, 0),
  });

  await rebuildTransportCostAllocations(db, storeId, deliveryNote.id);
  return { delivery_note_id: deliveryNote.id, purchase_id: purchase.id, unit_transport_cost_ht: unitCost };
}

async function rebuildTransportCostAllocations(db, storeId, deliveryNoteId) {
  const deliveryNote = await loadTransportDeliveryNote(db, storeId, deliveryNoteId);
  if (!deliveryNote) return { allocated_line_count: 0 };
  const totalTransportHt = round(deliveryNote.expected_total_ht, 4);
  if (!totalTransportHt || totalTransportHt <= 0) return { allocated_line_count: 0 };

  await db.query(
    'DELETE FROM transport_cost_allocations WHERE store_id = $1 AND transport_delivery_note_id = $2',
    [storeId, deliveryNote.id]
  );

  const purchaseLines = await db.query(
    `SELECT pl.id, pl.purchase_id,
            COALESCE(NULLIF(pl.received_quantity, 0), NULLIF(pl.ordered_quantity, 0), 0) AS weight_kg
     FROM transport_shipment_documents tsd
     JOIN purchase_lines pl ON pl.purchase_id = tsd.purchase_id AND pl.store_id = tsd.store_id
     WHERE tsd.store_id = $1
       AND tsd.shipment_id = $2
       AND tsd.purchase_id IS NOT NULL
       AND tsd.purchase_id IS DISTINCT FROM $3
       AND pl.article_id IS NOT NULL
       AND COALESCE(pl.line_status, '') <> 'cancelled'`,
    [storeId, deliveryNote.shipment_id, deliveryNote.purchase_id]
  );

  const salesLines = await db.query(
    `SELECT sl.id, sl.sales_document_id,
            COALESCE(NULLIF(sl.total_weight, 0), NULLIF(sl.sold_quantity, 0), 0) AS weight_kg
     FROM transport_shipment_documents tsd
     JOIN sales_lines sl ON sl.sales_document_id = tsd.sales_document_id AND sl.store_id = tsd.store_id
     WHERE tsd.store_id = $1
       AND tsd.shipment_id = $2
       AND tsd.sales_document_id IS NOT NULL
       AND COALESCE(sl.line_status, '') <> 'cancelled'`,
    [storeId, deliveryNote.shipment_id]
  );

  const purchaseAllocations = allocateTransportAmountByWeight(purchaseLines.rows, totalTransportHt);
  const salesAllocations = allocateTransportAmountByWeight(salesLines.rows, totalTransportHt);

  let count = 0;
  for (const line of purchaseAllocations) {
    await db.query(
      `INSERT INTO transport_cost_allocations (
        store_id, transport_delivery_note_id, transport_purchase_id, target_purchase_id,
        target_purchase_line_id, allocation_scope, allocated_weight_kg, allocated_amount_ht, unit_transport_cost_ht
      ) VALUES ($1,$2,$3,$4,$5,'purchase_line',$6,$7,$8)
      ON CONFLICT (transport_delivery_note_id, target_purchase_line_id)
      WHERE target_purchase_line_id IS NOT NULL
      DO UPDATE SET allocated_weight_kg = EXCLUDED.allocated_weight_kg,
                    allocated_amount_ht = EXCLUDED.allocated_amount_ht,
                    unit_transport_cost_ht = EXCLUDED.unit_transport_cost_ht`,
      [
        storeId,
        deliveryNote.id,
        deliveryNote.purchase_id,
        line.purchase_id,
        line.id,
        line.weight_kg,
        line.allocated_amount_ht,
        line.unit_transport_cost_ht,
      ]
    );
    count += 1;
  }

  for (const line of salesAllocations) {
    await db.query(
      `INSERT INTO transport_cost_allocations (
        store_id, transport_delivery_note_id, transport_purchase_id, target_sales_document_id,
        target_sales_line_id, allocation_scope, allocated_weight_kg, allocated_amount_ht, unit_transport_cost_ht
      ) VALUES ($1,$2,$3,$4,$5,'sales_line',$6,$7,$8)
      ON CONFLICT (transport_delivery_note_id, target_sales_line_id)
      WHERE target_sales_line_id IS NOT NULL
      DO UPDATE SET allocated_weight_kg = EXCLUDED.allocated_weight_kg,
                    allocated_amount_ht = EXCLUDED.allocated_amount_ht,
                    unit_transport_cost_ht = EXCLUDED.unit_transport_cost_ht`,
      [
        storeId,
        deliveryNote.id,
        deliveryNote.purchase_id,
        line.sales_document_id,
        line.id,
        line.weight_kg,
        line.allocated_amount_ht,
        line.unit_transport_cost_ht,
      ]
    );
    count += 1;
  }

  return { allocated_line_count: count };
}

module.exports = {
  allocateTransportAmountByWeight,
  buildTransportPurchaseLine,
  buildTransportPurchaseComponents,
  hasLinkedSupplierInvoice,
  insertShipmentDocumentPurchaseLink,
  isTransportPurchaseLocked,
  realTransportUnitCost,
  rebuildTransportCostAllocations,
  upsertTransportPurchase,
};
