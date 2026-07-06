const { sendEmail, getSmtpStatus } = require('./emailService');

const VALID_TARIFF_LEVELS = new Set([1, 2, 3]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeTariffLevel(value) {
  const parsed = Number(value);
  return VALID_TARIFF_LEVELS.has(parsed) ? parsed : null;
}

function hasEmail(value) {
  return Boolean(clean(value));
}

function formatDecimal(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatQuantity(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function buildSummary(clients) {
  const summary = {
    active_clients: clients.length,
    with_email: 0,
    without_email: 0,
    without_tariff: 0,
    eligible: 0,
    by_tariff: { 1: 0, 2: 0, 3: 0 },
  };

  clients.forEach((client) => {
    const tariffLevel = normalizeTariffLevel(client.tariff_level);

    if (!hasEmail(client.email)) {
      summary.without_email += 1;
      return;
    }

    summary.with_email += 1;

    if (!tariffLevel) {
      summary.without_tariff += 1;
      return;
    }

    summary.eligible += 1;
    summary.by_tariff[tariffLevel] += 1;
  });

  return summary;
}

async function fetchStoreSettings(db, storeId) {
  const result = await db.query(
    `
    SELECT
      company_name,
      email,
      contact_email,
      email_sender_name,
      email_sender_address
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

async function fetchProductsForTariff(db, storeId, tariffLevel) {
  const normalizedTariffLevel = normalizeTariffLevel(tariffLevel);
  if (!normalizedTariffLevel) return [];

  const result = await db.query(
    `
    SELECT
      a.id::text AS article_id,
      a.plu,
      COALESCE(a.display_name, a.designation) AS display_name,
      COALESCE(a.family_name, 'Autre') AS family_name,
      COALESCE(a.sale_unit, a.unit) AS sale_unit,
      ss.stock_quantity,
      CASE $2::int
        WHEN 1 THEN COALESCE(a.sale_price_level_1_ht, a.sale_price_ex_vat)
        WHEN 2 THEN COALESCE(a.sale_price_level_2_ht, a.sale_price_ex_vat)
        WHEN 3 THEN COALESCE(a.sale_price_level_3_ht, a.sale_price_ex_vat)
      END AS price_ht
    FROM stock_summary ss
    JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
    WHERE ss.store_id = $1
      AND ss.stock_quantity > 0
    ORDER BY COALESCE(a.family_name, 'Autre') ASC, a.designation ASC
    LIMIT 2000
    `,
    [storeId, normalizedTariffLevel]
  );

  return result.rows.filter((row) => row.price_ht !== null && row.price_ht !== undefined);
}

async function fetchProductsByTariff(db, storeId) {
  const entries = await Promise.all([1, 2, 3].map(async (level) => [level, await fetchProductsForTariff(db, storeId, level)]));
  return Object.fromEntries(entries);
}

function clientPreviewRow(client, productsByTariff) {
  const tariffLevel = normalizeTariffLevel(client.tariff_level);

  if (!hasEmail(client.email)) {
    return {
      client_id: client.id,
      client_name: client.name || client.legal_name || client.code || client.id,
      email: null,
      tariff_level: tariffLevel,
      status: 'skipped_no_email',
      item_count: 0,
    };
  }

  if (!tariffLevel) {
    return {
      client_id: client.id,
      client_name: client.name || client.legal_name || client.code || client.id,
      email: client.email,
      tariff_level: null,
      status: 'skipped_no_tariff',
      item_count: 0,
    };
  }

  return {
    client_id: client.id,
    client_name: client.name || client.legal_name || client.code || client.id,
    email: client.email,
    tariff_level: tariffLevel,
    status: 'ready',
    item_count: (productsByTariff[tariffLevel] || []).length,
  };
}

async function buildCustomerTariffEmailPreview(db, storeId) {
  const [clients, productsByTariff] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchProductsByTariff(db, storeId),
  ]);

  const recipients = clients.map((client) => clientPreviewRow(client, productsByTariff));

  return {
    smtp: getSmtpStatus(),
    summary: buildSummary(clients),
    recipients,
  };
}

function buildSubject({ subject, storeSettings, tariffLevel }) {
  const customSubject = clean(subject);
  if (customSubject) return customSubject;

  const companyName = clean(storeSettings.company_name) || 'ALTA MAREE';
  return `${companyName} - Mercuriale tarif ${tariffLevel}`;
}

function buildIntro({ introText, clientName }) {
  const customIntro = clean(introText);
  if (customIntro) return customIntro;

  return [
    `Bonjour ${clientName || ''},`.trim(),
    '',
    'Veuillez trouver ci-dessous votre mercuriale du jour.',
    'Chaque prix affiche correspond au tarif configure pour votre compte client.',
  ].join('\n');
}

function buildEmailHtml({ client, products, storeSettings, subject, introText, tariffLevel }) {
  const clientName = client.name || client.legal_name || client.code || '';
  const intro = buildIntro({ introText, clientName });
  const companyName = clean(storeSettings.company_name) || 'ALTA MAREE';
  const rows = products.map((product) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(product.display_name)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(product.family_name)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatQuantity(product.stock_quantity))}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(product.sale_unit || '')}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${escapeHtml(formatDecimal(product.price_ht))} EUR HT</td>
    </tr>
  `).join('');

  const emptyRows = `
    <tr>
      <td colspan="5" style="padding:12px;border-bottom:1px solid #e5e7eb;">Aucun article disponible actuellement.</td>
    </tr>
  `;

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
      <h1 style="font-size:22px;margin:0 0 8px;">${escapeHtml(subject)}</h1>
      <p style="margin:0 0 16px;color:#4b5563;">${escapeHtml(companyName)} - Tarif client ${escapeHtml(tariffLevel)}</p>
      ${intro.split(/\r?\n/).map((line) => line ? `<p>${escapeHtml(line)}</p>` : '<br>').join('')}
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;text-align:left;">Article</th>
            <th style="padding:8px;text-align:left;">Famille</th>
            <th style="padding:8px;text-align:right;">Stock</th>
            <th style="padding:8px;text-align:left;">Unite</th>
            <th style="padding:8px;text-align:right;">Prix</th>
          </tr>
        </thead>
        <tbody>${products.length ? rows : emptyRows}</tbody>
      </table>
      <p style="margin-top:18px;color:#6b7280;font-size:12px;">Cet email contient uniquement la grille tarifaire rattachee a votre compte client.</p>
    </div>
  `;
}

function buildEmailText({ client, products, introText, tariffLevel }) {
  const clientName = client.name || client.legal_name || client.code || '';
  const intro = buildIntro({ introText, clientName });
  const lines = products.length
    ? products.map((product) => [
      product.display_name,
      product.family_name,
      `${formatQuantity(product.stock_quantity)} ${product.sale_unit || ''}`.trim(),
      `${formatDecimal(product.price_ht)} EUR HT`,
    ].filter(Boolean).join(' - '))
    : ['Aucun article disponible actuellement.'];

  return [
    intro,
    '',
    `Tarif client ${tariffLevel}`,
    '',
    ...lines,
    '',
    'Cet email contient uniquement la grille tarifaire rattachee a votre compte client.',
  ].join('\n');
}

function logTariffEmailResult(result) {
  const payload = {
    client_id: result.client_id,
    client_name: result.client_name,
    tariff_level: result.tariff_level,
    email: result.email,
    status: result.status,
    error: result.error || null,
  };

  if (result.status === 'error') {
    console.error('Mercurial tariff email result', payload);
  } else {
    console.log('Mercurial tariff email result', payload);
  }
}

async function sendCustomerTariffEmails(db, storeId, options = {}) {
  const [clients, productsByTariff, storeSettings] = await Promise.all([
    fetchActiveClients(db, storeId),
    fetchProductsByTariff(db, storeId),
    fetchStoreSettings(db, storeId),
  ]);

  const summary = {
    sent: 0,
    skipped: 0,
    errors: 0,
    skipped_no_email: 0,
    skipped_no_tariff: 0,
  };
  const results = [];
  const replyTo = clean(storeSettings.email_sender_address) || clean(storeSettings.contact_email) || clean(storeSettings.email);

  for (const client of clients) {
    const previewRow = clientPreviewRow(client, productsByTariff);
    const baseResult = {
      client_id: previewRow.client_id,
      client_name: previewRow.client_name,
      email: previewRow.email,
      tariff_level: previewRow.tariff_level,
      item_count: previewRow.item_count,
    };

    if (previewRow.status === 'skipped_no_email') {
      const result = { ...baseResult, status: 'skipped_no_email' };
      summary.skipped += 1;
      summary.skipped_no_email += 1;
      results.push(result);
      logTariffEmailResult(result);
      continue;
    }

    if (previewRow.status === 'skipped_no_tariff') {
      const result = { ...baseResult, status: 'skipped_no_tariff' };
      summary.skipped += 1;
      summary.skipped_no_tariff += 1;
      results.push(result);
      logTariffEmailResult(result);
      continue;
    }

    const products = productsByTariff[previewRow.tariff_level] || [];
    const subject = buildSubject({
      subject: options.subject,
      storeSettings,
      tariffLevel: previewRow.tariff_level,
    });

    try {
      const delivery = await sendEmail({
        to: client.email,
        subject,
        replyTo,
        html: buildEmailHtml({
          client,
          products,
          storeSettings,
          subject,
          introText: options.intro_text,
          tariffLevel: previewRow.tariff_level,
        }),
        text: buildEmailText({
          client,
          products,
          introText: options.intro_text,
          tariffLevel: previewRow.tariff_level,
        }),
      });

      const result = {
        ...baseResult,
        status: 'sent',
        message_id: delivery.message_id,
      };
      summary.sent += 1;
      results.push(result);
      logTariffEmailResult(result);
    } catch (err) {
      const result = {
        ...baseResult,
        status: 'error',
        error: err.message || 'Erreur envoi email',
      };
      summary.errors += 1;
      results.push(result);
      logTariffEmailResult(result);
    }
  }

  return {
    smtp: getSmtpStatus(),
    summary,
    results,
  };
}

module.exports = {
  buildCustomerTariffEmailPreview,
  sendCustomerTariffEmails,
};
