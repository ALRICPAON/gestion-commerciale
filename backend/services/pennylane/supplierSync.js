const {
  buildExternalReference,
  compactObject,
  normalizeCountry,
  processPennylanePartnerSyncQueue,
} = require('./partnerSync');

const SUPPLIER_ENTITY_TYPE = 'supplier';
const SUPPLIER_CREATE_ACTION = 'supplier.create';
const SUPPLIER_UPDATE_ACTION = 'supplier.update';

function normalizeRegistrationNumbers(siret) {
  const digits = String(siret || '').replace(/\D/g, '');

  return compactObject({
    establishment_no: digits.length === 14 ? digits : null,
    reg_no: digits.length === 9 ? digits : null,
  });
}

function buildPennylaneSupplierPayload(supplier) {
  const fullAddress = [supplier.address_line1, supplier.address_line2].filter(Boolean).join('\n');
  const postalAddress = compactObject({
    address: fullAddress || supplier.city || 'Adresse non renseignee',
    postal_code: supplier.postal_code,
    city: supplier.city || 'Non renseigne',
    country_alpha2: normalizeCountry(supplier.country),
  });

  return compactObject({
    name: supplier.legal_name || supplier.name,
    vat_number: supplier.vat_number,
    postal_address: postalAddress,
    emails: supplier.email ? [supplier.email] : [],
    external_reference: buildExternalReference(SUPPLIER_ENTITY_TYPE, supplier),
    ...normalizeRegistrationNumbers(supplier.siret),
  });
}

const supplierSyncConfig = {
  actions: [SUPPLIER_CREATE_ACTION, SUPPLIER_UPDATE_ACTION],
  buildPayload: buildPennylaneSupplierPayload,
  createEndpoint: '/suppliers',
  deferredMessage: 'Synchronisation fournisseur Pennylane reportee car un autre job du meme fournisseur est deja en cours.',
  entityType: SUPPLIER_ENTITY_TYPE,
  fetchSql: `
    SELECT
      id, store_id, code, name, legal_name, status,
      contact_name, phone, mobile, email,
      address_line1, address_line2, postal_code, city, country,
      vat_number, siret, payment_terms, notes,
      pennylane_supplier_id
    FROM suppliers
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
  `,
  finalFailureMessage: 'Synchronisation fournisseur Pennylane en echec definitif.',
  listEndpoint: '/suppliers',
  listResponseKey: 'suppliers',
  lockNamespace: 'pennylane:supplier-sync',
  lockReleaseWarning: 'Impossible de liberer le verrou Pennylane fournisseur',
  markFailureSql: `
    UPDATE suppliers
    SET
      pennylane_sync_status = 'failed',
      pennylane_sync_last_error = $1,
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
  `,
  markProcessingSql: `
    UPDATE suppliers
    SET
      pennylane_sync_status = 'processing',
      pennylane_sync_last_error = NULL,
      pennylane_sync_updated_at = now()
    WHERE id = $1
      AND store_id = $2
  `,
  markSuccessSql: `
    UPDATE suppliers
    SET
      pennylane_supplier_id = $1,
      pennylane_sync_status = 'success',
      pennylane_sync_last_error = NULL,
      pennylane_synced_at = now(),
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
  `,
  missingRemoteIdMessage: 'Pennylane n a pas retourne d identifiant fournisseur exploitable',
  notFoundMessage: 'Fournisseur ALTA introuvable pour la synchronisation Pennylane',
  pennylaneIdColumn: 'pennylane_supplier_id',
  referenceKey: 'supplier_id',
  responseKey: 'supplier',
  retryFailureMessage: 'Synchronisation fournisseur Pennylane en echec, nouvelle tentative planifiee.',
  successMessage: 'Fournisseur synchronise avec Pennylane.',
  updateEndpoint: (id) => `/suppliers/${id}`,
  workerName: 'pennylane-supplier-worker',
};

async function processPennylaneSupplierSyncQueue(db, options = {}) {
  return processPennylanePartnerSyncQueue(db, supplierSyncConfig, options);
}

module.exports = {
  SUPPLIER_CREATE_ACTION,
  SUPPLIER_ENTITY_TYPE,
  SUPPLIER_UPDATE_ACTION,
  buildPennylaneSupplierPayload,
  processPennylaneSupplierSyncQueue,
};
