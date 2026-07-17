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
  return normalizePricingLevel(client.tariff_level)
    || normalizePricingLevel(client.parent_tariff_level)
    || normalizePricingLevel(client.billed_tariff_level);
}

function resolveClientPricingLevelSource(client = {}) {
  if (normalizePricingLevel(client.tariff_level)) return 'client';
  if (normalizePricingLevel(client.parent_tariff_level)) return 'parent';
  if (normalizePricingLevel(client.billed_tariff_level)) return 'billed';
  return null;
}

function hasEmail(value) {
  return Boolean(clean(value));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildPdfFilename() {
  return `Mercuriale_ALTA_MAREE_${todayIsoDate()}.pdf`;
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
    if (recipient.recipient_source && recipient.recipient_source !== 'contact_preference') {
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
      royale_maree_commission_eur_per_kg
    FROM store_settings
    WHERE store_id = $1
    LIMIT 1
    `,
    [storeId]
  );

  return result.rows[0] || {};
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
  const pricingLevel = resolveClientPricingLevel(client);
  if (!pricingLevel) return [];
  return (products || []).map((product) => ({
    ...product,
    price_ht: getCustomerDisplayedPrice({
      price: product.price_ht,
      pricingLevel,
      client,
      storeSettings,
      context: { targetTariffLevel: pricingLevel },
    }),
  }));
}

async function fetchProductsForPricingLevel(db, storeId, pricingLevel, commissionSettings = {}) {
  const normalizedPricingLevel = normalizePricingLevel(pricingLevel);
  if (!normalizedPricingLevel) return [];
  const sheetDate = todayIsoDate();

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

async function fetchProductsByPricingLevel(db, storeId, commissionSettings = {}) {
  const entries = await Promise.all([1, 2, 3].map(async (level) => [
    level,
    await fetchProductsForPricingLevel(db, storeId, level, commissionSettings),
  ]));
  return Object.fromEntries(entries);
}

async function clientPreviewRow(db, storeId, client, productsByPricingLevel) {
  const pricingLevel = resolveClientPricingLevel(client);
  const pricingLevelSource = resolveClientPricingLevelSource(client);
  const clientName = client.name || client.legal_name || client.code || client.id;
  const recipientResolution = await resolveDocumentRecipients(db, {
    entityType: 'client',
    entityId: client.id,
    documentType: 'price_list',
    storeId,
  });
  const recipients = recipientsToEmailList(recipientResolution);
  const email = recipients.join(', ');
  const priceListContactCount = Number(recipientResolution.preferred_count || 0);
  const itemCount = pricingLevel ? (productsByPricingLevel[pricingLevel] || []).length : 0;

  if (!hasEmail(email)) {
    return {
      client_id: client.id,
      client_name: clientName,
      email: null,
      status: 'skipped_no_email',
      item_count: 0,
      recipient_source: recipientResolution.source,
      recipient_count: 0,
      price_list_contact_count: priceListContactCount,
      resolved_tariff_level: pricingLevel,
      pricing_level_source: pricingLevelSource,
    };
  }

  if (!pricingLevel) {
    return {
      client_id: client.id,
      client_name: clientName,
      email,
      status: 'skipped_not_sendable',
      item_count: 0,
      recipient_source: recipientResolution.source,
      recipient_count: recipients.length,
      price_list_contact_count: priceListContactCount,
      resolved_tariff_level: null,
      pricing_level_source: null,
    };
  }

  if (itemCount <= 0) {
    return {
      client_id: client.id,
      client_name: clientName,
      email,
      status: 'skipped_no_products',
      item_count: 0,
      recipient_source: recipientResolution.source,
      recipient_count: recipients.length,
      price_list_contact_count: priceListContactCount,
      resolved_tariff_level: pricingLevel,
      pricing_level_source: pricingLevelSource,
    };
  }

  return {
    client_id: client.id,
    client_name: clientName,
    email,
    status: 'ready',
    item_count: itemCount,
    recipient_source: recipientResolution.source,
    recipient_count: recipients.length,
    price_list_contact_count: priceListContactCount,
    resolved_tariff_level: pricingLevel,
    pricing_level_source: pricingLevelSource,
  };
}

function isMercurialEmailSendReady(preview = {}) {
  return Boolean(preview.smtp?.configured && Number(preview.summary?.eligible || 0) > 0);
}

async function buildCustomerTariffEmailPreview(db, storeId) {
  const [clients, storeSettings] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchStoreSettings(db, storeId),
  ]);
  const productsByPricingLevel = await fetchProductsByPricingLevel(db, storeId, storeSettings);
  if (!Object.values(productsByPricingLevel).some((products) => products.length > 0)) {
    const error = new Error(`Aucune tarification fiche d'appel configurée pour le ${todayIsoDate()}`);
    error.status = 400;
    error.expose = true;
    throw error;
  }
  const recipients = await Promise.all(clients.map((client) => clientPreviewRow(db, storeId, client, productsByPricingLevel)));

  return {
    smtp: getSmtpStatus(),
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

function buildSubject(storeSettings) {
  const companyName = clean(storeSettings.company_name) || 'ALTA MAREE';
  return `Mercuriale ${companyName}`;
}

function buildEmailHtml(storeSettings) {
  const companyName = clean(storeSettings.company_name) || 'ALTA MAREE';

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint votre mercuriale ${escapeHtml(companyName)}.</p>
      <p>Cette mercuriale annule et remplace la precedente.</p>
      <p>Pour toute question, notre equipe reste a votre disposition.</p>
      <p>Cordialement,</p>
      <p>${escapeHtml(companyName)}</p>
    </div>
  `;
}

function buildEmailText(storeSettings) {
  const companyName = clean(storeSettings.company_name) || 'ALTA MAREE';

  return [
    'Bonjour,',
    '',
    `Veuillez trouver ci-joint votre mercuriale ${companyName}.`,
    '',
    'Cette mercuriale annule et remplace la precedente.',
    '',
    'Pour toute question, notre equipe reste a votre disposition.',
    '',
    'Cordialement,',
    '',
    companyName,
  ].join('\n');
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
      ...product,
      designation_snapshot: product.display_name || product.designation,
      sale_unit: product.sale_unit,
      price_ht: product.price_ht,
      is_featured: false,
    }));

  return sorted;
}

function customerMercurialPdfPriceList(client = {}) {
  const pricingLevel = resolveClientPricingLevel(client);
  return {
    client_name: client.name || client.legal_name || client.code || '',
    tariff_level: pricingLevel,
    price_list_date: new Date(),
  };
}

async function buildCustomerMercurialPdf({ client, products, storeSettings }) {
  const transformedLines = transformProductsForTemplate(products);

  const html = renderMercurialePdf({
    priceListOrClient: customerMercurialPdfPriceList(client),
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
      item_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      id::text AS id,
      sent_at,
      total_clients,
      clients_with_email,
      clients_without_email,
      emails_planned,
      emails_sent,
      clients_skipped,
      errors,
      smtp_errors,
      created_by,
      updated_at
    FROM customer_price_list_email_batches
    WHERE store_id = $1
    ORDER BY sent_at DESC
    LIMIT $2
    `,
    [storeId, safeLimit]
  );

  return result.rows;
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
  const [clients, storeSettings] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchStoreSettings(db, storeId),
  ]);
  const productsByPricingLevel = await fetchProductsByPricingLevel(db, storeId, storeSettings);
  if (!Object.values(productsByPricingLevel).some((products) => products.length > 0)) {
    const error = new Error(`Aucune tarification fiche d'appel configurée pour le ${todayIsoDate()}`);
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const previewRows = await Promise.all(clients.map((client) => clientPreviewRow(db, storeId, client, productsByPricingLevel)));
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
  const replyTo = clean(storeSettings.email_sender_address) || clean(storeSettings.contact_email) || clean(storeSettings.email);
  const subject = buildSubject(storeSettings);
  const filename = buildPdfFilename();

  for (const client of clients) {
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

    try {
      const pdfBuffer = await buildCustomerMercurialPdf({ client, products, storeSettings });
      const delivery = await sendEmail({
        to: previewRow.email,
        subject,
        replyTo,
        html: buildEmailHtml(storeSettings),
        text: buildEmailText(storeSettings),
        attachments: [{
          filename,
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
      await recordEmailResult(db, storeId, batch.id, result);
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

module.exports = {
  buildCustomerTariffEmailPreview,
  buildSummary,
  customerMercurialPdfPriceList,
  fetchCustomerTariffEmailHistory,
  isMercurialEmailSendReady,
  resolveClientPricingLevel,
  resolveClientPricingLevelSource,
  sendCustomerTariffEmails,
};
