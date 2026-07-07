const { sendEmail, getSmtpStatus } = require('./emailService');
const { renderHtmlToPdf } = require('./pdf/pdfRenderer');
const {
  renderMercurialePdf,
} = require('./pdf/templates/mercurialePdfTemplate');
const { priceWithRoyaleMareeCommission } = require('./royaleMareeCommission');

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

function hasEmail(value) {
  return Boolean(clean(value));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildPdfFilename() {
  return `Mercuriale_ALTA_MAREE_${todayIsoDate()}.pdf`;
}

function buildSummary(clients) {
  const summary = {
    total_clients: clients.length,
    with_email: 0,
    without_email: 0,
    eligible: 0,
    not_sendable: 0,
  };

  clients.forEach((client) => {
    if (!hasEmail(client.email)) {
      summary.without_email += 1;
      return;
    }

    summary.with_email += 1;

    if (!normalizePricingLevel(client.tariff_level)) {
      summary.not_sendable += 1;
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
      id::text AS id,
      code,
      name,
      legal_name,
      email,
      tariff_level
    FROM clients
    WHERE store_id = $1
      AND status = 'active'
    ORDER BY COALESCE(name, legal_name, code) ASC
    `,
    [storeId]
  );

  return result.rows;
}

async function fetchProductsForPricingLevel(db, storeId, pricingLevel, commissionSettings = {}) {
  const normalizedPricingLevel = normalizePricingLevel(pricingLevel);
  if (!normalizedPricingLevel) return [];

  const result = await db.query(
    `
    SELECT
      a.id::text AS article_id,
      a.plu,
      a.designation,
      COALESCE(a.display_name, a.designation) AS display_name,
      COALESCE(a.family_name, 'Autre') AS family_name,
      COALESCE(a.sale_unit, a.unit) AS sale_unit,
      ss.stock_quantity,
      CASE $2::int
        WHEN 1 THEN COALESCE(a.sale_price_level_1_ht, a.sale_price_ex_vat)
        WHEN 2 THEN COALESCE(a.sale_price_level_2_ht, a.sale_price_ex_vat)
        WHEN 3 THEN COALESCE(a.sale_price_level_3_ht, a.sale_price_ex_vat)
      END AS base_price_ht
    FROM stock_summary ss
    JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
    WHERE ss.store_id = $1
      AND ss.stock_quantity > 0
    ORDER BY COALESCE(a.family_name, 'Autre') ASC, a.designation ASC
    LIMIT 2000
    `,
    [storeId, normalizedPricingLevel]
  );

  return result.rows
    .filter((row) => row.base_price_ht !== null && row.base_price_ht !== undefined)
    .map((row) => ({
      ...row,
      price_ht: priceWithRoyaleMareeCommission(row.base_price_ht, normalizedPricingLevel, commissionSettings),
    }));
}

async function fetchProductsByPricingLevel(db, storeId, commissionSettings = {}) {
  const entries = await Promise.all([1, 2, 3].map(async (level) => [
    level,
    await fetchProductsForPricingLevel(db, storeId, level, commissionSettings),
  ]));
  return Object.fromEntries(entries);
}

function clientPreviewRow(client, productsByPricingLevel) {
  const pricingLevel = normalizePricingLevel(client.tariff_level);
  const clientName = client.name || client.legal_name || client.code || client.id;

  if (!hasEmail(client.email)) {
    return {
      client_id: client.id,
      client_name: clientName,
      email: null,
      status: 'skipped_no_email',
      item_count: 0,
    };
  }

  if (!pricingLevel) {
    return {
      client_id: client.id,
      client_name: clientName,
      email: client.email,
      status: 'skipped_not_sendable',
      item_count: 0,
    };
  }

  return {
    client_id: client.id,
    client_name: clientName,
    email: client.email,
    status: 'ready',
    item_count: (productsByPricingLevel[pricingLevel] || []).length,
  };
}

async function buildCustomerTariffEmailPreview(db, storeId) {
  const [clients, storeSettings] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchStoreSettings(db, storeId),
  ]);
  const productsByPricingLevel = await fetchProductsByPricingLevel(db, storeId, storeSettings);
  const recipients = clients.map((client) => clientPreviewRow(client, productsByPricingLevel));

  return {
    smtp: getSmtpStatus(),
    summary: buildSummary(clients),
    recipients,
  };
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

async function buildCustomerMercurialPdf({ client, products, storeSettings }) {
  const transformedLines = transformProductsForTemplate(products);
  
  const html = renderMercurialePdf({
    priceListOrClient: {
      client_name: client.name || client.legal_name || client.code || '',
      tariff_level: client.tariff_level,
      price_list_date: new Date(),
    },
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

  const previewSummary = buildSummary(clients);
  const batch = await createEmailBatch(db, storeId, options.user_id || null, previewSummary);
  const summary = {
    sent: 0,
    skipped: 0,
    errors: 0,
    skipped_no_email: 0,
    skipped_not_sendable: 0,
  };
  const results = [];
  const smtpErrors = [];
  const replyTo = clean(storeSettings.email_sender_address) || clean(storeSettings.contact_email) || clean(storeSettings.email);
  const subject = buildSubject(storeSettings);
  const filename = buildPdfFilename();

  for (const client of clients) {
    const pricingLevel = normalizePricingLevel(client.tariff_level);
    const previewRow = clientPreviewRow(client, productsByPricingLevel);
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

    const products = productsByPricingLevel[pricingLevel] || [];

    try {
      const pdfBuffer = await buildCustomerMercurialPdf({ client, products, storeSettings });
      const delivery = await sendEmail({
        to: client.email,
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
  fetchCustomerTariffEmailHistory,
  sendCustomerTariffEmails,
};
