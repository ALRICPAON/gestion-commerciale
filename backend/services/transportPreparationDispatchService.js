const { renderSaleOrderPdf, saleOrderFilename } = require('./pdf/templates/saleOrderPdfTemplate');
const transport = require('./transportService');
const { displaySalesDocumentReference } = require('./salesReferenceService');

const MISSING = 'A completer';
const QUIET_MISSING = '-';
const UNKNOWN_SUPPLIER = 'Fournisseur non determine';
const DELIVERY_MODE = 'LIVRAISON';
const DOCK_PICKUP_MODE = 'PRISE A QUAI DELANCHY';

function clean(value) {
  return transport.clean(value);
}

function isoDate(value) {
  return transport.isoDate(value);
}

function normalizeText(value) {
  return clean(value) || '';
}

function normalizeKey(value) {
  return transport.normalizeKey ? transport.normalizeKey(value) : normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function businessReference(value, fallback = '') {
  const cleaned = clean(value);
  if (!cleaned || isUuid(cleaned)) return fallback;
  return cleaned;
}

function sumKnown(rows, fields) {
  const values = rows
    .map((row) => fields.map((field) => num(row[field])).find((value) => value !== null && value > 0))
    .filter((value) => value !== undefined);
  return {
    value: values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(3)) : null,
    hasMissing: values.length !== rows.length,
  };
}

