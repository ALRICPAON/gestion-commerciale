function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeEmail(value) {
  const email = clean(value);
  if (!email) return null;
  const normalized = email.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function uniqueEmails(rows = []) {
  const seen = new Set();
  const recipients = [];

  rows.forEach((row) => {
    const email = normalizeEmail(row.email);
    if (!email || seen.has(email)) return;
    seen.add(email);
    recipients.push({
      email,
      source: row.source,
      contact_id: row.contact_id || null,
      contact_name: row.contact_name || null,
    });
  });

  return recipients;
}

const CLIENT_DOCUMENT_COLUMNS = {
  order_confirmation: 'receives_orders',
  delivery_note: 'receives_delivery_notes',
  invoice: 'receives_invoices',
  credit_note: 'receives_credit_notes',
  price_list: 'receives_price_lists',
  statement: 'receives_statements',
  promotion: 'receives_promotions',
};

const SUPPLIER_DOCUMENT_COLUMNS = {
  purchase_order: 'receives_purchase_orders',
  price_request: 'receives_price_requests',
  delivery_claim: 'receives_delivery_claims',
  accounting_document: 'receives_accounting_documents',
};

async function resolveClientRecipients(db, { storeId, entityId, documentType }) {
  const preferenceColumn = CLIENT_DOCUMENT_COLUMNS[documentType];
  if (!preferenceColumn) {
    const error = new Error(`Type de document client non gere: ${documentType}`);
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const preferred = await db.query(
    `
    SELECT id AS contact_id, contact_name, email, 'contact_preference' AS source
    FROM client_contacts
    WHERE store_id = $1 AND client_id = $2 AND status = 'active' AND ${preferenceColumn} = true
    ORDER BY is_primary DESC, contact_name ASC
    `,
    [storeId, entityId]
  );
  let recipients = uniqueEmails(preferred.rows);
  if (recipients.length) return { recipients, source: 'contact_preference' };

  const primary = await db.query(
    `
    SELECT id AS contact_id, contact_name, email, 'primary_contact' AS source
    FROM client_contacts
    WHERE store_id = $1 AND client_id = $2 AND status = 'active'
      AND (is_primary = true OR is_default_for_orders = true OR is_default_for_delivery_notes = true OR is_default_for_invoices = true)
    ORDER BY is_primary DESC, is_default_for_invoices DESC, is_default_for_delivery_notes DESC, is_default_for_orders DESC, contact_name ASC
    `,
    [storeId, entityId]
  );
  recipients = uniqueEmails(primary.rows);
  if (recipients.length) return { recipients, source: 'primary_contact' };

  const fallback = await db.query(
    `
    SELECT NULL::uuid AS contact_id, contact_name, email, 'legacy_client_email' AS source
    FROM clients
    WHERE store_id = $1 AND id = $2
    LIMIT 1
    `,
    [storeId, entityId]
  );
  recipients = uniqueEmails(fallback.rows);
  if (recipients.length) return { recipients, source: 'legacy_client_email' };

  return { recipients: [], source: null };
}

async function resolveSupplierRecipients(db, { storeId, entityId, documentType }) {
  const preferenceColumn = SUPPLIER_DOCUMENT_COLUMNS[documentType];
  if (!preferenceColumn) {
    const error = new Error(`Type de document fournisseur non gere: ${documentType}`);
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const preferred = await db.query(
    `
    SELECT id AS contact_id, contact_name, email, 'contact_preference' AS source
    FROM supplier_contacts
    WHERE store_id = $1 AND supplier_id = $2 AND status = 'active' AND ${preferenceColumn} = true
    ORDER BY is_primary DESC, contact_name ASC
    `,
    [storeId, entityId]
  );
  let recipients = uniqueEmails(preferred.rows);
  if (recipients.length) return { recipients, source: 'contact_preference' };

  const primary = await db.query(
    `
    SELECT id AS contact_id, contact_name, email, 'primary_contact' AS source
    FROM supplier_contacts
    WHERE store_id = $1 AND supplier_id = $2 AND status = 'active' AND is_primary = true
    ORDER BY contact_name ASC
    `,
    [storeId, entityId]
  );
  recipients = uniqueEmails(primary.rows);
  if (recipients.length) return { recipients, source: 'primary_contact' };

  const fallback = await db.query(
    `
    SELECT NULL::uuid AS contact_id, contact_name, email, 'legacy_supplier_email' AS source
    FROM suppliers
    WHERE store_id = $1 AND id = $2
    LIMIT 1
    `,
    [storeId, entityId]
  );
  recipients = uniqueEmails(fallback.rows);
  if (recipients.length) return { recipients, source: 'legacy_supplier_email' };

  return { recipients: [], source: null };
}

async function resolveDocumentRecipients(db, { entityType, entityId, documentType, storeId }) {
  if (entityType === 'client') {
    return resolveClientRecipients(db, { storeId, entityId, documentType });
  }
  if (entityType === 'supplier') {
    return resolveSupplierRecipients(db, { storeId, entityId, documentType });
  }

  const error = new Error(`Type de tiers non gere: ${entityType}`);
  error.status = 400;
  error.expose = true;
  throw error;
}

function recipientsToEmailList(resolution) {
  return (resolution?.recipients || []).map((recipient) => recipient.email);
}

module.exports = {
  normalizeEmail,
  resolveDocumentRecipients,
  recipientsToEmailList,
};
