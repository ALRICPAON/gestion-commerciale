const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dispatch = require('../services/transportPreparationDispatchService');
const { renderSaleOrderPdf } = require('../services/pdf/templates/saleOrderPdfTemplate');

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const DELANCHY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_ID = '44444444-4444-4444-8444-444444444444';
const RM_ID = '55555555-5555-4555-8555-555555555555';
const ORDER_ID = '66666666-6666-4666-8666-666666666666';
const DELIVERY_NOTE_ID = '77777777-7777-4777-8777-777777777777';
const INVOICED_DELIVERY_NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVOICE_ID = '99999999-9999-4999-8999-999999999999';
const CHAIN_ID = '88888888-8888-4888-8888-888888888888';

function makeDb(overrides = {}) {
  const state = {
    carriers: [
      { id: DELANCHY_ID, code: 'DEL', name: 'DELANCHY', email: 'contact@delanchy.test', transport_operations_email: 'exploitation@delanchy.test', supplier_type: 'transporteur', is_carrier: true },
      { id: OTHER_ID, code: 'OTH', name: 'Autre Transport', email: 'main@other.test', transport_operations_email: null, supplier_type: 'transporteur', is_carrier: true },
    ],
    arrivals: [],
    deliveries: [],
    dockDeliveries: [],
    preparations: [],
    prepLines: [],
    shipments: [],
    insertedShipments: 0,
    updatedShipments: 0,
    bltGenerated: 0,
    saleOrderResolutionSql: '',
    ...overrides,
  };

  return {
    state,
    async query(sql, params) {
      if (sql.includes('FROM suppliers') && sql.includes('(is_carrier = true OR supplier_type')) {
        if (sql.includes('delanchy')) return { rows: state.carriers.filter((carrier) => /delanchy/i.test(`${carrier.code} ${carrier.name}`)).slice(0, 1) };
        return { rows: state.carriers };
      }
      if (sql.includes('FROM purchases p')) return { rows: state.arrivals };
      if (sql.includes('FROM sales_documents sd') && sql.includes("c.delanchy_dock_pickup, false) = $3")) {
        return { rows: params[2] ? state.dockDeliveries : state.deliveries };
      }
      if (sql.includes('JOIN client_logistics_services')) {
        return { rows: state.preparations.filter((row) => row.carrier_id) };
      }
      if (sql.includes('WHERE sl.store_id = $1 AND sl.sales_document_id = ANY')) return { rows: state.prepLines };
      if (sql.includes('FROM transport_shipments') && sql.includes('source_type')) {
        return { rows: state.shipments.filter((shipment) => shipment.source_type === params[1] && shipment.source_id === params[2]).slice(0, 1) };
      }
      if (sql.includes('SELECT * FROM transport_shipments') && sql.includes('FOR UPDATE')) {
        return { rows: state.shipments.filter((shipment) => shipment.id === params[0]).slice(0, 1) };
      }
      if (sql.includes('FROM transport_delivery_notes') && sql.includes('shipment_id')) return { rows: [] };
      if (sql.includes('FROM transport_chains')) {
        return { rows: [{ id: CHAIN_ID, name: 'Fournisseur -> Delanchy', origin_label: 'COPROMER', destination_label: 'FT44' }] };
      }
      if (sql.includes('FROM transport_chain_legs')) {
        return { rows: [{ id: 'leg-1', chain_id: CHAIN_ID, carrier_id: DELANCHY_ID, grid_id: 'grid-1', grid_name: 'Grille', grid_origin_label: 'COPROMER', grid_destination_label: 'FT44' }] };
      }
      if (sql.includes('FROM transport_rate_brackets')) {
        return { rows: [{ id: 'bracket-1', min_weight_kg: 0, max_weight_kg: null, pricing_mode: 'per_tonne', amount_ht: 100, display_order: 1 }] };
      }
      if (sql.includes('FROM transport_fuel_surcharges')) return { rows: [] };
      if (sql.includes('FROM supplier_transport_settings')) return { rows: [{ admin_fee_ht: 0 }] };
      if (sql.includes('INSERT INTO transport_shipments')) {
        state.insertedShipments += 1;
        const row = {
          id: `shipment-${state.insertedShipments}`,
          store_id: params[0],
          shipment_date: params[1],
          direction: params[2],
          carrier_id: params[3],
          chain_id: params[4],
          total_weight_kg: params[7],
          expected_total_ht: params[8],
          idempotency_key: params[11],
          source_type: params[12],
          source_id: params[13],
          source_reference: params[14],
          status: 'draft',
        };
        state.shipments.push(row);
        return { rows: [row] };
      }
      if (sql.includes('UPDATE transport_shipments')) {
        state.updatedShipments += 1;
        const row = state.shipments.find((shipment) => shipment.id === params[0]);
        Object.assign(row, { total_weight_kg: params[8], expected_total_ht: params[9], source_reference: params[14] || row.source_reference });
        return { rows: [row] };
      }
      if (sql.includes('requested.document_type AS requested_document_type')) {
        state.saleOrderResolutionSql = sql;
        const requestedId = params[0];
        const requestedType = requestedId === INVOICE_ID
          ? 'INVOICE'
          : [DELIVERY_NOTE_ID, INVOICED_DELIVERY_NOTE_ID].includes(requestedId) ? 'DELIVERY_NOTE' : 'ORDER';
        return { rows: [{
          id: ORDER_ID,
          requested_id: requestedId,
          requested_document_type: requestedType,
          document_type: 'ORDER',
          reference_number: 'BC-2026-00142',
          document_date: '2026-09-18',
          client_name: 'E.Leclerc Orvault',
          delanchy_dock_pickup: false,
        }] };
      }
      if (sql.includes('WHERE sl.sales_document_id = $1')) return { rows: state.prepLines };
      if (sql.includes('FROM store_settings')) return { rows: [{ company_name: 'ALTA MAREE' }] };
      if (sql.includes('INSERT INTO transport_dispatch_email_logs')) return { rows: [] };
      return { rows: [] };
    },
  };
}

