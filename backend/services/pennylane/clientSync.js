const {
  buildExternalReference,
  compactObject,
  normalizeCountry,
  normalizePaymentConditions,
  processPennylanePartnerSyncQueue,
} = require('./partnerSync');
const {
  CLIENT_CREATE_ACTION,
  CLIENT_ENTITY_TYPE,
  CLIENT_UPDATE_ACTION,
} = require('./syncQueue');

function buildPennylaneCompanyCustomerPayload(client) {
  const fullAddress = [client.address_line1, client.address_line2].filter(Boolean).join('\n');
  const billingAddress = compactObject({
    address: fullAddress || client.city || 'Adresse non renseignee',
    postal_code: client.postal_code,
    city: client.city || 'Non renseigne',
    country_alpha2: normalizeCountry(client.country),
  });

  return compactObject({
    name: client.legal_name || client.name,
    vat_number: client.vat_number,
    reg_no: client.siret,
    phone: client.phone || client.mobile,
    billing_address: billingAddress,
    delivery_address: billingAddress,
    payment_conditions: normalizePaymentConditions(client.payment_terms),
    recipient: client.contact_name,
    reference: client.code,
    notes: client.notes,
    emails: client.email ? [client.email] : [],
    external_reference: buildExternalReference(CLIENT_ENTITY_TYPE, client),
    billing_language: 'fr_FR',
  });
}

const clientSyncConfig = {
  actions: [CLIENT_CREATE_ACTION, CLIENT_UPDATE_ACTION],
  buildPayload: buildPennylaneCompanyCustomerPayload,
  createEndpoint: '/company_customers',
  deferredMessage: 'Synchronisation client Pennylane reportee car un autre job du meme client est deja en cours.',
  entityType: CLIENT_ENTITY_TYPE,
  fetchSql: `
    SELECT
      id, store_id, code, name, legal_name, status,
      contact_name, phone, mobile, email,
      address_line1, address_line2, postal_code, city, country,
      vat_number, siret, payment_terms, notes,
      pennylane_customer_id
    FROM clients
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
  `,
  finalFailureMessage: 'Synchronisation client Pennylane en echec definitif.',
  listEndpoint: '/customers',
  listResponseKey: 'customers',
  lockNamespace: 'pennylane:client-sync',
  lockReleaseWarning: 'Impossible de liberer le verrou Pennylane client',
  markFailureSql: `
    UPDATE clients
    SET
      pennylane_sync_status = 'failed',
      pennylane_sync_last_error = $1,
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
  `,
  markProcessingSql: `
    UPDATE clients
    SET
      pennylane_sync_status = 'processing',
      pennylane_sync_last_error = NULL,
      pennylane_sync_updated_at = now()
    WHERE id = $1
      AND store_id = $2
  `,
  markSuccessSql: `
    UPDATE clients
    SET
      pennylane_customer_id = $1,
      pennylane_sync_status = 'success',
      pennylane_sync_last_error = NULL,
      pennylane_synced_at = now(),
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
  `,
  missingRemoteIdMessage: 'Pennylane n a pas retourne d identifiant client exploitable',
  notFoundMessage: 'Client ALTA introuvable pour la synchronisation Pennylane',
  pennylaneIdColumn: 'pennylane_customer_id',
  referenceKey: 'customer_id',
  responseKey: 'company_customer',
  retryFailureMessage: 'Synchronisation client Pennylane en echec, nouvelle tentative planifiee.',
  successMessage: 'Client synchronise avec Pennylane.',
  updateEndpoint: (id) => `/company_customers/${id}`,
  workerName: 'pennylane-client-worker',
};

async function processPennylaneClientSyncQueue(db, options = {}) {
  return processPennylanePartnerSyncQueue(db, clientSyncConfig, options);
}

module.exports = {
  buildPennylaneCompanyCustomerPayload,
  processPennylaneClientSyncQueue,
};
