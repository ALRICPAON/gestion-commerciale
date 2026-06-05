function cleanReference(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function documentYear(documentDate = new Date()) {
  const parsed = new Date(documentDate);
  return Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isCleanSequenceReference(value, prefix) {
  return new RegExp(`^${String(prefix).toUpperCase()}-[0-9]{4}-[0-9]{5}$`).test(String(value || '').toUpperCase());
}

function isLegacyLongReference(value, prefix) {
  return new RegExp(`^${String(prefix).toUpperCase()}-[0-9]{4}-[0-9]{2}-[0-9]{2}-`, 'i').test(String(value || ''));
}

async function nextSalesDocumentReference(db, { storeId, documentType, prefix, documentDate = new Date() }) {
  const year = documentYear(documentDate);
  const normalizedType = String(documentType || '').toUpperCase();
  const normalizedPrefix = String(prefix || '').toUpperCase();
  const referencePrefix = `${normalizedPrefix}-${year}-`;
  const suffixPattern = `^${normalizedPrefix}-${year}-([0-9]+)$`;

  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`sales-reference:${storeId}:${normalizedType}:${year}`]);

  const result = await db.query(
    `
    SELECT COALESCE(MAX((substring(reference_number FROM $3))::integer), 0) + 1 AS next_number
    FROM sales_documents
    WHERE store_id = $1
      AND UPPER(document_type) = $2
      AND reference_number LIKE $4
      AND substring(reference_number FROM $3) IS NOT NULL
    `,
    [storeId, normalizedType, suffixPattern, `${referencePrefix}%`]
  );

  const nextNumber = String(Number(result.rows[0]?.next_number || 1)).padStart(5, '0');
  return `${referencePrefix}${nextNumber}`;
}

function displaySalesDocumentReference(document = {}, prefix = 'DOC') {
  const normalizedPrefix = String(prefix).toUpperCase();
  const reference = cleanReference(document.reference_number);
  const shortId = cleanReference(document.id || reference).replace(/-/g, '').slice(0, 8).toUpperCase();
  if (!reference && !shortId) return '';
  if (reference && !isUuid(reference) && !isLegacyLongReference(reference, normalizedPrefix)) return reference;

  const year = documentYear(document.document_date || document.created_at || new Date());
  if (isCleanSequenceReference(reference, normalizedPrefix)) return reference;
  return `${normalizedPrefix}-${year}-${shortId || 'ANCIEN'}`;
}

module.exports = {
  displaySalesDocumentReference,
  nextSalesDocumentReference,
};