function deliveryRow(extra = {}) {
  return {
    source_id: ORDER_ID,
    source_type: 'client_order_delivery',
    document_type: 'ORDER',
    source_order_id: null,
    source_delivery_note_id: null,
    reference: 'BC-2026-00142',
    date: '2026-09-18',
    client_id: CLIENT_ID,
    client_name: 'E.Leclerc Orvault',
    billed_client_id: RM_ID,
    billed_client_name: 'Royale Maree',
    carrier_id: DELANCHY_ID,
    chain_id: CHAIN_ID,
    origin_label: 'FT44',
    destination_label: 'E.Leclerc Orvault',
    site_code: 'ORV',
    weight_kg: 82,
    package_count: 6,
    ...extra,
  };
}

function prepRow(extra = {}) {
  return {
    ...deliveryRow(extra),
    source_type: 'client_preparation',
    order_source_id: extra.order_source_id || (extra.document_type === 'DELIVERY_NOTE' ? extra.source_order_id : extra.source_id || ORDER_ID),
    order_reference: 'BC-2026-00142',
    logistics_service_id: 'prep-service',
    logistics_service_label: 'Preparation',
  };
}

function prepLine(extra = {}) {
  return {
    id: `line-${Math.random()}`,
    sales_document_id: extra.sales_document_id || ORDER_ID,
    line_number: extra.line_number || 1,
    article_plu: extra.article_plu || '100',
    article_label: extra.article_label || 'Article',
    package_count: extra.package_count,
    weight_per_package: extra.weight_per_package || 0,
    total_weight: extra.total_weight,
    sold_quantity: extra.sold_quantity,
    sale_unit: 'kg',
    supplier_name: extra.supplier_name,
    allocation_supplier_name: extra.supplier_name,
    source_inventory_line: {},
  };
}

