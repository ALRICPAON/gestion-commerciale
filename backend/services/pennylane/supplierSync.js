const { createPennylaneClient } = require('./client');
const { getPennylaneConfig } = require('./config');
const { analyzePennylaneSupplierInvoice } = require('../supplierInvoiceMatchingEngine');
const {
  buildExternalReference,
  compactObject,
  normalizeCountry,
  processPennylanePartnerSyncQueue,
} = require('./partnerSync');

const SUPPLIER_ENTITY_TYPE = 'supplier';
const SUPPLIER_CREATE_ACTION = 'supplier.create';
const SUPPLIER_UPDATE_ACTION = 'supplier.update';
const DEFAULT_INBOUND_SUPPLIER_LIMIT = 100;
const DEFAULT_MATCHING_RERUN_LIMIT = 20;

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

function extractList(responseBody, listKey) {
  if (!responseBody || typeof responseBody !== 'object') return [];
  if (Array.isArray(responseBody.items)) return responseBody.items;
  if (Array.isArray(responseBody.data)) return responseBody.data;
  if (listKey && Array.isArray(responseBody[listKey])) return responseBody[listKey];
  return [];
}

function hasMore(responseBody) {
  return Boolean(responseBody?.has_more || responseBody?.meta?.has_more);
}

function nextCursor(responseBody) {
  return responseBody?.next_cursor || responseBody?.meta?.next_cursor || null;
}

function firstPresent(object, keys) {
  if (!object || typeof object !== 'object') return null;

  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') {
      return object[key];
    }
  }

  return null;
}

function nestedFirstPresent(object, keys) {
  const direct = firstPresent(object, keys);
  if (direct !== null && direct !== undefined && direct !== '') return direct;
  if (!object || typeof object !== 'object') return null;

  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') {
      const nested = nestedFirstPresent(value, keys);
      if (nested !== null && nested !== undefined && nested !== '') return nested;
    }
  }

  return null;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(sarl|sas|sa|eurl|sasu|societe|ste|ets|etablissements)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVatNumber(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return text || null;
}

function supplierDisplayName(pennylaneSupplier) {
  return normalizeText(
    firstPresent(pennylaneSupplier, ['name', 'company_name', 'legal_name', 'display_name']) ||
      nestedFirstPresent(pennylaneSupplier, ['name'])
  );
}

function supplierVatNumber(pennylaneSupplier) {
  return normalizeVatNumber(nestedFirstPresent(pennylaneSupplier, ['vat_number', 'vat_no', 'tax_number']));
}

function supplierSiret(pennylaneSupplier) {
  const direct = nestedFirstPresent(pennylaneSupplier, [
    'establishment_no',
    'siret',
    'siret_number',
    'registration_number',
  ]);
  const digits = normalizeDigits(direct);
  if (digits?.length === 14) return digits;

  const regNo = normalizeDigits(nestedFirstPresent(pennylaneSupplier, ['reg_no']));
  return regNo?.length === 14 ? regNo : null;
}

function supplierPostalAddress(pennylaneSupplier) {
  return (
    pennylaneSupplier?.postal_address ||
    pennylaneSupplier?.address ||
    pennylaneSupplier?.billing_address ||
    pennylaneSupplier?.main_address ||
    {}
  );
}

function supplierEmail(pennylaneSupplier) {
  const emails = firstPresent(pennylaneSupplier, ['emails']);
  if (Array.isArray(emails)) return normalizeText(emails[0]);
  return normalizeText(firstPresent(pennylaneSupplier, ['email']));
}

function supplierCountry(address) {
  return normalizeText(firstPresent(address, ['country', 'country_alpha2', 'country_code'])) || 'France';
}

