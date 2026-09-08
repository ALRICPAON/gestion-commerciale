const CANONICAL_SUPPLIER_CONTROL_STATUSES = new Set([
  'a_rapprocher',
  'a_controler',
  'ecart',
  'avoir_attendu',
  'conforme',
  'valide_a_payer',
  'paye',
  'litige',
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isPaidStatus(paymentStatus, paid) {
  const status = clean(paymentStatus)?.toLowerCase() || '';
  return paid === true || status === 'paid' || status.startsWith('paid_');
}

function canonicalSupplierControlStatus(document = {}) {
  if (isPaidStatus(document.payment_status, document.paid)) return 'paye';

  const paymentStatus = clean(document.payment_status)?.toLowerCase();
  const altaStatus = clean(document.alta_business_status)?.toLowerCase();
  const current = clean(document.supplier_control_status)?.toLowerCase();

  if (['litige', 'refusee'].includes(altaStatus)) return 'litige';
  if (paymentStatus === 'to_be_paid' || altaStatus === 'validee_a_payer') return 'valide_a_payer';
  if (altaStatus === 'conforme') return 'conforme';
  if (['ecart_prix', 'ecart_quantite', 'ecart_tva'].includes(altaStatus)) return 'ecart';
  if (['analyse_automatique', 'en_controle', 'article_inconnu', 'controle_manuel'].includes(altaStatus)) {
    return 'a_controler';
  }
  if (current && CANONICAL_SUPPLIER_CONTROL_STATUSES.has(current)) return current;

  return 'a_rapprocher';
}

async function getSupplierControlDocument(db, { storeId, pennylaneSupplierInvoiceId }) {
  const document = await db.query(
    `
    SELECT
      psi.*,
      s.name AS supplier_name,
      s.code AS supplier_code
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s
      ON s.id = psi.supplier_id
     AND s.store_id = psi.store_id
    WHERE psi.id = $1
      AND psi.store_id = $2
      AND psi.pennylane_deleted_at IS NULL
    LIMIT 1
    `,
    [pennylaneSupplierInvoiceId, storeId]
  );

  const row = document.rows[0] || null;
  if (!row) return null;

  const [links, events] = await Promise.all([
    db.query(
      `
      SELECT
        scl.*,
        p.bl_number,
        p.receipt_date,
        pl.line_number AS purchase_line_number
      FROM supplier_control_document_links scl
      LEFT JOIN purchases p
        ON p.id = scl.purchase_id
       AND p.store_id = scl.store_id
      LEFT JOIN purchase_lines pl
        ON pl.id = scl.purchase_line_id
       AND pl.store_id = scl.store_id
      WHERE scl.pennylane_supplier_invoice_id = $1
        AND scl.store_id = $2
      ORDER BY scl.created_at ASC, scl.id ASC
      `,
      [row.id, storeId]
    ),
    db.query(
      `
      SELECT *
      FROM supplier_control_events
      WHERE pennylane_supplier_invoice_id = $1
        AND store_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 100
      `,
      [row.id, storeId]
    ),
  ]);

  return {
    document: {
      ...row,
      supplier_control_status: canonicalSupplierControlStatus(row),
    },
    links: links.rows,
    events: events.rows,
  };
}

module.exports = {
  CANONICAL_SUPPLIER_CONTROL_STATUSES,
  canonicalSupplierControlStatus,
  getSupplierControlDocument,
  isPaidStatus,
};
