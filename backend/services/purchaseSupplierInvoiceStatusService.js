const DISPLAY_LABELS = {
  received_pending_invoice: 'Recu - facture attendue',
  invoice_difference: 'Ecart facture',
  invoice_matched: 'Facture rapprochee',
  validee_a_payer: 'Valide a payer',
  payee: 'Paye',
  litige: 'Litige',
  refusee: 'Refusee',
};

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function lower(value) {
  return clean(value)?.toLowerCase() || '';
}

function isPaidInvoice(row = {}) {
  const paymentStatus = lower(row.payment_status || row.pennylane_status);
  const controlStatus = lower(row.supplier_control_status);
  const altaStatus = lower(row.alta_business_status || row.status);
  return row.paid === true ||
    controlStatus === 'paye' ||
    altaStatus === 'payee' ||
    paymentStatus === 'paid' ||
    paymentStatus.startsWith('paid_');
}

function isValidatedToPayInvoice(row = {}) {
  const paymentStatus = lower(row.payment_status || row.pennylane_status);
  const controlStatus = lower(row.supplier_control_status);
  const altaStatus = lower(row.alta_business_status || row.status);
  return controlStatus === 'valide_a_payer' ||
    altaStatus === 'validee_a_payer' ||
    paymentStatus === 'to_be_paid';
}

function isDisputedInvoice(row = {}) {
  const controlStatus = lower(row.supplier_control_status);
  const altaStatus = lower(row.alta_business_status || row.status);
  return controlStatus === 'litige' || altaStatus === 'litige' || altaStatus === 'refusee';
}

function isDifferenceInvoice(row = {}) {
  const controlStatus = lower(row.supplier_control_status);
  const altaStatus = lower(row.alta_business_status || row.status);
  const matchStatus = lower(row.link_match_status || row.match_status);
  return controlStatus === 'ecart' ||
    matchStatus === 'difference' ||
    matchStatus === 'discrepancy' ||
    ['ecart_prix', 'ecart_quantite', 'ecart_tva', 'invoice_difference'].includes(altaStatus);
}

function isMatchedInvoice(row = {}) {
  const controlStatus = lower(row.supplier_control_status);
  const altaStatus = lower(row.alta_business_status || row.status);
  const matchStatus = lower(row.link_match_status || row.match_status);
  return controlStatus === 'conforme' ||
    ['conforme', 'en_controle', 'matched', 'invoice_matched'].includes(altaStatus) ||
    ['matched', 'validated', 'conforme'].includes(matchStatus);
}

function resolveSupplierInvoiceDisplayStatus(purchase = {}, invoiceLinks = []) {
  const links = Array.isArray(invoiceLinks) ? invoiceLinks.filter(Boolean) : [];
  let displayStatus = purchase.status || null;
  let source = 'purchase';

  if (links.some(isDisputedInvoice)) {
    displayStatus = 'litige';
    source = 'supplier_invoice';
  } else if (links.some(isPaidInvoice)) {
    displayStatus = 'payee';
    source = 'supplier_invoice';
  } else if (links.some(isValidatedToPayInvoice)) {
    displayStatus = 'validee_a_payer';
    source = 'supplier_invoice';
  } else if (links.some(isDifferenceInvoice) || purchase.status === 'invoice_difference') {
    displayStatus = 'invoice_difference';
    source = links.length ? 'supplier_invoice' : 'purchase';
  } else if (links.some(isMatchedInvoice) || purchase.status === 'invoice_matched') {
    displayStatus = 'invoice_matched';
    source = links.length ? 'supplier_invoice' : 'purchase';
  }

  return {
    supplier_invoice_display_status: displayStatus,
    supplier_invoice_display_label: DISPLAY_LABELS[displayStatus] || displayStatus || null,
    supplier_invoice_status_source: source,
    supplier_invoice_link_count: links.length,
  };
}