function formatDateFr(value) {
  const day = isoDate(value);
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

function formatQuantity(value, suffix) {
  const parsed = num(value);
  if (parsed === null || parsed <= 0) return MISSING;
  return `${parsed.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${suffix}`;
}

function formatQuietQuantity(value, suffix) {
  const parsed = num(value);
  if (parsed === null || parsed <= 0) return QUIET_MISSING;
  return `${parsed.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${suffix}`;
}

function resolveCarrierEmail(carrier = {}) {
  return clean(carrier.transport_operations_email) || clean(carrier.email);
}

function isPreparationService(service = {}) {
  if (transport.isPreparationLogisticsService) return transport.isPreparationLogisticsService(service);
  const label = normalizeKey(service.label);
  return /\bprepa\b/.test(label) || /\bpreparation\b/.test(label);
}

function deliveryModeForClient(client = {}) {
  return client.delanchy_dock_pickup === true ? DOCK_PICKUP_MODE : DELIVERY_MODE;
}

function lineStatus(item = {}) {
  return item.missing?.length ? 'informations incompletes' : 'pret a envoyer';
}

function formatAnnouncementLine(item = {}) {
  return [
    clean(item.origin_label) || MISSING,
    clean(item.site_code) || MISSING,
    clean(item.supplier_name) || MISSING,
    formatQuantity(item.weight_kg, 'kg'),
    formatQuantity(item.package_count, 'colis'),
    item.date ? formatDateFr(item.date) : MISSING,
    clean(item.reference) || MISSING,
    clean(item.client_name) || MISSING,
    clean(item.delivery_mode) || DELIVERY_MODE,
  ].join(' | ');
}

function formatSupplierArrivalAnnouncementLine(item = {}) {
  return [
    clean(item.origin_label) || QUIET_MISSING,
    clean(item.site_code) || QUIET_MISSING,
    clean(item.supplier_name) || QUIET_MISSING,
    formatQuietQuantity(item.weight_kg, 'kg'),
    formatQuietQuantity(item.package_count, 'colis'),
    item.date ? formatDateFr(item.date) : QUIET_MISSING,
  ].join(' | ');
}

function supplierNameFromLine(line = {}) {
  const source = parseJson(line.source_inventory_line, {});
  const trace = parseJson(line.traceability_snapshot, {});
  return clean(line.supplier_name)
    || clean(line.allocation_supplier_name)
    || clean(line.selected_lot_supplier_name)
    || clean(line.suggested_lot_supplier_name)
    || clean(source.supplier_name)
    || clean(source.supplier)
    || clean(trace.supplier_name)
    || clean(trace.supplier)
    || UNKNOWN_SUPPLIER;
}

function buildPreparationSupplierBlocks(lines = []) {
  const groups = new Map();
  for (const line of lines) {
    const supplierName = supplierNameFromLine(line);
    if (!groups.has(supplierName)) groups.set(supplierName, []);
    groups.get(supplierName).push({ ...line, supplier_name: supplierName });
  }
  return Array.from(groups.entries()).map(([supplierName, supplierLines]) => {
    const packages = sumKnown(supplierLines, ['package_count']);
    const weight = sumKnown(supplierLines, ['total_weight', 'sold_quantity']);
    return {
      supplier_name: supplierName,
      package_count: packages.value,
      package_count_partial: packages.hasMissing,
      weight_kg: weight.value,
      weight_partial: weight.hasMissing,
      lines: supplierLines,
    };
  });
}

function buildClientRecap({ sale = {}, lines = [], deliveryMode = null }) {
  const packages = sumKnown(lines, ['package_count']);
  const weight = sumKnown(lines, ['total_weight', 'sold_quantity']);
  return {
    client_name: sale.client_name || sale.delivered_client_name_snapshot || '-',
    package_count: packages.value,
    package_count_partial: packages.hasMissing,
    weight_kg: weight.value,
    weight_partial: weight.hasMissing,
    delivery_mode: deliveryMode || deliveryModeForClient(sale),
  };
}

function decorateDispatchItem(item = {}) {
  const missing = [];
  if (num(item.weight_kg) === null || num(item.weight_kg) <= 0) missing.push('poids');
  if (num(item.package_count) === null || num(item.package_count) <= 0) missing.push('colis');
  if (!clean(item.origin_label)) missing.push('origine');
  if (!clean(item.site_code)) missing.push('code site');
  const decorated = { ...item, missing };
  decorated.status = lineStatus(decorated);
  decorated.reference = businessReference(decorated.reference);
  decorated.announcement_line = decorated.source_type === 'purchase_arrival'
    ? formatSupplierArrivalAnnouncementLine(decorated)
    : formatAnnouncementLine(decorated);
  return decorated;
}

function summarizeCarrierSection(section = []) {
  return section.reduce((acc, item) => {
    acc.count += 1;
    if (item.delivery_mode === DOCK_PICKUP_MODE) acc.pickup_count += 1;
    const packages = num(item.package_count);
    const weight = num(item.weight_kg);
    if (packages !== null) acc.package_count += packages;
    else acc.package_count_partial = true;
    if (weight !== null) acc.weight_kg += weight;
    else acc.weight_partial = true;
    return acc;
  }, { count: 0, pickup_count: 0, package_count: 0, weight_kg: 0, package_count_partial: false, weight_partial: false });
}

function summarizeCarrierGroup(group = {}) {
  const all = [
    ...(group.supplier_arrivals || []),
    ...(group.client_deliveries || []),
    ...(group.preparations || []),
    ...(group.dock_pickups || []),
  ];
  return {
    supplier_arrivals: summarizeCarrierSection(group.supplier_arrivals),
    client_deliveries: summarizeCarrierSection(group.client_deliveries),
    preparations: summarizeCarrierSection(group.preparations),
    dock_pickups: summarizeCarrierSection(group.dock_pickups),
    total: summarizeCarrierSection(all),
    missing_information: all.filter((item) => item.missing?.length),
  };
}

function emptyCarrierGroup(carrier, date) {
  return {
    carrier,
    carrier_id: carrier.id,
    carrier_name: carrier.name,
    email_to: resolveCarrierEmail(carrier),
    date,
    supplier_arrivals: [],
    client_deliveries: [],
    preparations: [],
    dock_pickups: [],
    summary: {},
  };
}

function addToCarrier(groups, carrier, date, section, item) {
  if (!carrier?.id) return;
  if (!groups.has(carrier.id)) groups.set(carrier.id, emptyCarrierGroup(carrier, date));
  groups.get(carrier.id)[section].push(decorateDispatchItem(item));
}

async function getCarriersById(db, storeId) {
  const carriers = await transport.listCarriers(db, storeId);
  return new Map((carriers.results || []).map((carrier) => [carrier.id, carrier]));
}

async function findDelanchyCarrier(db, storeId) {
  const result = await db.query(
    `SELECT id, code, name, email, transport_operations_email, supplier_type, is_carrier
     FROM suppliers
     WHERE store_id = $1
       AND COALESCE(status, 'active') <> 'inactive'
       AND (is_carrier = true OR supplier_type = 'transporteur')
       AND (code ILIKE '%delanchy%' OR name ILIKE '%delanchy%')
     ORDER BY name ASC
     LIMIT 1`,
    [storeId]
  );
  return result.rows[0] || null;
}

async function fetchSupplierArrivals(db, storeId, date) {
  const result = await db.query(
    `SELECT p.id AS source_id, 'purchase_arrival' AS source_type,
        COALESCE(p.bl_number, p.source_reference, p.invoice_number, p.id::text) AS reference,
        p.purchase_date AS date, p.purchase_date, p.receipt_date,
        p.supplier_id, s.name AS supplier_name, s.code AS supplier_code, s.city AS supplier_city,
        sts.purchase_transport_chain_id AS chain_id,
        tc.name AS chain_name, tc.origin_label AS chain_origin_label, tc.destination_label AS chain_destination_label,
        tcl.carrier_id,
        COALESCE(tcl.origin_label, tc.origin_label, MAX(plm.origin_label), s.city, s.name) AS origin_label,
        COALESCE(tcl.destination_label, tc.destination_label, s.code) AS site_code,
        COALESCE(SUM(NULLIF(COALESCE(pl.received_quantity, pl.ordered_quantity, 0), 0)), 0) AS weight_kg,
        COALESCE(SUM(NULLIF(COALESCE(pl.received_colis, pl.ordered_colis, 0), 0)), 0) AS package_count
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
     JOIN supplier_transport_settings sts ON sts.supplier_id = p.supplier_id AND sts.store_id = p.store_id
     JOIN transport_chains tc ON tc.id = sts.purchase_transport_chain_id AND tc.store_id = p.store_id
     JOIN transport_chain_legs tcl ON tcl.chain_id = tc.id AND tcl.store_id = tc.store_id
     LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
     LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id AND plm.meta_key = 'gc_line'
     WHERE p.store_id = $1
       AND COALESCE(p.receipt_date, p.purchase_date) = $2::date
       AND COALESCE(p.status, 'ordered') <> 'cancelled'
       AND sts.purchase_transport_mode = 'carrier_paid_by_us'
     GROUP BY p.id, s.id, sts.purchase_transport_chain_id, tc.id, tcl.id`,
    [storeId, date]
  );
  return result.rows;
}

async function fetchClientDeliveryRows(db, storeId, date, dockPickup = false) {
  const result = await db.query(
    `SELECT sd.id AS source_id,
        CASE WHEN sd.document_type = 'DELIVERY_NOTE' THEN 'client_delivery_note' ELSE 'client_order_delivery' END AS source_type,
        COALESCE(sd.reference_number, sd.id::text) AS reference,
        sd.document_date AS date, sd.document_type,
        c.id AS client_id, c.name AS client_name, c.code AS client_code, c.store_identifier AS site_code,
        c.address_line1, c.address_line2, c.postal_code, c.city,
        COALESCE(c.delanchy_dock_pickup, false) AS delanchy_dock_pickup,
        billed.id AS billed_client_id, billed.name AS billed_client_name, billed.code AS billed_client_code,
        c.sale_transport_chain_id AS chain_id, tc.name AS chain_name,
        tcl.carrier_id,
        COALESCE(tcl.origin_label, tc.origin_label) AS origin_label,
        COALESCE(tcl.destination_label, tc.destination_label, c.name) AS destination_label,
        COALESCE(SUM(NULLIF(COALESCE(sl.total_weight, sl.sold_quantity, 0), 0)), 0) AS weight_kg,
        COALESCE(SUM(NULLIF(sl.package_count, 0)), 0) AS package_count
     FROM sales_documents sd
     JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
     LEFT JOIN clients billed ON billed.id = COALESCE(sd.billed_client_id, c.billed_client_id, c.id) AND billed.store_id = sd.store_id
     JOIN transport_chains tc ON tc.id = c.sale_transport_chain_id AND tc.store_id = c.store_id
     JOIN transport_chain_legs tcl ON tcl.chain_id = tc.id AND tcl.store_id = tc.store_id
     LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
     WHERE sd.store_id = $1
       AND sd.document_date = $2::date
       AND sd.document_type IN ('ORDER', 'DELIVERY_NOTE')
       AND COALESCE(sd.status, 'draft') <> 'cancelled'
       AND COALESCE(c.sale_transport_mode, 'none') = 'carrier_paid_by_us'
       AND COALESCE(c.delanchy_dock_pickup, false) = $3::boolean
       AND (
         sd.document_type = 'DELIVERY_NOTE'
         OR NOT EXISTS (
           SELECT 1 FROM sales_documents dn
           WHERE dn.store_id = sd.store_id
             AND dn.source_order_id = sd.id
             AND dn.document_type = 'DELIVERY_NOTE'
             AND COALESCE(dn.status, 'draft') <> 'cancelled'
         )
       )
     GROUP BY sd.id, c.id, billed.id, tc.id, tcl.id`,
    [storeId, date, dockPickup]
  );
  return result.rows;
}

async function fetchPreparationDocuments(db, storeId, date) {
  const result = await db.query(
    `SELECT sd.id AS source_id, 'client_preparation' AS source_type,
        COALESCE(sd.reference_number, sd.id::text) AS reference,
        sd.document_date AS date, sd.document_type,
        c.id AS client_id, c.name AS client_name, c.code AS client_code, c.store_identifier AS site_code,
        c.address_line1, c.address_line2, c.postal_code, c.city,
        COALESCE(c.delanchy_dock_pickup, false) AS delanchy_dock_pickup,
        billed.id AS billed_client_id, billed.name AS billed_client_name, billed.code AS billed_client_code,
        ls.id AS logistics_service_id, ls.label AS logistics_service_label,
        cls.provider_supplier_id AS carrier_id,
        provider.name AS provider_supplier_name,
        c.sale_transport_chain_id AS chain_id,
        COALESCE(SUM(NULLIF(COALESCE(sl.total_weight, sl.sold_quantity, 0), 0)), 0) AS weight_kg,
        COALESCE(SUM(NULLIF(sl.package_count, 0)), 0) AS package_count
     FROM sales_documents sd
     JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
     LEFT JOIN clients billed ON billed.id = COALESCE(sd.billed_client_id, c.billed_client_id, c.id) AND billed.store_id = sd.store_id
     JOIN client_logistics_services cls ON cls.client_id = c.id AND cls.store_id = c.store_id AND cls.is_active = true
     JOIN logistics_services ls ON ls.id = cls.logistics_service_id AND ls.store_id = cls.store_id
     JOIN suppliers provider ON provider.id = cls.provider_supplier_id AND provider.store_id = cls.store_id
     LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
     WHERE sd.store_id = $1
       AND sd.document_date = $2::date
       AND sd.document_type IN ('ORDER', 'DELIVERY_NOTE')
       AND COALESCE(sd.status, 'draft') <> 'cancelled'
       AND ls.is_active = true
       AND cls.provider_supplier_id IS NOT NULL
       AND COALESCE(provider.status, 'active') <> 'inactive'
       AND (provider.is_carrier = true OR provider.supplier_type = 'transporteur')
       AND ls.effective_from <= $2::date
       AND (ls.effective_to IS NULL OR ls.effective_to >= $2::date)
       AND (
         LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(ls.label, ''), 'É', 'E'), 'È', 'E'), 'Ê', 'E'), 'é', 'e'), 'è', 'e'), 'ê', 'e')) ~ '(^|[^a-z])prepa([^a-z]|$)'
         OR LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(ls.label, ''), 'É', 'E'), 'È', 'E'), 'Ê', 'E'), 'é', 'e'), 'è', 'e'), 'ê', 'e')) ~ '(^|[^a-z])preparation([^a-z]|$)'
       )
       AND (
         sd.document_type = 'DELIVERY_NOTE'
         OR NOT EXISTS (
           SELECT 1 FROM sales_documents dn
           WHERE dn.store_id = sd.store_id
             AND dn.source_order_id = sd.id
             AND dn.document_type = 'DELIVERY_NOTE'
             AND COALESCE(dn.status, 'draft') <> 'cancelled'
         )
       )
     GROUP BY sd.id, c.id, billed.id, ls.id, cls.provider_supplier_id, provider.id`,
    [storeId, date]
  );
  return result.rows;
}

async function fetchPreparationLines(db, storeId, documentIds = []) {
  if (!documentIds.length) return new Map();
  const result = await db.query(
    `SELECT sl.*,
        COALESCE(alloc.supplier_name, selected_supplier.name, suggested_supplier.name) AS allocation_supplier_name,
        selected_supplier.name AS selected_lot_supplier_name,
        suggested_supplier.name AS suggested_lot_supplier_name
     FROM sales_lines sl
     LEFT JOIN lots selected_lot ON selected_lot.id = sl.selected_lot_id AND selected_lot.store_id = sl.store_id
     LEFT JOIN suppliers selected_supplier ON selected_supplier.id = selected_lot.supplier_id AND selected_supplier.store_id = sl.store_id
     LEFT JOIN lots suggested_lot ON suggested_lot.id = sl.suggested_lot_id AND suggested_lot.store_id = sl.store_id
     LEFT JOIN suppliers suggested_supplier ON suggested_supplier.id = suggested_lot.supplier_id AND suggested_supplier.store_id = sl.store_id
     LEFT JOIN LATERAL (
       SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name) AS supplier_name
       FROM sale_line_allocations sla
       JOIN lots l ON l.id = sla.lot_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = sl.store_id
       WHERE sla.sales_line_id = sl.id
     ) alloc ON true
     WHERE sl.store_id = $1 AND sl.sales_document_id = ANY($2::uuid[])
     ORDER BY sl.sales_document_id, sl.line_number`,
    [storeId, documentIds]
  );
  const byDocument = new Map();
  for (const line of result.rows) {
    if (!byDocument.has(line.sales_document_id)) byDocument.set(line.sales_document_id, []);
    byDocument.get(line.sales_document_id).push(line);
  }
  return byDocument;
}

async function getPreparationDispatch(db, storeId, input = {}) {
  const date = isoDate(input.date || input.dispatch_date);
  const [carriersById, delanchyCarrier, arrivals, deliveries, dockDeliveries, preparations] = await Promise.all([
    getCarriersById(db, storeId),
    findDelanchyCarrier(db, storeId),
    fetchSupplierArrivals(db, storeId, date),
    fetchClientDeliveryRows(db, storeId, date, false),
    fetchClientDeliveryRows(db, storeId, date, true),
    fetchPreparationDocuments(db, storeId, date),
  ]);
  const groups = new Map();

  for (const row of arrivals) {
    addToCarrier(groups, carriersById.get(row.carrier_id), date, 'supplier_arrivals', {
      ...row,
      date,
      client_name: MISSING,
      delivery_mode: MISSING,
    });
  }

  for (const row of deliveries) {
    const billedDifferent = row.billed_client_id && row.client_id && row.billed_client_id !== row.client_id;
    addToCarrier(groups, carriersById.get(row.carrier_id), date, 'client_deliveries', {
      ...row,
      supplier_name: MISSING,
      date,
      delivery_mode: DELIVERY_MODE,
      billed_client_display: billedDifferent ? row.billed_client_name : null,
      delivery_address: [row.address_line1, row.address_line2, [row.postal_code, row.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    });
  }

  for (const row of dockDeliveries) {
    const carrier = delanchyCarrier || carriersById.get(row.carrier_id);
    addToCarrier(groups, carrier, date, 'dock_pickups', {
      ...row,
      supplier_name: MISSING,
      carrier_id: carrier?.id || row.carrier_id,
      date,
      delivery_mode: DOCK_PICKUP_MODE,
      delivery_address: 'Delanchy',
    });
  }

  const linesByDocument = await fetchPreparationLines(db, storeId, preparations.map((row) => row.source_id));
  for (const row of preparations) {
    const lines = linesByDocument.get(row.source_id) || [];
    const supplierBlocks = buildPreparationSupplierBlocks(lines);
    addToCarrier(groups, carriersById.get(row.carrier_id), date, 'preparations', {
      ...row,
      supplier_name: supplierBlocks.map((block) => block.supplier_name).join(', ') || UNKNOWN_SUPPLIER,
      supplier_blocks: supplierBlocks,
      date,
      delivery_mode: row.delanchy_dock_pickup ? DOCK_PICKUP_MODE : DELIVERY_MODE,
      order_reference: businessReference(row.reference, 'Commande'),
      preparation_order_url: `/api/pdf-documents/sales/${row.source_id}/pdf`,
    });
  }

  const results = Array.from(groups.values()).map((group) => ({
    ...group,
    summary: summarizeCarrierGroup(group),
  })).sort((a, b) => String(a.carrier_name || '').localeCompare(String(b.carrier_name || '')));

  return { date, results };
}

function buildEmailPreviewForCarrier(group = {}) {
  const subject = `Preparation des envois ${group.carrier_name || ''} - ${formatDateFr(group.date)}`;
  const sections = [
    ['Arrivages fournisseurs', group.supplier_arrivals || []],
    ['Livraisons clients', group.client_deliveries || []],
    ['Preparations', group.preparations || []],
    ['Prises a quai', group.dock_pickups || []],
  ].filter(([, items]) => items.length);
  const text = [
    `Bonjour,`,
    '',
    `Voici le recapitulatif transport du ${formatDateFr(group.date)} pour ${group.carrier_name || 'le transporteur'}.`,
    '',
    ...sections.flatMap(([title, items]) => [
      title,
      ...items.map((item) => `- ${item.announcement_line}`),
      '',
    ]),
    `Pieces jointes preparation: ${(group.preparations || []).length}`,
  ].join('\n');
  const html = text
    .split('\n')
    .map((line) => {
      if (!line) return '<br>';
      if (line === 'Prises a quai') return '<h3 style="color:#9a3412">Prises a quai</h3>';
      if (['Arrivages fournisseurs', 'Livraisons clients', 'Preparations'].includes(line)) return `<h3>${line}</h3>`;
      const strong = line.includes(DOCK_PICKUP_MODE);
      return `<p${strong ? ' style="font-weight:700;color:#9a3412"' : ''}>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`;
    }).join('');
  return {
    carrier_id: group.carrier_id,
    carrier_name: group.carrier_name,
    email_to: group.email_to,
    date: group.date,
    subject,
    text,
    html,
    attachments: (group.preparations || []).map((item) => ({
      sales_document_id: item.source_id,
      reference: item.order_reference || item.reference,
      filename: `${displaySalesDocumentReference({ reference_number: item.order_reference || item.reference }, 'CMD') || item.order_reference || 'commande-preparation'}.pdf`,
    })),
    missing_information: group.summary?.missing_information || [],
  };
}

async function getSaleOrderPayloadForPdf(db, storeId, documentId) {
  const docResult = await db.query(
    `WITH requested AS (
       SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 LIMIT 1
     ),
     target AS (
       SELECT COALESCE(
         CASE WHEN requested.document_type = 'ORDER' THEN requested.id END,
         requested.source_order_id,
         delivery_note.source_order_id,
         CASE WHEN requested.document_type = 'DELIVERY_NOTE' THEN requested.id END,
         requested.source_delivery_note_id,
         requested.id
       ) AS document_id
       FROM requested
       LEFT JOIN sales_documents delivery_note
         ON delivery_note.id = requested.source_delivery_note_id
        AND delivery_note.store_id = requested.store_id
     )
     SELECT sd.*, requested.id AS requested_id, requested.document_type AS requested_document_type,
        c.name AS client_name, c.code AS client_code,
        c.store_identifier AS client_store_identifier,
        c.address_line1, c.address_line2, c.postal_code, c.city,
        COALESCE(c.delanchy_dock_pickup, false) AS delanchy_dock_pickup,
        COALESCE(c.tariff_level, sd.tariff_level_snapshot, 1) AS client_tariff_level
     FROM requested
     JOIN target ON true
     JOIN sales_documents sd ON sd.id = target.document_id AND sd.store_id = requested.store_id
     LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
     WHERE requested.document_type IN ('ORDER', 'DELIVERY_NOTE', 'INVOICE')
       AND sd.document_type IN ('ORDER', 'DELIVERY_NOTE')
     LIMIT 1`,
    [documentId, storeId]
  );
  if (!docResult.rows.length) return null;
  const sale = docResult.rows[0];
  const linesResult = await db.query(
    `SELECT sl.*,
        COALESCE(alloc.supplier_name, selected_supplier.name, suggested_supplier.name) AS supplier_name
     FROM sales_lines sl
     LEFT JOIN lots selected_lot ON selected_lot.id = sl.selected_lot_id AND selected_lot.store_id = sl.store_id
     LEFT JOIN suppliers selected_supplier ON selected_supplier.id = selected_lot.supplier_id AND selected_supplier.store_id = sl.store_id
     LEFT JOIN lots suggested_lot ON suggested_lot.id = sl.suggested_lot_id AND suggested_lot.store_id = sl.store_id
     LEFT JOIN suppliers suggested_supplier ON suggested_supplier.id = suggested_lot.supplier_id AND suggested_supplier.store_id = sl.store_id
     LEFT JOIN LATERAL (
       SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name) AS supplier_name
       FROM sale_line_allocations sla
       JOIN lots l ON l.id = sla.lot_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = sl.store_id
       WHERE sla.sales_line_id = sl.id
     ) alloc ON true
     WHERE sl.sales_document_id = $1 AND sl.store_id = $2
     ORDER BY sl.line_number ASC`,
    [sale.id, storeId]
  );
  const settings = await db.query(
    `SELECT company_name, logo_url, address_line1, address_line2, postal_code, city, country,
      phone, contact_email, email, email_sender_address,
      siret, vat_number, sanitary_approval_number, iban, bic,
      payment_terms, legal_mentions, terms_and_conditions, delivery_note_footer, invoice_footer,
      royale_maree_commission_eur_per_kg
     FROM store_settings
     WHERE store_id = $1
     LIMIT 1`,
    [storeId]
  );
  const lines = linesResult.rows.map((line) => ({ ...line, supplier_name: supplierNameFromLine(line) }));
  return {
    sale: {
      ...sale,
      delivery_mode: deliveryModeForClient(sale),
      supplier_blocks: buildPreparationSupplierBlocks(lines),
      client_recap: buildClientRecap({ sale, lines, deliveryMode: deliveryModeForClient(sale) }),
    },
    lines,
    storeSettings: settings.rows[0] || {},
  };
}

async function buildPreparationPdfAttachment(db, storeId, documentId) {
  const { renderHtmlToPdf } = require('./pdf/pdfRenderer');
  const payload = await getSaleOrderPayloadForPdf(db, storeId, documentId);
  if (!payload) return null;
  const html = renderSaleOrderPdf(payload);
  const content = await renderHtmlToPdf(html);
  return {
    filename: saleOrderFilename(payload.sale),
    content,
    contentType: 'application/pdf',
  };
}

async function syncDraftShipments(db, storeId, input = {}, context = {}) {
  const dispatch = await getPreparationDispatch(db, storeId, input);
  const candidates = dispatch.results.flatMap((group) => [
    ...group.supplier_arrivals.map((item) => ({ ...item, direction: 'purchase' })),
    ...group.client_deliveries.map((item) => ({ ...item, direction: 'sale' })),
  ]);
  const synced = [];
  const skipped = [];
  for (const item of candidates) {
    if (!clean(item.chain_id) || num(item.weight_kg) === null || num(item.weight_kg) <= 0) {
      skipped.push({ source_type: item.source_type, source_id: item.source_id, reason: 'missing_chain_or_weight' });
      continue;
    }
    const shipment = await transport.upsertDraftShipmentFromSource(db, storeId, {
      shipment_date: dispatch.date,
      direction: item.direction,
      carrier_id: item.carrier_id,
      chain_id: item.chain_id,
      total_weight_kg: item.weight_kg,
      origin_label: item.origin_label,
      destination_label: item.destination_label || item.client_name || item.site_code,
      notes: `Prepare les envois - ${item.reference || item.source_id}`,
      source_type: item.source_type,
      source_id: item.source_id,
      source_reference: item.reference,
    }, context);
    synced.push(shipment);
  }
  return { ok: true, date: dispatch.date, synced_count: synced.length, skipped_count: skipped.length, synced, skipped };
}

async function previewCarrierEmail(db, storeId, input = {}) {
  const dispatch = await getPreparationDispatch(db, storeId, input);
  const carrierId = clean(input.carrier_id);
  const group = dispatch.results.find((item) => item.carrier_id === carrierId);
  if (!group) {
    const error = new Error('Aucun element pour ce transporteur et cette date');
    error.status = 404;
    throw error;
  }
  return buildEmailPreviewForCarrier(group);
}

async function sendCarrierEmail(db, storeId, input = {}, context = {}) {
  const { sendEmail } = require('./emailService');
  const preview = await previewCarrierEmail(db, storeId, input);
  if (!preview.email_to) {
    const error = new Error('Transporteur sans email exploitation ni email principal');
    error.status = 400;
    throw error;
  }
  const attachments = [];
  for (const attachment of preview.attachments) {
    const pdf = await buildPreparationPdfAttachment(db, storeId, attachment.sales_document_id);
    if (pdf) attachments.push(pdf);
  }
  const email = await sendEmail({
    to: preview.email_to,
    subject: preview.subject,
    text: preview.text,
    html: preview.html,
    attachments,
  });
  await db.query(
    `INSERT INTO transport_dispatch_email_logs (
      store_id, dispatch_date, carrier_id, email_to, subject, attachment_count,
      payload_snapshot, sent_by, smtp_message_id
    ) VALUES ($1,$2::date,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      storeId,
      preview.date,
      preview.carrier_id,
      preview.email_to,
      preview.subject,
      attachments.length,
      JSON.stringify({ ...preview, html: undefined }),
      context.user_id || null,
      email.message_id || null,
    ]
  );
  return { ok: true, email, preview, attachment_count: attachments.length };
}

module.exports = {
  MISSING,
  UNKNOWN_SUPPLIER,
  DELIVERY_MODE,
  DOCK_PICKUP_MODE,
  resolveCarrierEmail,
  isPreparationService,
  deliveryModeForClient,
  formatAnnouncementLine,
  formatSupplierArrivalAnnouncementLine,
  supplierNameFromLine,
  buildPreparationSupplierBlocks,
  buildClientRecap,
  buildEmailPreviewForCarrier,
  getPreparationDispatch,
  syncDraftShipments,
  previewCarrierEmail,
  sendCarrierEmail,
  getSaleOrderPayloadForPdf,
};
