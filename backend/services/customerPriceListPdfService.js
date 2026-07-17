const { renderHtmlToPdf } = require('./pdf/pdfRenderer');
const {
  customerPriceListFilename,
  renderCustomerPriceListPdf,
} = require('./pdf/templates/customerPriceListPdfTemplate');
const { decorateLineWithDisplayedPrices } = require('./royaleMareeCommission');

const VALID_TARIFF_LEVELS = new Set([1, 2, 3]);
const MISSING_MERCURIALE_TARGET_ERROR = 'Client ou niveau tarifaire requis pour générer la mercuriale';

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeTariffLevel(value) {
  const parsed = Number(value);
  return VALID_TARIFF_LEVELS.has(parsed) ? parsed : null;
}

function resolveClientPricingLevel(client = {}) {
  const safeClient = client || {};
  return normalizeTariffLevel(safeClient.tariff_level)
    || normalizeTariffLevel(safeClient.parent_tariff_level)
    || normalizeTariffLevel(safeClient.billed_tariff_level);
}

function resolveTargetTariff({ explicitTariffLevel, priceList, client } = {}) {
  return normalizeTariffLevel(explicitTariffLevel)
    || normalizeTariffLevel(priceList?.tariff_level)
    || resolveClientPricingLevel(client);
}

async function fetchStoreSettings(db, storeId) {
  const result = await db.query(
    `
    SELECT company_name, logo_url, address_line1, address_line2, postal_code, city, country,
      phone, contact_email, email, email_sender_address,
      siret, vat_number, sanitary_approval_number, iban, bic,
      payment_terms, legal_mentions, terms_and_conditions, delivery_note_footer, invoice_footer,
      royale_maree_commission_eur_per_kg
    FROM store_settings
    WHERE store_id = $1
    LIMIT 1
    `,
    [storeId]
  );
  return result.rows[0] || {};
}

async function fetchPriceListHeader(db, storeId, priceListId) {
  const result = await db.query(
    `
    SELECT
      cpl.*,
      cl.name AS client_name,
      cl.code AS client_code,
      cl.legal_name AS client_legal_name
    FROM customer_price_lists cpl
    LEFT JOIN clients cl ON cl.id = cpl.client_id AND cl.store_id = cpl.store_id
    WHERE cpl.id = $1 AND cpl.store_id = $2
    LIMIT 1
    `,
    [priceListId, storeId]
  );
  return result.rows[0] || null;
}

async function fetchClient(db, storeId, clientId) {
  const id = clean(clientId);
  if (!id) return null;
  const result = await db.query(
    `
    SELECT
      c.id::text AS id,
      c.code,
      c.name,
      c.legal_name,
      c.email,
      c.tariff_level,
      COALESCE(c.is_royale_maree_member, false) AS is_royale_maree_member,
      c.parent_client_id,
      c.billed_client_id,
      parent.code AS parent_client_code,
      parent.name AS parent_client_name,
      parent.tariff_level AS parent_tariff_level,
      COALESCE(parent.is_royale_maree_member, false) AS parent_is_royale_maree_member,
      billed.code AS billed_client_code,
      billed.name AS billed_client_name,
      billed.tariff_level AS billed_tariff_level,
      COALESCE(billed.is_royale_maree_member, false) AS billed_is_royale_maree_member
    FROM clients c
    LEFT JOIN clients parent ON parent.id = c.parent_client_id AND parent.store_id = c.store_id
    LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
    WHERE c.id = $1
      AND c.store_id = $2
      AND c.status <> 'inactive'
    LIMIT 1
    `,
    [id, storeId]
  );
  return result.rows[0] || null;
}

async function fetchPriceListLines(db, storeId, priceListId) {
  const result = await db.query(
    `
    SELECT *
    FROM customer_price_list_lines
    WHERE price_list_id = $1 AND store_id = $2
    ORDER BY is_featured DESC, COALESCE(family_name, 'Autre') ASC, display_order ASC, designation_snapshot ASC
    `,
    [priceListId, storeId]
  );
  return result.rows;
}