async function loadSupplierInvoiceLinksForPurchases(db, { storeId, purchaseIds }) {
  const ids = [...new Set((purchaseIds || []).map(clean).filter(Boolean))];
  if (!ids.length) return new Map();

  const byPurchase = new Map();
  const addRow = (row) => {
    const purchaseId = clean(row.purchase_id);
    if (!purchaseId) return;
    if (!byPurchase.has(purchaseId)) byPurchase.set(purchaseId, []);
    byPurchase.get(purchaseId).push(row);
  };

  const supplierControl = await db.query(
    `
    SELECT
      scl.purchase_id,
      scl.match_status AS link_match_status,
      psi.id AS supplier_invoice_id,
      psi.invoice_number,
      psi.payment_status,
      psi.paid,
      psi.alta_business_status,
      psi.supplier_control_status
    FROM supplier_control_document_links scl
    JOIN pennylane_supplier_invoices psi
      ON psi.id = scl.pennylane_supplier_invoice_id
     AND psi.store_id = scl.store_id
    WHERE scl.store_id = $1
      AND scl.purchase_id = ANY($2::uuid[])
      AND scl.match_status <> 'removed'
      AND psi.pennylane_deleted_at IS NULL
    `,
    [storeId, ids]
  ).catch((error) => {
    if (error.code === '42P01' || error.code === '42703') return { rows: [] };
    throw error;
  });
  supplierControl.rows.forEach(addRow);

  const automaticPennylane = await db.query(
    `
    SELECT
      mr.purchase_id,
      mr.match_status AS link_match_status,
      psi.id AS supplier_invoice_id,
      psi.invoice_number,
      psi.payment_status,
      psi.paid,
      psi.alta_business_status,
      psi.supplier_control_status
    FROM pennylane_supplier_invoice_match_results mr
    JOIN pennylane_supplier_invoices psi
      ON psi.id = mr.supplier_invoice_id
     AND psi.store_id = mr.store_id
    WHERE mr.store_id = $1
      AND mr.purchase_id = ANY($2::uuid[])
      AND psi.pennylane_deleted_at IS NULL
    `,
    [storeId, ids]
  ).catch((error) => {
    if (error.code === '42P01' || error.code === '42703') return { rows: [] };
    throw error;
  });
  automaticPennylane.rows.forEach(addRow);

  const legacyAlta = await db.query(
    `
    SELECT
      sim.purchase_id,
      sim.match_status AS link_match_status,
      si.id AS supplier_invoice_id,
      si.invoice_number,
      si.status AS alta_business_status,
      si.pennylane_status AS payment_status,
      NULL::text AS supplier_control_status,
      false AS paid
    FROM supplier_invoice_matches sim
    JOIN supplier_invoices si
      ON si.id = sim.supplier_invoice_id
     AND si.store_id = sim.store_id
    WHERE sim.store_id = $1
      AND sim.purchase_id = ANY($2::uuid[])
      AND COALESCE(si.status, '') <> 'cancelled'
    `,
    [storeId, ids]
  ).catch((error) => {
    if (error.code === '42P01' || error.code === '42703') return { rows: [] };
    throw error;
  });
  legacyAlta.rows.forEach(addRow);

  return byPurchase;
}

async function enrichPurchasesWithSupplierInvoiceStatus(db, { storeId, purchases }) {
  const rows = Array.isArray(purchases) ? purchases : [];
  if (!rows.length) return rows;

  const linksByPurchase = await loadSupplierInvoiceLinksForPurchases(db, {
    storeId,
    purchaseIds: rows.map((purchase) => purchase.id),
  });

  return rows.map((purchase) => ({
    ...purchase,
    ...resolveSupplierInvoiceDisplayStatus(purchase, linksByPurchase.get(clean(purchase.id)) || []),
  }));
}

module.exports = {
  DISPLAY_LABELS,
  enrichPurchasesWithSupplierInvoiceStatus,
  loadSupplierInvoiceLinksForPurchases,
  resolveSupplierInvoiceDisplayStatus,
};