(async () => {
  assert.strictEqual(dispatch.resolveCarrierEmail({ transport_operations_email: 'ops@test', email: 'main@test' }), 'ops@test');
  assert.strictEqual(dispatch.resolveCarrierEmail({ email: 'main@test' }), 'main@test');
  assert.strictEqual(dispatch.isPreparationService({ label: 'Preparation commandes' }), true);
  assert.strictEqual(dispatch.isPreparationService({ label: 'PREPA COMMANDE' }), true, 'Test A PREPA COMMANDE reconnue');
  assert.strictEqual(dispatch.isPreparationService({ label: 'PRÉPARATION' }), true, 'Test B PREPARATION accentuee reconnue');

  const noPrepDb = makeDb({ deliveries: [deliveryRow()], preparations: [] });
  const noPrep = await dispatch.getPreparationDispatch(noPrepDb, STORE_ID, { date: '2026-09-18' });
  assert.strictEqual(noPrep.results[0].client_deliveries.length, 1, 'Test A livraison visible');
  assert.strictEqual(noPrep.results[0].preparations.length, 0, 'Test A aucune preparation');

  const missingProviderDb = makeDb({ preparations: [prepRow({ carrier_id: null })] });
  const missingProvider = await dispatch.getPreparationDispatch(missingProviderDb, STORE_ID, { date: '2026-09-18' });
  assert.strictEqual(missingProvider.results.length, 0, 'Test C prestation sans prestataire non envoyee en preparation');

  const prepDb = makeDb({ preparations: [prepRow()], prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 3, total_weight: 40 })] });
  const withPrep = await dispatch.getPreparationDispatch(prepDb, STORE_ID, { date: '2026-09-18' });
  assert.strictEqual(withPrep.results[0].preparations.length, 1, 'Test B commande en preparation');
  assert.strictEqual(withPrep.results[0].carrier_id, DELANCHY_ID, 'Test B transporteur correct');
  assert.strictEqual(withPrep.results[0].preparations[0].preparation_order_url, `/api/pdf-documents/sales/${ORDER_ID}/pdf`, 'Test B commande directe utilise la route sales');

  const linkedDocumentDb = makeDb({
    deliveries: [deliveryRow({ source_id: DELIVERY_NOTE_ID, document_type: 'DELIVERY_NOTE', source_order_id: ORDER_ID, source_type: 'client_delivery_note' })],
    preparations: [prepRow({ source_id: DELIVERY_NOTE_ID, document_type: 'DELIVERY_NOTE', source_order_id: ORDER_ID })],
    prepLines: [prepLine({ sales_document_id: DELIVERY_NOTE_ID, supplier_name: 'SOGELMER', package_count: 3, total_weight: 40 })],
  });
  const linkedDocuments = await dispatch.getPreparationDispatch(linkedDocumentDb, STORE_ID, { date: '2026-09-18' });
  assert.strictEqual(linkedDocuments.results[0].client_deliveries[0].source_id, DELIVERY_NOTE_ID, 'Test A bouton BL conserve identifiant BL');
  assert.strictEqual(linkedDocuments.results[0].client_deliveries[0].document_type, 'DELIVERY_NOTE', 'Test A livraison typee BL');
  assert.strictEqual(linkedDocuments.results[0].preparations[0].order_source_id, ORDER_ID, 'Test C preparation BL expose commande source');
  assert.strictEqual(linkedDocuments.results[0].preparations[0].preparation_order_url, `/api/pdf-documents/sales/${ORDER_ID}/pdf`, 'Test C aucun identifiant BL envoye a la route commande');

  const splitCarrierDb = makeDb({
    deliveries: [deliveryRow({ carrier_id: OTHER_ID })],
    preparations: [prepRow({ carrier_id: DELANCHY_ID })],
    prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 2, total_weight: 20 })],
  });
  const splitCarrier = await dispatch.getPreparationDispatch(splitCarrierDb, STORE_ID, { date: '2026-09-18' });
  const prepGroup = splitCarrier.results.find((group) => group.carrier_id === DELANCHY_ID);
  const deliveryGroup = splitCarrier.results.find((group) => group.carrier_id === OTHER_ID);
  assert.strictEqual(prepGroup.preparations.length, 1, 'Test E preparation rangee sous prestataire preparation');
  assert.strictEqual(deliveryGroup.client_deliveries.length, 1, 'Test E livraison conserve le transporteur du circuit');

  const prepDeliveryDb = makeDb({
    deliveries: [deliveryRow()],
    preparations: [prepRow()],
    prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 2, total_weight: 20 })],
  });
  const prepDelivery = await dispatch.getPreparationDispatch(prepDeliveryDb, STORE_ID, { date: '2026-09-18' });
  assert.strictEqual(prepDelivery.results[0].preparations.length, 1, 'Test G preparation presente');
  assert.strictEqual(prepDelivery.results[0].client_deliveries.length, 1, 'Test G livraison presente');

  const blocks = dispatch.buildPreparationSupplierBlocks([
    prepLine({ supplier_name: 'SOGELMER', package_count: 6, total_weight: 82 }),
    prepLine({ supplier_name: 'COPROMER', package_count: 6, total_weight: 64.5 }),
  ]);
  assert.deepStrictEqual(blocks.map((block) => block.supplier_name), ['SOGELMER', 'COPROMER']);
  assert.strictEqual(blocks.reduce((sum, block) => sum + block.package_count, 0), 12, 'Test D total colis');
  assert.strictEqual(blocks.reduce((sum, block) => sum + block.weight_kg, 0), 146.5, 'Test D total poids');
  const pdfHtml = renderSaleOrderPdf({
    sale: {
      reference_number: 'BC-2026-00142',
      document_date: '2026-09-18',
      client_name: 'E.Leclerc Orvault',
      delivery_mode: dispatch.DELIVERY_MODE,
      supplier_blocks: blocks,
      client_recap: { client_name: 'E.Leclerc Orvault', package_count: 12, weight_kg: 146.5, delivery_mode: dispatch.DELIVERY_MODE },
    },
    lines: blocks.flatMap((block) => block.lines),
    storeSettings: {},
  });
  assert(pdfHtml.includes('Fournisseur : SOGELMER'), 'Test D fournisseur SOGELMER visible PDF');
  assert(pdfHtml.includes('Fournisseur : COPROMER'), 'Test D fournisseur COPROMER visible PDF');
  assert(pdfHtml.includes('Recapitulatif client'), 'Test D recap client visible PDF');

  const announcement = dispatch.formatAnnouncementLine({
    origin_label: 'COPROMER',
    site_code: 'FT44',
    supplier_name: 'SOGELMER',
    weight_kg: 82,
    package_count: 6,
    date: '2026-09-18',
    reference: 'BC-2026-00142',
    client_name: 'E.Leclerc Orvault',
    delivery_mode: dispatch.DELIVERY_MODE,
  });
  ['COPROMER', 'FT44', 'SOGELMER', '82 kg', '6 colis', '18/09/2026', 'BC-2026-00142', 'E.Leclerc Orvault', dispatch.DELIVERY_MODE].forEach((needle) => {
    assert(announcement.includes(needle), `Test E annonce contient ${needle}`);
  });

  const supplierAnnouncement = dispatch.formatSupplierArrivalAnnouncementLine({
    origin_label: 'COPROMER',
    site_code: 'FT44',
    supplier_name: 'LECRI MAREE',
    weight_kg: 29.636,
    package_count: 19,
    date: '2026-09-15',
    reference: '2a6f002d-306d-47ce-b914-b69a64f1602e',
    client_name: 'Client final',
    delivery_mode: dispatch.DELIVERY_MODE,
  });
  assert.strictEqual(supplierAnnouncement, 'COPROMER | FT44 | LECRI MAREE | 29,636 kg | 19 colis | 15/09/2026', 'Test E arrivage fournisseur simplifie');
  assert(!supplierAnnouncement.includes('2a6f002d-306d-47ce-b914-b69a64f1602e'), 'Test F UUID absent annonce fournisseur');
  assert(!supplierAnnouncement.includes('Client final'), 'Test F client final absent annonce fournisseur');
  assert(!supplierAnnouncement.includes(dispatch.DELIVERY_MODE), 'Test F mode absent annonce fournisseur');

  assert(noPrep.results[0].client_deliveries[0].announcement_line.includes('E.Leclerc Orvault'), 'Test F client livre dans annonce');
  assert(!noPrep.results[0].client_deliveries[0].announcement_line.includes('Royale Maree'), 'Test F client facture absent du champ client a livrer');

  const syncDb = makeDb({ deliveries: [deliveryRow()] });
  const firstSync = await dispatch.syncDraftShipments(syncDb, STORE_ID, { date: '2026-09-18' }, { user_id: 'user' });
  assert.strictEqual(firstSync.synced_count, 1, 'Test G brouillon cree');
  assert.strictEqual(syncDb.state.bltGenerated, 0, 'Test G aucun BLT automatique');
  const secondSync = await dispatch.syncDraftShipments(syncDb, STORE_ID, { date: '2026-09-18' }, { user_id: 'user' });
  assert.strictEqual(secondSync.synced_count, 1, 'Test H refresh idempotent');
  assert.strictEqual(syncDb.state.shipments.length, 1, 'Test H un seul shipment par source');

  const orderPayload = await dispatch.getSaleOrderPayloadForPdf(makeDb({ prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 1, total_weight: 10 })] }), STORE_ID, ORDER_ID);
  assert.strictEqual(orderPayload.sale.id, ORDER_ID, 'Test B commande directe conservee');

  const payload = await dispatch.getSaleOrderPayloadForPdf(makeDb({ prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 1, total_weight: 10 })] }), STORE_ID, DELIVERY_NOTE_ID);
  assert.strictEqual(payload.sale.id, ORDER_ID, 'Test I impression commande depuis BL remonte a la commande');
  assert.strictEqual(payload.lines.length, 1, 'Test I lignes commande disponibles');

  const invoicedDeliveryDb = makeDb({ prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 1, total_weight: 10 })] });
  const invoicedDeliveryPayload = await dispatch.getSaleOrderPayloadForPdf(invoicedDeliveryDb, STORE_ID, INVOICED_DELIVERY_NOTE_ID);
  assert.strictEqual(invoicedDeliveryPayload.sale.id, ORDER_ID, 'Test D BL facture remonte toujours a la commande');
  assert(!invoicedDeliveryDb.state.saleOrderResolutionSql.includes("status = 'invoiced'"), 'Test D resolution independante du statut facture');

  const invoicePayload = await dispatch.getSaleOrderPayloadForPdf(makeDb({ prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 1, total_weight: 10 })] }), STORE_ID, INVOICE_ID);
  assert.strictEqual(invoicePayload.sale.id, ORDER_ID, 'Test J facture remonte a la commande source');

  const dockDb = makeDb({ dockDeliveries: [deliveryRow({ delanchy_dock_pickup: true })] });
  const dock = await dispatch.getPreparationDispatch(dockDb, STORE_ID, { date: '2026-09-18' });
  assert.strictEqual(dock.results[0].client_deliveries.length, 0, 'Test J aucune livraison finale');
  assert.strictEqual(dock.results[0].dock_pickups[0].delivery_mode, dispatch.DOCK_PICKUP_MODE, 'Test J mode prise a quai');

  const prepDockDb = makeDb({
    dockDeliveries: [deliveryRow({ delanchy_dock_pickup: true })],
    preparations: [prepRow({ delanchy_dock_pickup: true })],
    prepLines: [prepLine({ supplier_name: 'SOGELMER', package_count: 2, total_weight: 20 })],
  });
  const prepDock = await dispatch.getPreparationDispatch(prepDockDb, STORE_ID, { date: '2026-09-18' });
  assert.strictEqual(prepDock.results[0].preparations.length, 1, 'Test K preparation visible');
  assert.strictEqual(prepDock.results[0].dock_pickups.length, 1, 'Test K prise a quai visible');
  assert.strictEqual(prepDock.results[0].preparations[0].delivery_mode, dispatch.DOCK_PICKUP_MODE, 'Test K Delanchy prepare et remise quai');
  assert.strictEqual(prepDock.results[0].client_deliveries.length, 0, 'Test K aucune livraison finale creee');

  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'transportPreparationDispatchService.js'), 'utf8');
  assert(service.includes('cls.provider_supplier_id AS carrier_id'), 'dispatch must use client logistics provider');
  assert(service.includes('prepa'), 'dispatch SQL must recognize PREPA labels');

  const missing = dispatch.formatAnnouncementLine({ date: '2026-09-18', reference: 'BC-X', client_name: 'Client', delivery_mode: dispatch.DELIVERY_MODE });
  assert(missing.includes('A completer'), 'Test L donnees manquantes signalees');

  const emailPreview = dispatch.buildEmailPreviewForCarrier(withPrep.results[0]);
  assert.strictEqual(emailPreview.email_to, 'exploitation@delanchy.test', 'Test C email exploitation utilise');
  assert(emailPreview.text.includes('Preparations'), 'Test C email recap lisible');
  assert(!emailPreview.text.includes('Arrivages fournisseurs\n- Aucun element'), 'Test H section vide masquee');
  assert.strictEqual(emailPreview.attachments.length, 1, 'Test I preparation ajoute une piece jointe');
  assert(!emailPreview.attachments[0].filename.includes(ORDER_ID), 'Test I nom de fichier metier');

  console.log('transport preparation dispatch tests ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