function makeCodeBase(name) {
  const normalized = String(name || 'FOURNISSEUR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
  return (normalized || 'FOURNISSEUR').slice(0, 12);
}

async function generateSupplierCode(db, storeId, name) {
  const base = makeCodeBase(name);

  for (let index = 0; index < 1000; index += 1) {
    const code = index === 0 ? base : `${base}${String(index + 1).padStart(2, '0')}`;
    const existing = await db.query(
      `
      SELECT 1
      FROM suppliers
      WHERE store_id = $1
        AND UPPER(code) = UPPER($2)
      LIMIT 1
      `,
      [storeId, code]
    );

    if (!existing.rows.length) return code;
  }

  return `${base}${Date.now()}`;
}

async function listStoresForInboundSupplierSync(db, storeId = null) {
  if (storeId) return [{ store_id: storeId }];

  const result = await db.query(
    `
    SELECT DISTINCT store_id
    FROM (
      SELECT store_id
      FROM suppliers
      WHERE store_id IS NOT NULL
      UNION
      SELECT store_id
      FROM pennylane_supplier_invoices
      WHERE store_id IS NOT NULL
        AND NULLIF(TRIM(COALESCE(pennylane_supplier_id, '')), '') IS NOT NULL
    ) stores
    ORDER BY store_id
    `
  );

  return result.rows;
}

async function fetchPennylaneSuppliers(pennylaneClient, limit) {
  const suppliers = [];
  let endpoint = `/suppliers?limit=${encodeURIComponent(limit)}`;

  while (endpoint) {
    const response = await pennylaneClient.get(endpoint);
    suppliers.push(...extractList(response.body, 'suppliers'));

    if (!hasMore(response.body)) break;
    const cursor = nextCursor(response.body);
    if (!cursor) break;

    endpoint = `/suppliers?limit=${encodeURIComponent(limit)}&cursor=${encodeURIComponent(cursor)}`;
  }

  return suppliers;
}

async function fetchPennylaneSupplierById(pennylaneClient, pennylaneSupplierId) {
  const response = await pennylaneClient.get(`/suppliers/${encodeURIComponent(pennylaneSupplierId)}`);
  if (response.body?.id) return response.body;
  if (response.body?.supplier?.id) return response.body.supplier;
  if (response.body?.data?.id) return response.body.data;
  return null;
}

async function listUnlinkedPennylaneSupplierIds(db, storeId) {
  const result = await db.query(
    `
    SELECT DISTINCT pennylane_supplier_id
    FROM pennylane_supplier_invoices
    WHERE store_id = $1
      AND supplier_id IS NULL
      AND NULLIF(TRIM(COALESCE(pennylane_supplier_id, '')), '') IS NOT NULL
    ORDER BY pennylane_supplier_id
    `,
    [storeId]
  );

  return result.rows.map((row) => String(row.pennylane_supplier_id));
}

async function findSupplierByPennylaneId(db, storeId, pennylaneSupplierId) {
  if (!pennylaneSupplierId) return null;

  const result = await db.query(
    `
    SELECT *
    FROM suppliers
    WHERE store_id = $1
      AND pennylane_supplier_id::text = $2::text
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
    `,
    [storeId, String(pennylaneSupplierId)]
  );

  return result.rows[0] || null;
}

async function findSupplierByRegistration(db, storeId, { siret, vatNumber }) {
  const conditions = [];
  const params = [storeId];

  if (siret) {
    params.push(siret);
    conditions.push(`regexp_replace(COALESCE(siret, ''), '\\D', '', 'g') = $${params.length}`);
  }

  if (vatNumber) {
    params.push(vatNumber);
    conditions.push(`regexp_replace(UPPER(COALESCE(vat_number, '')), '[^A-Z0-9]', '', 'g') = $${params.length}`);
  }

  if (!conditions.length) return null;

  const result = await db.query(
    `
    SELECT *
    FROM suppliers
    WHERE store_id = $1
      AND (${conditions.join(' OR ')})
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function findSupplierByNormalizedName(db, storeId, name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;
  const [firstToken] = normalizedName.split(/\s+/);
  const search = firstToken ? `%${firstToken}%` : `%${name}%`;

  const result = await db.query(
    `
    SELECT *
    FROM suppliers
    WHERE store_id = $1
      AND (
        name ILIKE $2
        OR legal_name ILIKE $2
      )
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 50
    `,
    [storeId, search]
  );

  return result.rows.find((supplier) => (
    normalizeName(supplier.legal_name) === normalizedName ||
    normalizeName(supplier.name) === normalizedName
  )) || null;
}

async function findAltaSupplierForPennylaneSupplier(db, storeId, pennylaneSupplier) {
  const pennylaneSupplierId = firstPresent(pennylaneSupplier, ['id']);
  const name = supplierDisplayName(pennylaneSupplier);
  const siret = supplierSiret(pennylaneSupplier);
  const vatNumber = supplierVatNumber(pennylaneSupplier);

  return (
    (await findSupplierByPennylaneId(db, storeId, pennylaneSupplierId)) ||
    (await findSupplierByRegistration(db, storeId, { siret, vatNumber })) ||
    (await findSupplierByNormalizedName(db, storeId, name))
  );
}

function mapPennylaneSupplierToAlta(pennylaneSupplier) {
  const address = supplierPostalAddress(pennylaneSupplier);
  const name = supplierDisplayName(pennylaneSupplier);

  return {
    name,
    legal_name: normalizeText(firstPresent(pennylaneSupplier, ['legal_name', 'company_name'])) || name,
    supplier_type: 'standard',
    status: 'active',
    email: supplierEmail(pennylaneSupplier),
    phone: normalizeText(firstPresent(pennylaneSupplier, ['phone', 'mobile'])),
    address_line1: normalizeText(firstPresent(address, ['address', 'address_line1', 'street'])),
    postal_code: normalizeText(firstPresent(address, ['postal_code', 'zip_code'])),
    city: normalizeText(firstPresent(address, ['city'])),
    country: supplierCountry(address),
    vat_number: supplierVatNumber(pennylaneSupplier),
    siret: supplierSiret(pennylaneSupplier),
  };
}

async function upsertAltaSupplierFromPennylane(db, storeId, pennylaneSupplier) {
  const pennylaneSupplierId = firstPresent(pennylaneSupplier, ['id']);
  const mappedSupplier = mapPennylaneSupplierToAlta(pennylaneSupplier);

  if (!pennylaneSupplierId || !mappedSupplier.name) {
    return { skipped: true, reason: 'missing_id_or_name' };
  }

  const existingSupplier = await findAltaSupplierForPennylaneSupplier(db, storeId, pennylaneSupplier);

  if (existingSupplier) {
    const updated = await db.query(
      `
      UPDATE suppliers
      SET pennylane_supplier_id = $3,
        legal_name = COALESCE(NULLIF(legal_name, ''), $4),
        vat_number = COALESCE(NULLIF(vat_number, ''), $5),
        siret = COALESCE(NULLIF(siret, ''), $6),
        email = COALESCE(NULLIF(email, ''), $7),
        phone = COALESCE(NULLIF(phone, ''), $8),
        address_line1 = COALESCE(NULLIF(address_line1, ''), $9),
        postal_code = COALESCE(NULLIF(postal_code, ''), $10),
        city = COALESCE(NULLIF(city, ''), $11),
        country = COALESCE(NULLIF(country, ''), $12),
        pennylane_sync_status = 'success',
        pennylane_sync_last_error = NULL,
        pennylane_synced_at = now(),
        pennylane_sync_updated_at = now(),
        updated_at = now()
      WHERE id = $1
        AND store_id = $2
      RETURNING *
      `,
      [
        existingSupplier.id,
        storeId,
        String(pennylaneSupplierId),
        mappedSupplier.legal_name,
        mappedSupplier.vat_number,
        mappedSupplier.siret,
        mappedSupplier.email,
        mappedSupplier.phone,
        mappedSupplier.address_line1,
        mappedSupplier.postal_code,
        mappedSupplier.city,
        mappedSupplier.country,
      ]
    );

    return { supplier: updated.rows[0], mode: 'linked_or_updated' };
  }

  const code = await generateSupplierCode(db, storeId, mappedSupplier.name);
  const inserted = await db.query(
    `
    INSERT INTO suppliers (
      store_id,
      code,
      name,
      legal_name,
      supplier_type,
      status,
      email,
      phone,
      address_line1,
      postal_code,
      city,
      country,
      vat_number,
      siret,
      pennylane_supplier_id,
      pennylane_sync_status,
      pennylane_sync_last_error,
      pennylane_synced_at,
      pennylane_sync_updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15,
      'success', NULL, now(), now()
    )
    RETURNING *
    `,
    [
      storeId,
      code,
      mappedSupplier.name,
      mappedSupplier.legal_name,
      mappedSupplier.supplier_type,
      mappedSupplier.status,
      mappedSupplier.email,
      mappedSupplier.phone,
      mappedSupplier.address_line1,
      mappedSupplier.postal_code,
      mappedSupplier.city,
      mappedSupplier.country,
      mappedSupplier.vat_number,
      mappedSupplier.siret,
      String(pennylaneSupplierId),
    ]
  );

  return { supplier: inserted.rows[0], mode: 'created' };
}

async function attachExistingInvoicesToSupplier(db, storeId, pennylaneSupplierId, supplierId) {
  const result = await db.query(
    `
    UPDATE pennylane_supplier_invoices
    SET supplier_id = $3,
      last_synced_at = now(),
      auto_matched_at = NULL,
      updated_at = now()
    WHERE store_id = $1
      AND pennylane_supplier_id::text = $2::text
      AND supplier_id IS DISTINCT FROM $3
    RETURNING id, pennylane_supplier_invoice_id
    `,
    [storeId, String(pennylaneSupplierId), supplierId]
  );

  return result.rows;
}

async function rerunMatchingForInvoices(db, storeId, invoices, limit) {
  let matched = 0;
  let failed = 0;

  for (const invoice of invoices.slice(0, limit)) {
    try {
      await analyzePennylaneSupplierInvoice(db, {
        invoiceId: invoice.id,
        storeId,
      });
      matched += 1;
    } catch (err) {
      failed += 1;
      console.error('[Pennylane supplier sync] erreur relance matching facture fournisseur', {
        store_id: storeId,
        local_invoice_id: invoice.id,
        pennylane_supplier_invoice_id: invoice.pennylane_supplier_invoice_id,
        message: err.message,
        code: err.code || null,
        detail: err.detail || null,
      });
    }
  }

  return { matched, failed };
}

async function processInboundPennylaneSuppliers(db, pennylaneClient, options = {}) {
  const limit = Number(options.supplierLimit || process.env.PENNYLANE_SUPPLIER_INBOUND_LIMIT) || DEFAULT_INBOUND_SUPPLIER_LIMIT;
  const matchingLimit = Number(options.matchingLimit || process.env.PENNYLANE_SUPPLIER_MATCHING_RERUN_LIMIT) ||
    DEFAULT_MATCHING_RERUN_LIMIT;
  const stores = await listStoresForInboundSupplierSync(db, options.storeId);
  const listedPennylaneSuppliers = await fetchPennylaneSuppliers(pennylaneClient, limit);
  const listedSupplierIds = new Set(
    listedPennylaneSuppliers
      .map((supplier) => firstPresent(supplier, ['id']))
      .filter(Boolean)
      .map(String)
  );
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let attachedInvoices = 0;
  let matchingRerun = 0;
  let matchingFailed = 0;

  for (const store of stores) {
    const targetedSuppliers = [];
    const unlinkedSupplierIds = await listUnlinkedPennylaneSupplierIds(db, store.store_id);

    for (const pennylaneSupplierId of unlinkedSupplierIds) {
      if (listedSupplierIds.has(String(pennylaneSupplierId))) continue;

      try {
        const supplier = await fetchPennylaneSupplierById(pennylaneClient, pennylaneSupplierId);
        if (supplier?.id) targetedSuppliers.push(supplier);
      } catch (err) {
        failed += 1;
        console.error('[Pennylane supplier sync] erreur lecture fournisseur cible', {
          store_id: store.store_id,
          pennylane_supplier_id: String(pennylaneSupplierId),
          message: err.message,
          code: err.code || null,
          detail: err.detail || null,
        });
      }
    }

    const pennylaneSuppliers = [...targetedSuppliers, ...listedPennylaneSuppliers];

    for (const pennylaneSupplier of pennylaneSuppliers) {
      processed += 1;
      const pennylaneSupplierId = firstPresent(pennylaneSupplier, ['id']);

      try {
        const result = await upsertAltaSupplierFromPennylane(db, store.store_id, pennylaneSupplier);
        if (result.skipped) {
          skipped += 1;
          continue;
        }

        const invoices = await attachExistingInvoicesToSupplier(
          db,
          store.store_id,
          pennylaneSupplierId,
          result.supplier.id
        );
        const matching = await rerunMatchingForInvoices(db, store.store_id, invoices, matchingLimit);

        attachedInvoices += invoices.length;
        matchingRerun += matching.matched;
        matchingFailed += matching.failed;
        succeeded += 1;

        if (invoices.length) {
          console.info('[Pennylane supplier sync] fournisseur rattache aux factures', {
            store_id: store.store_id,
            pennylane_supplier_id: String(pennylaneSupplierId),
            supplier_id: result.supplier.id,
            mode: result.mode,
            attached_invoices_count: invoices.length,
            matching_rerun_count: matching.matched,
            matching_failed_count: matching.failed,
          });
        }
      } catch (err) {
        failed += 1;
        console.error('[Pennylane supplier sync] erreur rapprochement fournisseur entrant', {
          store_id: store.store_id,
          pennylane_supplier_id: pennylaneSupplierId ? String(pennylaneSupplierId) : null,
          message: err.message,
          code: err.code || null,
          detail: err.detail || null,
        });
      }
    }
  }

  return {
    processed,
    succeeded,
    failed,
    skipped,
    attachedInvoices,
    matchingRerun,
    matchingFailed,
  };
}

async function processPennylaneSupplierSyncQueue(db, options = {}) {
  const outboundResult = await processPennylanePartnerSyncQueue(db, supplierSyncConfig, options);

  if (outboundResult.skipped) {
    return outboundResult;
  }

  const pennylaneConfig = getPennylaneConfig();
  const pennylaneClient = createPennylaneClient(pennylaneConfig);
  const inboundResult = await processInboundPennylaneSuppliers(db, pennylaneClient, options);

  return {
    ...outboundResult,
    processed: outboundResult.processed + inboundResult.processed,
    succeeded: outboundResult.succeeded + inboundResult.succeeded,
    failed: outboundResult.failed + inboundResult.failed,
    skipped: false,
    inbound: inboundResult,
  };
}

module.exports = {
  SUPPLIER_CREATE_ACTION,
  SUPPLIER_ENTITY_TYPE,
  SUPPLIER_UPDATE_ACTION,
  buildPennylaneSupplierPayload,
  processPennylaneSupplierSyncQueue,
};