function decoratePriceListLines(lines, { client = null, storeSettings = {}, targetTariffLevel = null } = {}) {
  return (lines || []).map((line) => decorateLineWithDisplayedPrices({
    ...line,
    tariff_level: line.tariff_level || targetTariffLevel,
  }, {
    client,
    storeSettings,
    context: {
      targetTariffLevel,
      clientOptionalTargetTariff: client ? null : targetTariffLevel,
    },
  }));
}

function linePriceForLevel(line, level) {
  if (level === 1) return line.price_level_1_ht ?? line.price_ht;
  if (level === 2) return line.price_level_2_ht ?? line.price_ht;
  if (level === 3) return line.price_level_3_ht ?? line.price_ht;
  return line.price_ht;
}

function priceListLinesForPricingLevel(lines, pricingLevel, storeSettings = {}) {
  const level = normalizeTariffLevel(pricingLevel);
  if (!level) return [];
  return (lines || []).map((line) => ({
    ...line,
    designation: line.designation_snapshot,
    display_name: line.designation_snapshot,
    stock_quantity: line.stock_quantity_snapshot,
    price_ht: linePriceForLevel(line, level),
    tariff_level: level,
  })).filter((line) => line.price_ht !== null && line.price_ht !== undefined);
}

async function fetchSavedPriceListProductsByPricingLevel(db, storeId, priceListId, storeSettings = {}) {
  const id = clean(priceListId);
  if (!id) return null;
  const lines = await fetchPriceListLines(db, storeId, id);
  return {
    1: priceListLinesForPricingLevel(lines, 1, storeSettings),
    2: priceListLinesForPricingLevel(lines, 2, storeSettings),
    3: priceListLinesForPricingLevel(lines, 3, storeSettings),
  };
}

async function buildCustomerPriceListPdfPayload(db, {
  storeId,
  priceListId,
  clientId,
  targetTariffLevel,
  resolvedTariffLevel,
  requireTargetTariff = false,
} = {}) {
  const priceList = await fetchPriceListHeader(db, storeId, priceListId);
  if (!priceList) {
    const error = new Error('Mercuriale introuvable');
    error.status = 404;
    error.expose = true;
    throw error;
  }

  const effectiveClientId = clean(clientId) || clean(priceList.client_id);
  const [client, lines, storeSettings] = await Promise.all([
    fetchClient(db, storeId, effectiveClientId),
    fetchPriceListLines(db, storeId, priceListId),
    fetchStoreSettings(db, storeId),
  ]);
  const effectiveTargetTariffLevel = resolveTargetTariff({
    explicitTariffLevel: resolvedTariffLevel || targetTariffLevel,
    priceList,
    client,
  });

  if (requireTargetTariff && !effectiveClientId && !effectiveTargetTariffLevel) {
    const error = new Error(MISSING_MERCURIALE_TARGET_ERROR);
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const pdfPriceList = {
    ...priceList,
    client_name: client?.name || client?.legal_name || priceList.client_name || '',
    tariff_level: effectiveTargetTariffLevel,
    target_tariff_level: effectiveTargetTariffLevel,
  };
  const decoratedLines = decoratePriceListLines(lines, {
    client,
    storeSettings,
    targetTariffLevel: effectiveTargetTariffLevel,
  });

  return {
    priceList: pdfPriceList,
    client,
    lines: decoratedLines,
    storeSettings,
    resolvedTariffLevel: effectiveTargetTariffLevel,
  };
}

async function generateCustomerPriceListPdf(options = {}) {
  const payload = await buildCustomerPriceListPdfPayload(options.db, options);
  const html = renderCustomerPriceListPdf(payload);
  const pdf = await renderHtmlToPdf(html, {
    format: 'A4',
    margin: { top: '9mm', right: '9mm', bottom: '9mm', left: '9mm' },
  });
  return {
    ...payload,
    html,
    pdf,
    filename: customerPriceListFilename(payload.priceList),
  };
}

module.exports = {
  MISSING_MERCURIALE_TARGET_ERROR,
  buildCustomerPriceListPdfPayload,
  decoratePriceListLines,
  fetchSavedPriceListProductsByPricingLevel,
  generateCustomerPriceListPdf,
};
