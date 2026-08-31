const crypto = require('crypto');

const { sendEmail, getSmtpStatus } = require('./emailService');
const { renderHtmlToPdf } = require('./pdf/pdfRenderer');
const {
  renderMercurialePdf,
} = require('./pdf/templates/mercurialePdfTemplate');
const {
  resolveDocumentRecipients,
  recipientsToEmailList,
} = require('./documentRecipientService');
const { getCustomerDisplayedPrice } = require('./royaleMareeCommission');
const {
  fetchSavedPriceListProductsByPricingLevel,
  generateCustomerPriceListPdf,
} = require('./customerPriceListPdfService');
const pricingService = require('./pricingService');

const VALID_PRICING_LEVELS = new Set([1, 2, 3]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizePricingLevel(value) {
  const parsed = Number(value);
  return VALID_PRICING_LEVELS.has(parsed) ? parsed : null;
}

function resolveClientPricingLevel(client = {}) {
  const safeClient = client || {};

  return normalizePricingLevel(safeClient.tariff_level)
    || normalizePricingLevel(safeClient.parent_tariff_level)
    || normalizePricingLevel(safeClient.billed_tariff_level);
}

function resolveClientPricingLevelSource(client = {}) {
  const safeClient = client || {};

  if (normalizePricingLevel(safeClient.tariff_level)) return 'client';
  if (normalizePricingLevel(safeClient.parent_tariff_level)) return 'parent';
  if (normalizePricingLevel(safeClient.billed_tariff_level)) return 'billed';
  return null;
}

function resolveMercurialeTargetTariff({ targetTariffLevel, client } = {}) {
  return normalizePricingLevel(targetTariffLevel) || resolveClientPricingLevel(client);
}

function hasEmail(value) {
  return Boolean(clean(value));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(value) {
  const text = clean(value);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function generateEmailTrackingToken() {
  return crypto.randomUUID();
}

function resolvePublicApiBaseUrl(env = process.env) {
  return clean(env.PUBLIC_API_BASE_URL) || '';
}

function openTrackingStatus(env = process.env) {
  const configured = Boolean(resolvePublicApiBaseUrl(env));
  return {
    open_tracking_configured: configured,
    open_tracking_missing: configured ? [] : ['PUBLIC_API_BASE_URL'],
  };
}

function trackingTenantKey(clientKey, env = process.env) {
  const key = clean(clientKey);
  const secret = clean(env.OPEN_TRACKING_SECRET) || clean(env.JWT_SECRET) || 'alta-maree-open-tracking-dev';
  if (!key) return null;
  return crypto
    .createHmac('sha256', secret)
    .update(`customer-price-list-email:${key}`)
    .digest('base64url')
    .slice(0, 32);
}

function trackingPixelUrl(trackingToken, options = {}) {
  const baseUrl = (clean(options.publicApiBaseUrl) || resolvePublicApiBaseUrl(options.env)).replace(/\/+$/, '');
  const tenantKey = clean(options.tenantKey) || trackingTenantKey(options.clientKey, options.env);
  if (!baseUrl || !tenantKey || !clean(trackingToken)) return null;
  return `${baseUrl}/api/customer-price-lists/email/open/${encodeURIComponent(tenantKey)}/${encodeURIComponent(trackingToken)}`;
}

function appendEmailOpenTrackingPixel(html, trackingToken, options = {}) {
  const source = String(html || '');
  const url = trackingPixelUrl(trackingToken, options);
  if (!url) return source;
  const pixel = `<img src="${escapeHtml(url)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0;">`;
  return source.includes('</body>')
    ? source.replace('</body>', `${pixel}</body>`)
    : `${source}${pixel}`;
}

function formatDateFr(value) {
  const date = normalizeIsoDate(value);
  return date ? date.split('-').reverse().join('/') : '';
}

function buildPdfFilename(mercurialeDate) {
  const date = normalizeIsoDate(mercurialeDate);
  return `Mercuriale_ALTA_MAREE_${date || 'date_non_renseignee'}.pdf`;
}

function defaultCommonMessage() {
  return [
    'Veuillez trouver ci-joint notre mercuriale mise à jour.',
    '',
    "N'hésitez pas à nous contacter pour toute demande de disponibilité, de réservation ou de renseignement.",
    '',
    'Nous vous remercions de votre confiance.',
  ].join('\n');
}

function resolveCommonMessage(value) {
  return clean(value) || defaultCommonMessage();
}

function resolveCompanyEmail(storeSettings = {}) {
  return clean(storeSettings.contact_email)
    || clean(storeSettings.email)
    || clean(storeSettings.email_sender_address);
}

function resolveReplyTo(storeSettings = {}) {
  return clean(storeSettings.email_sender_address) || resolveCompanyEmail(storeSettings);
}

function resolveCompanyWebsite(storeSettings = {}) {
  return clean(storeSettings.website)
    || clean(storeSettings.site_url)
    || clean(storeSettings.website_url)
    || clean(storeSettings.company_website);
}

function resolveFirstContactName(recipientResolution = {}) {
  const recipient = (recipientResolution.recipients || []).find((entry) => clean(entry.contact_name));
  return clean(recipient?.contact_name);
}

function resolveEmailSalutation(contactName) {
  const name = clean(contactName);
  if (!name) return 'Bonjour,';

  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (parts.length >= 2 && /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'-]*$/.test(first)) {
    return `Bonjour ${first},`;
  }

  return `Bonjour ${name},`;
}

function buildSummary(recipients) {
  const summary = {
    total_clients: recipients.length,
    with_email: 0,
    without_email: 0,
    price_list_contacts: 0,
    eligible: 0,
    not_sendable: 0,
    without_tariff: 0,
    without_products: 0,
    without_price_list_contact: 0,
    fallback_recipients: 0,
    own_tariff: 0,
    parent_tariff: 0,
    billed_tariff: 0,
  };

  recipients.forEach((recipient) => {
    const hasResolvedTariff = Boolean(normalizePricingLevel(recipient.resolved_tariff_level));
    summary.price_list_contacts += Number(recipient.price_list_contact_count || 0);
    if (!recipient.price_list_contact_count) {
      summary.without_price_list_contact += 1;
    }
    if (recipient.recipient_source && !['contact_preference', 'mercuriale_contact'].includes(recipient.recipient_source)) {
      summary.fallback_recipients += 1;
    }
    if (recipient.pricing_level_source === 'client') summary.own_tariff += 1;
    if (recipient.pricing_level_source === 'parent') summary.parent_tariff += 1;
    if (recipient.pricing_level_source === 'billed') summary.billed_tariff += 1;
    if (!hasResolvedTariff) summary.without_tariff += 1;

    if (!hasEmail(recipient.email)) {
      summary.without_email += 1;
      return;
    }

    summary.with_email += 1;

    if (!hasResolvedTariff) {
      summary.not_sendable += 1;
      return;
    }

    if (!recipient.item_count) {
      summary.not_sendable += 1;
      summary.without_products += 1;
      return;
    }

    summary.eligible += 1;
  });

  return summary;
}

async function fetchStoreSettings(db, storeId) {
  const result = await db.query(
    `
    SELECT
      company_name,
      logo_url,
      address_line1,
      address_line2,
      postal_code,
      city,
      country,
      phone,
      email,
      siret,
      vat_number,
      sanitary_approval_number,
      legal_mentions,
      contact_email,
      email_sender_address,
      to_jsonb(store_settings)->>'website' AS website,
      to_jsonb(store_settings)->>'site_url' AS site_url,
      to_jsonb(store_settings)->>'website_url' AS website_url,
      to_jsonb(store_settings)->>'company_website' AS company_website,
      royale_maree_commission_eur_per_kg
    FROM store_settings
    WHERE store_id = $1
    LIMIT 1
    `,
    [storeId]
  );

  return result.rows[0] || {};
}

async function resolveMercurialeEmailContext(db, storeId, options = {}) {
  const priceListId = clean(options.price_list_id);
  const receivedMercurialeDate = normalizeIsoDate(options.mercuriale_date || options.price_list_date);
  if (priceListId) {
    const result = await db.query(
      `
      SELECT id::text AS price_list_id, price_list_date
      FROM customer_price_lists
      WHERE store_id = $1 AND id = $2
      LIMIT 1
      `,
      [storeId, priceListId]
    );
    if (!result.rows.length) {
      const error = new Error('Mercuriale introuvable pour préparer les emails');
      error.status = 404;
      error.expose = true;
      throw error;
    }
    const storedMercurialeDate = normalizeIsoDate(result.rows[0].price_list_date);
    return {
      price_list_id: result.rows[0].price_list_id,
      mercuriale_date: storedMercurialeDate || receivedMercurialeDate,
      received_mercuriale_date: receivedMercurialeDate,
      stored_mercuriale_date: storedMercurialeDate,
      resolved_mercuriale_date: storedMercurialeDate || receivedMercurialeDate,
    };
  }

  const mercurialeDate = receivedMercurialeDate;
  if (!mercurialeDate) {
    const error = new Error('Date de mercuriale requise pour préparer les emails');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  return {
    price_list_id: null,
    mercuriale_date: mercurialeDate,
    received_mercuriale_date: receivedMercurialeDate,
    stored_mercuriale_date: null,
    resolved_mercuriale_date: mercurialeDate,
  };
}

async function fetchActiveClients(db, storeId) {
  const result = await db.query(
    `
    SELECT
      c.id::text AS id,
      c.code,
      c.name,
      c.legal_name,
      c.email,
      c.tariff_level,
      parent.tariff_level AS parent_tariff_level,
      billed.tariff_level AS billed_tariff_level,
      COALESCE(c.is_royale_maree_member, false) AS is_royale_maree_member,
      c.parent_client_id,
      c.billed_client_id,
      parent.code AS parent_client_code,
      parent.name AS parent_client_name,
      COALESCE(parent.is_royale_maree_member, false) AS parent_is_royale_maree_member,
      billed.code AS billed_client_code,
      billed.name AS billed_client_name,
      COALESCE(billed.is_royale_maree_member, false) AS billed_is_royale_maree_member
    FROM clients c
    LEFT JOIN clients parent ON parent.id = c.parent_client_id AND parent.store_id = c.store_id
    LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
    WHERE c.store_id = $1
      AND c.status = 'active'
    ORDER BY COALESCE(c.name, c.legal_name, c.code) ASC
    `,
    [storeId]
  );

  return result.rows;
}

function applyDisplayedPricesForClient(products, client, storeSettings) {
  const safeClient = client || {};
  const pricingLevel = resolveClientPricingLevel(client);
  if (!pricingLevel) return [];
  return (products || []).map((product) => ({
    ...product,
    price_ht: getCustomerDisplayedPrice({
      price: product.price_ht,
      pricingLevel,
      client: safeClient,
      storeSettings,
      context: { targetTariffLevel: pricingLevel },
    }),
  }));
}

async function fetchProductsForPricingLevel(db, storeId, pricingLevel, commissionSettings = {}, mercurialeDate) {
  const normalizedPricingLevel = normalizePricingLevel(pricingLevel);
  if (!normalizedPricingLevel) return [];
  const sheetDate = normalizeIsoDate(mercurialeDate);
  if (!sheetDate) return [];

  const publishedPricing = await pricingService.getCurrentPricingSession(db, storeId, { date: sheetDate });
  if (publishedPricing.exists) {
    const levels = await pricingService.listTariffLevels(db, storeId, {});
    const tariffLevel = levels.results.find((level) => Number(level.legacy_level) === normalizedPricingLevel);
    if (tariffLevel) {
      return (publishedPricing.lines || []).filter((line) => !line.exclude_from_mercuriale && line.article_id).map((line) => {
        const tariff = (line.tariffs || []).find((item) => item.tariff_level_id === tariffLevel.id);
        return {
          article_id: line.article_id,
          plu: line.plu_snapshot,
          designation: line.designation_snapshot,
          display_name: line.designation_snapshot,
          family_name: line.family_name || 'Autre',
          sale_unit: line.sale_unit || line.price_unit,
          stock_quantity: null,
          price_ht: tariff?.price_ht ?? null,
          pricing_session_id: publishedPricing.session.id,
          pricing_line_id: line.id,
          tariff_level_id: tariffLevel.id,
        };
      }).filter((row) => row.price_ht !== null && row.price_ht !== undefined);
    }
  }

  // Compatibilite transition: anciennes dates sans publication pricing.
  const dailySheet = await db.query(
    `SELECT id
     FROM quick_order_sheets
     WHERE store_id = $1 AND sheet_date = $2::date
     LIMIT 1`,
    [storeId, sheetDate]
  );
  if (dailySheet.rows.length) {
    const dailyProducts = await db.query(
      `SELECT
         qsp.article_id::text AS article_id,
         qsp.plu,
         qsp.designation_snapshot AS designation,
         qsp.designation_snapshot AS display_name,
         COALESCE(qsp.family_name, 'Autre') AS family_name,
         COALESCE(qsp.sale_unit, qsp.price_unit) AS sale_unit,
         qsp.supplier_available_quantity AS stock_quantity,
         CASE $3::int
           WHEN 1 THEN qsp.sale_price_level_1_ht
           WHEN 2 THEN qsp.sale_price_level_2_ht
           WHEN 3 THEN qsp.sale_price_level_3_ht
         END AS price_ht
       FROM quick_order_sheet_products qsp
       WHERE qsp.store_id = $1
         AND qsp.sheet_id = $2
         AND qsp.article_id IS NOT NULL
       ORDER BY qsp.display_order ASC, qsp.designation_snapshot ASC`,
      [storeId, dailySheet.rows[0].id, normalizedPricingLevel]
    );
    return dailyProducts.rows.filter((row) => row.price_ht !== null && row.price_ht !== undefined);
  }
  return [];
}

async function fetchProductsByPricingLevel(db, storeId, commissionSettings = {}, mercurialeDate, priceListId = null) {
  if (priceListId) {
    const savedProducts = await fetchSavedPriceListProductsByPricingLevel(db, storeId, priceListId, commissionSettings);
    if (savedProducts && Object.values(savedProducts).some((products) => products.length > 0)) {
      return savedProducts;
    }
  }
  const entries = await Promise.all([1, 2, 3].map(async (level) => [
    level,
    await fetchProductsForPricingLevel(db, storeId, level, commissionSettings, mercurialeDate),
  ]));
  return Object.fromEntries(entries);
}

async function clientPreviewRow(db, storeId, client, productsByPricingLevel) {
  const safeClient = client || {};
  const pricingLevel = resolveClientPricingLevel(client);
  const pricingLevelSource = resolveClientPricingLevelSource(client);
  const clientName = safeClient.name || safeClient.legal_name || safeClient.code || safeClient.id;
  const recipientResolution = await resolveDocumentRecipients(db, {
    entityType: 'client',
    entityId: safeClient.id,
    documentType: 'price_list',
    storeId,
  });
  const recipients = recipientsToEmailList(recipientResolution);
  const email = recipients.join(', ');
  const priceListContactCount = Number(recipientResolution.preferred_count || 0);
  const itemCount = pricingLevel ? (productsByPricingLevel[pricingLevel] || []).length : 0;
  const recipientDetails = (recipientResolution.recipients || []).map((recipient) => ({
    name: recipient.contact_name || null,
    email: recipient.email,
    source: recipient.source,
  }));

  if (!hasEmail(email)) {
    return {
      client_id: safeClient.id,
      client_name: clientName,
      email: null,
      status: 'skipped_no_email',
      item_count: 0,
      recipient_source: recipientResolution.source,
      recipient_count: 0,
      recipients: [],
      price_list_contact_count: priceListContactCount,
      resolved_tariff_level: pricingLevel,
      pricing_level_source: pricingLevelSource,
    };
  }

  if (!pricingLevel) {
    return {
      client_id: safeClient.id,
      client_name: clientName,
      email,
      status: 'skipped_not_sendable',
      item_count: 0,
      recipient_source: recipientResolution.source,
      recipient_count: recipients.length,
      recipients: recipientDetails,
      price_list_contact_count: priceListContactCount,
      resolved_tariff_level: null,
      pricing_level_source: null,
    };
  }

  if (itemCount <= 0) {
    return {
      client_id: safeClient.id,
      client_name: clientName,
      email,
      status: 'skipped_no_products',
      item_count: 0,
      recipient_source: recipientResolution.source,
      recipient_count: recipients.length,
      recipients: recipientDetails,
      price_list_contact_count: priceListContactCount,
      resolved_tariff_level: pricingLevel,
      pricing_level_source: pricingLevelSource,
    };
  }

  return {
    client_id: safeClient.id,
    client_name: clientName,
    email,
    status: 'ready',
    item_count: itemCount,
    recipient_source: recipientResolution.source,
    recipient_count: recipients.length,
    recipients: recipientDetails,
    recipient_resolution: recipientResolution,
    price_list_contact_count: priceListContactCount,
    resolved_tariff_level: pricingLevel,
    pricing_level_source: pricingLevelSource,
  };
}

function isMercurialEmailSendReady(preview = {}) {
  return Boolean(preview.smtp?.configured && Number(preview.summary?.eligible || 0) > 0);
}

async function buildCustomerTariffEmailPreview(db, storeId, options = {}) {
  const context = await resolveMercurialeEmailContext(db, storeId, options);
  const commonMessage = resolveCommonMessage(options.common_message);
  const [clients, storeSettings] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchStoreSettings(db, storeId),
  ]);
  const productsByPricingLevel = await fetchProductsByPricingLevel(db, storeId, storeSettings, context.mercuriale_date, context.price_list_id);
  if (!Object.values(productsByPricingLevel).some((products) => products.length > 0)) {
    const error = new Error(`Aucune tarification fiche d'appel configurée pour le ${context.mercuriale_date}`);
    error.status = 400;
    error.expose = true;
    throw error;
  }
  const filename = buildPdfFilename(context.mercuriale_date);
  const recipients = (await Promise.all(clients.map((client) => clientPreviewRow(db, storeId, client, productsByPricingLevel))))
    .map((recipient) => {
      if (recipient.status !== 'ready') return recipient;
      const mail = buildMercurialeEmailMessage({
        companySettings: storeSettings,
        recipientResolution: recipient.recipient_resolution,
        mercurialeDate: context.mercuriale_date,
        commonMessage,
        clientTariffLevel: recipient.resolved_tariff_level,
        pdfFilename: filename,
      });
      const { recipient_resolution: ignored, ...row } = recipient;
      return { ...row, mail_preview: mail };
    });

  return {
    smtp: {
      ...getSmtpStatus(),
      ...openTrackingStatus(),
    },
    sender: resolveReplyTo(storeSettings),
    test_recipient: resolveCompanyEmail(storeSettings),
    attachment_filename: filename,
    common_message: commonMessage,
    mercuriale_date: context.mercuriale_date,
    price_list_id: context.price_list_id,
    received_mercuriale_date: context.received_mercuriale_date,
    stored_mercuriale_date: context.stored_mercuriale_date,
    resolved_mercuriale_date: context.resolved_mercuriale_date,
    summary: buildSummary(recipients),
    recipients,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function buildSubject(mercurialeDate) {
  return `Mercuriale ALTA MARÉE - Départ du ${formatDateFr(mercurialeDate)}`;
}

function buildEmailText(storeSettings, salutation = 'Bonjour,', commonMessage = defaultCommonMessage()) {
  const companyEmail = resolveCompanyEmail(storeSettings) || '';
  const website = resolveCompanyWebsite(storeSettings) || '';

  return [
    salutation,
    '',
    resolveCommonMessage(commonMessage),
    '',
    'Bien cordialement,',
    '',
    "L'équipe ALTA MARÉE",
    '',
    `Téléphone : ${clean(storeSettings.phone) || ''}`,
    `Email : ${companyEmail}`,
    `Site internet : ${website}`,
  ].join('\n');
}

function buildEmailHtml(storeSettings, salutation = 'Bonjour,', commonMessage = defaultCommonMessage()) {
  return buildEmailText(storeSettings, salutation, commonMessage)
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<br>'))
    .join('');
}

function buildMercurialeEmailMessage({
  contactName,
  recipientResolution,
  mercurialeDate,
  commonMessage,
  companySettings,
  storeSettings,
  clientTariffLevel,
  pdfFilename,
  trackingToken,
  publicApiBaseUrl,
  clientKey,
  tenantKey,
} = {}) {
  const settings = companySettings || storeSettings || {};
  const resolvedContactName = clean(contactName) || resolveFirstContactName(recipientResolution);
  const salutation = resolveEmailSalutation(resolvedContactName);
  const message = resolveCommonMessage(commonMessage);
  const text = buildEmailText(settings, salutation, message);
  const html = appendEmailOpenTrackingPixel(
    buildEmailHtml(settings, salutation, message),
    trackingToken,
    { publicApiBaseUrl, clientKey, tenantKey }
  );
  const replyTo = resolveReplyTo(settings);

  return {
    from: replyTo,
    replyTo,
    subject: buildSubject(mercurialeDate),
    html,
    text,
    body: text,
    textBody: text,
    htmlBody: html,
    salutation,
    contact_name: resolvedContactName,
    common_message: message,
    mercuriale_date: normalizeIsoDate(mercurialeDate),
    client_tariff_level: normalizePricingLevel(clientTariffLevel),
    attachment_filename: pdfFilename || buildPdfFilename(mercurialeDate),
    tracking_token: clean(trackingToken),
  };
}

function groupProductsByFamily(products = []) {
  return products.reduce((acc, product) => {
    const family = product.family_name || 'Autre';
    if (!acc[family]) acc[family] = [];
    acc[family].push(product);
    return acc;
  }, {});
}

/**
 * Transforme les produits du service d'email en format compatible avec le template unifié
 */
function transformProductsForTemplate(products = [], tariff = null) {
  const sorted = (products || [])
    .sort((a, b) => {
      const familyCompare = (a.family_name || 'Autre').localeCompare(b.family_name || 'Autre', 'fr');
      if (familyCompare !== 0) return familyCompare;
      return (a.designation || '').localeCompare(b.designation || '', 'fr');
    })
    .map((product) => ({
      article_id: product.article_id,
      plu: product.plu,
      designation: product.designation,
      display_name: product.display_name,
      family_name: product.family_name,
      stock_quantity: product.stock_quantity,
      designation_snapshot: product.display_name || product.designation,
      sale_unit: product.sale_unit,
      price_ht: product.price_ht,
      is_featured: false,
    }));

  return sorted;
}

function customerMercurialPdfPriceList(client = {}, mercurialeDate = null) {
  const safeClient = client || {};
  const pricingLevel = resolveClientPricingLevel(client);
  return {
    client_name: safeClient.name || safeClient.legal_name || safeClient.code || '',
    tariff_level: pricingLevel,
    price_list_date: normalizeIsoDate(mercurialeDate),
  };
}

async function buildCustomerMercurialPdf({ client, products, storeSettings, mercurialeDate }) {
  const transformedLines = transformProductsForTemplate(products);

  const html = renderMercurialePdf({
    priceListOrClient: customerMercurialPdfPriceList(client, mercurialeDate),
    lines: transformedLines,
    storeSettings,
  });
  
  return renderHtmlToPdf(html, {
    format: 'A4',
    margin: { top: '9mm', right: '9mm', bottom: '9mm', left: '9mm' },
  });
}

async function createEmailBatch(db, storeId, userId, previewSummary) {
  const result = await db.query(
    `
    INSERT INTO customer_price_list_email_batches (
      store_id,
      created_by,
      total_clients,
      clients_with_email,
      clients_without_email,
      emails_planned
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, sent_at
    `,
    [
      storeId,
      userId,
      previewSummary.total_clients,
      previewSummary.with_email,
      previewSummary.without_email,
      previewSummary.eligible,
    ]
  );

  return result.rows[0];
}

async function recordEmailResult(db, storeId, batchId, result) {
  await db.query(
    `
    INSERT INTO customer_price_list_email_results (
      batch_id,
      store_id,
      client_id,
      client_name,
      email,
      status,
      error,
      message_id,
      item_count,
      sent_at,
      tracking_token
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $6 = 'sent' THEN now() ELSE NULL END, $10)
    `,
    [
      batchId,
      storeId,
      result.client_id,
      result.client_name,
      result.email,
      result.status,
      result.error || null,
      result.message_id || null,
      result.item_count || 0,
      result.status === 'sent' ? result.tracking_token || null : null,
    ]
  );
}

async function updateEmailBatchSummary(db, batchId, summary, smtpErrors) {
  await db.query(
    `
    UPDATE customer_price_list_email_batches
    SET
      emails_sent = $2,
      clients_skipped = $3,
      errors = $4,
      smtp_errors = $5,
      updated_at = now()
    WHERE id = $1
    `,
    [
      batchId,
      summary.sent,
      summary.skipped,
      summary.errors,
      JSON.stringify(smtpErrors || []),
    ]
  );
}

async function fetchCustomerTariffEmailHistory(db, storeId, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const result = await db.query(
    `
    SELECT
      b.id::text AS id,
      b.sent_at,
      b.total_clients,
      b.clients_with_email,
      b.clients_without_email,
      b.emails_planned,
      b.emails_sent,
      b.clients_skipped,
      b.errors,
      b.smtp_errors,
      b.created_by,
      b.updated_at,
      COALESCE(opened_count, 0)::integer AS opened_count,
      COALESCE(unopened_count, 0)::integer AS unopened_count,
      first_opened_at,
      last_opened_at
    FROM customer_price_list_email_batches b
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) > 0)::integer AS opened_count,
        COUNT(*) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) = 0)::integer AS unopened_count,
        MIN(r.first_opened_at) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) > 0) AS first_opened_at,
        MAX(r.last_opened_at) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) > 0) AS last_opened_at
      FROM customer_price_list_email_results r
      WHERE r.batch_id = b.id AND r.store_id = b.store_id
    ) stats ON true
    WHERE b.store_id = $1
    ORDER BY b.sent_at DESC
    LIMIT $2
    `,
    [storeId, safeLimit]
  );

  return result.rows;
}

async function fetchCustomerTariffEmailBatchDetail(db, storeId, batchId) {
  const batchResult = await db.query(
    `
    SELECT
      b.id::text AS id,
      b.sent_at,
      b.total_clients,
      b.clients_with_email,
      b.clients_without_email,
      b.emails_planned,
      b.emails_sent,
      b.clients_skipped,
      b.errors,
      b.smtp_errors,
      b.created_by,
      b.updated_at,
      COALESCE(stats.opened_count, 0)::integer AS opened_count,
      COALESCE(stats.unopened_count, 0)::integer AS unopened_count,
      stats.first_opened_at,
      stats.last_opened_at
    FROM customer_price_list_email_batches b
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) > 0)::integer AS opened_count,
        COUNT(*) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) = 0)::integer AS unopened_count,
        MIN(r.first_opened_at) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) > 0) AS first_opened_at,
        MAX(r.last_opened_at) FILTER (WHERE r.status = 'sent' AND COALESCE(r.open_count, 0) > 0) AS last_opened_at
      FROM customer_price_list_email_results r
      WHERE r.batch_id = b.id AND r.store_id = b.store_id
    ) stats ON true
    WHERE b.id = $1 AND b.store_id = $2
    LIMIT 1
    `,
    [batchId, storeId]
  );
  const batch = batchResult.rows[0];
  if (!batch) {
    const error = new Error('Campagne email introuvable');
    error.status = 404;
    throw error;
  }

  const results = await db.query(
    `
    SELECT
      client_id::text AS client_id,
      client_name,
      email,
      status,
      error,
      message_id,
      COALESCE(sent_at, created_at) AS sent_at,
      item_count,
      (COALESCE(open_count, 0) > 0) AS opening_detected,
      first_opened_at,
      last_opened_at,
      COALESCE(open_count, 0)::integer AS open_count
    FROM customer_price_list_email_results
    WHERE batch_id = $1 AND store_id = $2
    ORDER BY
      CASE status WHEN 'sent' THEN 0 WHEN 'error' THEN 1 ELSE 2 END,
      client_name NULLS LAST,
      email NULLS LAST,
      created_at ASC
    `,
    [batchId, storeId]
  );

  return { batch, results: results.rows };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function recordCustomerTariffEmailOpen(db, trackingToken) {
  if (!isUuid(trackingToken)) return { found: false };
  const result = await db.query(
    `
    UPDATE customer_price_list_email_results
    SET
      first_opened_at = COALESCE(first_opened_at, now()),
      last_opened_at = now(),
      open_count = COALESCE(open_count, 0) + 1
    WHERE tracking_token = $1 AND status = 'sent'
    RETURNING id
    `,
    [trackingToken]
  );
  return { found: result.rows.length > 0 };
}

function logTariffEmailResult(result) {
  const payload = {
    client_id: result.client_id,
    client_name: result.client_name,
    email: result.email,
    status: result.status,
    error: result.error || null,
  };

  if (result.status === 'error') {
    console.error('Mercurial email result', payload);
  } else {
    console.log('Mercurial email result', payload);
  }
}

async function sendCustomerTariffEmails(db, storeId, options = {}) {
  const context = await resolveMercurialeEmailContext(db, storeId, options);
  const commonMessage = resolveCommonMessage(options.common_message);
  const hasExplicitSelection = Array.isArray(options.selected_client_ids);
  const selectedClientIds = new Set((options.selected_client_ids || []).map((id) => clean(id)).filter(Boolean));
  if (hasExplicitSelection && !selectedClientIds.size) {
    const error = new Error('Aucun client sélectionné pour l’envoi');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  const [clients, storeSettings] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchStoreSettings(db, storeId),
  ]);
  const selectedClients = hasExplicitSelection
    ? clients.filter((client) => selectedClientIds.has(String(client.id)))
    : clients;
  const productsByPricingLevel = await fetchProductsByPricingLevel(db, storeId, storeSettings, context.mercuriale_date, context.price_list_id);
  if (!Object.values(productsByPricingLevel).some((products) => products.length > 0)) {
    const error = new Error(`Aucune tarification fiche d'appel configurée pour le ${context.mercuriale_date}`);
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const previewRows = await Promise.all(selectedClients.map((client) => clientPreviewRow(db, storeId, client, productsByPricingLevel)));
  const previewSummary = buildSummary(previewRows);
  const batch = await createEmailBatch(db, storeId, options.user_id || null, previewSummary);
  const summary = {
    sent: 0,
    skipped: 0,
    errors: 0,
    skipped_no_email: 0,
    skipped_not_sendable: 0,
    skipped_no_products: 0,
  };
  const results = [];
  const smtpErrors = [];
  const filename = buildPdfFilename(context.mercuriale_date);
  const sendEmailFn = options.sendEmail || sendEmail;
  const trackingConfig = openTrackingStatus();
  if (!trackingConfig.open_tracking_configured) {
    console.warn('Suivi des ouvertures mercuriales non configure', {
      missing: trackingConfig.open_tracking_missing,
    });
  }
  const buildPdfFn = options.buildPdf || (async (args) => {
    if (args.priceListId) {
      const generated = await generateCustomerPriceListPdf({
        db: args.db,
        storeId: args.storeId,
        priceListId: args.priceListId,
        clientId: args.clientId,
        resolvedTariffLevel: args.resolvedTariffLevel,
        requireTargetTariff: true,
      });
      return generated.pdf;
    }
    return buildCustomerMercurialPdf(args);
  });

  for (const client of selectedClients) {
    const pricingLevel = resolveClientPricingLevel(client);
    const previewRow = await clientPreviewRow(db, storeId, client, productsByPricingLevel);
    const baseResult = {
      client_id: previewRow.client_id,
      client_name: previewRow.client_name,
      email: previewRow.email,
      item_count: previewRow.item_count,
    };

    if (previewRow.status === 'skipped_no_email') {
      const result = { ...baseResult, status: 'skipped_no_email' };
      summary.skipped += 1;
      summary.skipped_no_email += 1;
      results.push(result);
      await recordEmailResult(db, storeId, batch.id, result);
      logTariffEmailResult(result);
      continue;
    }

    if (!pricingLevel) {
      const result = { ...baseResult, status: 'skipped_not_sendable' };
      summary.skipped += 1;
      summary.skipped_not_sendable += 1;
      results.push(result);
      await recordEmailResult(db, storeId, batch.id, result);
      logTariffEmailResult(result);
      continue;
    }

    if (previewRow.status === 'skipped_no_products') {
      const result = { ...baseResult, status: 'skipped_no_products' };
      summary.skipped += 1;
      summary.skipped_no_products += 1;
      results.push(result);
      await recordEmailResult(db, storeId, batch.id, result);
      logTariffEmailResult(result);
      continue;
    }

    const products = applyDisplayedPricesForClient(productsByPricingLevel[pricingLevel] || [], client, storeSettings);
    const trackingToken = generateEmailTrackingToken();
    const mail = buildMercurialeEmailMessage({
      companySettings: storeSettings,
      recipientResolution: previewRow.recipient_resolution,
      mercurialeDate: context.mercuriale_date,
      commonMessage,
      clientTariffLevel: pricingLevel,
      pdfFilename: filename,
      trackingToken,
      clientKey: options.client_key,
    });

    try {
      const pdfBuffer = await buildPdfFn({
        db,
        storeId,
        priceListId: context.price_list_id,
        client,
        clientId: client.id,
        products,
        storeSettings,
        mercurialeDate: context.mercuriale_date,
        resolvedTariffLevel: pricingLevel,
      });
      const delivery = await sendEmailFn({
        to: (previewRow.recipients || []).map((recipient) => recipient.email),
        subject: mail.subject,
        replyTo: mail.replyTo,
        html: mail.html,
        text: mail.text,
        attachments: [{
          filename: mail.attachment_filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      });

      const result = {
        ...baseResult,
        status: 'sent',
        message_id: delivery.message_id,
      };
      summary.sent += 1;
      results.push(result);
      await recordEmailResult(db, storeId, batch.id, { ...result, tracking_token: mail.tracking_token });
      logTariffEmailResult(result);
    } catch (err) {
      const errorMessage = err.message || 'Erreur envoi email';
      const result = {
        ...baseResult,
        status: 'error',
        error: errorMessage,
      };
      summary.errors += 1;
      smtpErrors.push({
        client_id: result.client_id,
        client_name: result.client_name,
        email: result.email,
        error: errorMessage,
      });
      results.push(result);
      await recordEmailResult(db, storeId, batch.id, result);
      logTariffEmailResult(result);
    }
  }

  await updateEmailBatchSummary(db, batch.id, summary, smtpErrors);

  return {
    batch_id: batch.id,
    sent_at: batch.sent_at,
    smtp: getSmtpStatus(),
    summary,
    results,
  };
}

async function sendCustomerTariffTestEmail(db, storeId, options = {}) {
  const context = await resolveMercurialeEmailContext(db, storeId, options);
  const commonMessage = resolveCommonMessage(options.common_message);
  const hasExplicitSelection = Array.isArray(options.selected_client_ids);
  const selectedClientIds = new Set((options.selected_client_ids || []).map((id) => clean(id)).filter(Boolean));
  const [clients, storeSettings] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchStoreSettings(db, storeId),
  ]);
  const selectedClients = hasExplicitSelection
    ? clients.filter((client) => selectedClientIds.has(String(client.id)))
    : clients;
  const productsByPricingLevel = await fetchProductsByPricingLevel(db, storeId, storeSettings, context.mercuriale_date, context.price_list_id);
  if (!Object.values(productsByPricingLevel).some((products) => products.length > 0)) {
    const error = new Error(`Aucune tarification fiche d'appel configurée pour le ${context.mercuriale_date}`);
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const testRecipient = clean(options.to) || resolveCompanyEmail(storeSettings);
  if (!testRecipient) {
    const error = new Error('Adresse email de test requise');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  for (const client of selectedClients) {
    const pricingLevel = resolveClientPricingLevel(client);
    if (!pricingLevel) continue;

    const previewRow = await clientPreviewRow(db, storeId, client, productsByPricingLevel);
    if (previewRow.status !== 'ready') continue;

    const filename = buildPdfFilename(context.mercuriale_date);
    const products = applyDisplayedPricesForClient(productsByPricingLevel[pricingLevel] || [], client, storeSettings);
    const buildPdf = options.buildPdf || (async (args) => {
      if (args.priceListId) {
        const generated = await generateCustomerPriceListPdf({
          db: args.db,
          storeId: args.storeId,
          priceListId: args.priceListId,
          clientId: args.clientId,
          resolvedTariffLevel: args.resolvedTariffLevel,
          requireTargetTariff: true,
        });
        return generated.pdf;
      }
      return buildCustomerMercurialPdf(args);
    });
    const pdfBuffer = await buildPdf({
      db,
      storeId,
      priceListId: context.price_list_id,
      client,
      clientId: client.id,
      products,
      storeSettings,
      mercurialeDate: context.mercuriale_date,
      resolvedTariffLevel: pricingLevel,
    });
    const mail = buildMercurialeEmailMessage({
      companySettings: storeSettings,
      recipientResolution: previewRow.recipient_resolution,
      mercurialeDate: context.mercuriale_date,
      commonMessage,
      clientTariffLevel: pricingLevel,
      pdfFilename: filename,
    });
    const delivery = await (options.sendEmail || sendEmail)({
      to: testRecipient,
      subject: mail.subject,
      replyTo: mail.replyTo,
      html: mail.html,
      text: mail.text,
      attachments: [{
        filename: mail.attachment_filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    return {
      ok: true,
      to: testRecipient,
      original_to: previewRow.email,
      client_id: previewRow.client_id,
      client_name: previewRow.client_name,
      subject: mail.subject,
      attachment_filename: mail.attachment_filename,
      message_id: delivery.message_id,
    };
  }

  const error = new Error('Aucun email mercuriale éligible pour envoyer un test');
  error.status = 400;
  error.expose = true;
  throw error;
}

module.exports = {
  buildMercurialeEmailMessage,
  appendEmailOpenTrackingPixel,
  buildCustomerTariffEmailPreview,
  buildSummary,
  customerMercurialPdfPriceList,
  fetchCustomerTariffEmailBatchDetail,
  fetchCustomerTariffEmailHistory,
  generateEmailTrackingToken,
  isMercurialEmailSendReady,
  openTrackingStatus,
  recordCustomerTariffEmailOpen,
  resolveClientPricingLevel,
  resolveClientPricingLevelSource,
  resolveMercurialeTargetTariff,
  trackingPixelUrl,
  trackingTenantKey,
  resolveEmailSalutation,
  sendCustomerTariffEmails,
  sendCustomerTariffTestEmail,
};
