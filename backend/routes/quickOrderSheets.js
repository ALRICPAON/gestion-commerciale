const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { sendEmail } = require('../services/emailService');
const {
  resolveDocumentRecipients,
  recipientsToEmailList,
} = require('../services/documentRecipientService');
const { renderHtmlToPdf, sendPdf } = require('../services/pdf/pdfRenderer');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pos(value, fallback = 0) {
  return Math.max(num(value, fallback), 0);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value, digits = 3) {
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isRoyaleMareeClient(client = {}) {
  const haystack = normalizeSearch([client.name, client.legal_name, client.code, client.billed_client_name, client.parent_client_name].filter(Boolean).join(' '));
  return haystack.includes('ROYALE MAREE');
}

function safeDate(value) {
  const text = clean(value);
  if (!text) return new Date().toISOString().slice(0, 10);
  return text.slice(0, 10);
}

async function ensureGenerationTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS quick_order_sheet_generations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id uuid NOT NULL,
      sheet_id uuid NOT NULL,
      client_key text,
      title text,
      sheet_date date,
      notes text,
      generated_order_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(store_id, sheet_id)
    )
  `);
}

function normalizeSheetPayload(body = {}) {
  const sheetId = clean(body.sheet_id);
  if (!sheetId || !isUuid(sheetId)) {
    const error = new Error('sheet_id UUID obligatoire');
    error.status = 400;
    throw error;
  }

  const clients = Array.isArray(body.clients) ? body.clients : [];
  const products = Array.isArray(body.products) ? body.products : [];
  const entries = body.entries && typeof body.entries === 'object' ? body.entries : {};

  return {
    sheet_id: sheetId,
    title: clean(body.title) || "Fiche d'appel clients",
    sheet_date: safeDate(body.date),
    notes: clean(body.notes),
    supplier_id: clean(body.supplier_id),
    clients,
    products,
    entries,
  };
}

function lineQuantity(entry = {}) {
  const packageCount = pos(entry.colis);
  const weightPerPackage = pos(entry.kg);
  const quantity = Number((packageCount * weightPerPackage).toFixed(3));
  return { packageCount, weightPerPackage, quantity };
}

function sheetLines(sheet) {
  const lines = [];
  const productByUid = new Map(sheet.products.map((product) => [String(product.uid), product]));

  for (const client of sheet.clients) {
    const clientEntries = sheet.entries[String(client.id)] || {};
    for (const [columnUid, entry] of Object.entries(clientEntries)) {
      const product = productByUid.get(String(columnUid));
      if (!product?.article_id) continue;
      const quantity = lineQuantity(entry);
      if (quantity.packageCount <= 0 && quantity.weightPerPackage <= 0) continue;
      if (quantity.quantity <= 0) continue;
      lines.push({ client, product, entry, ...quantity });
    }
  }
  return lines;
}

function productTotals(sheet) {
  return sheet.products
    .filter((product) => product.article_id)
    .map((product) => {
      const sold = sheetLines(sheet)
        .filter((line) => String(line.product.uid) === String(product.uid))
        .reduce((sum, line) => sum + line.quantity, 0);
      const stock = num(product.stock, 0);
      return {
        ...product,
        sold: Number(sold.toFixed(3)),
        remaining: Number((stock - sold).toFixed(3)),
        stock,
      };
    });
}

function renderSupplierEmailText(sheet, totals) {
  const rows = totals.map((product) => (
    `- ${product.designation || product.label || product.plu || 'Produit'} : ${formatNumber(product.sold)} kg vendus / stock ${formatNumber(product.stock)} / reste ${formatNumber(product.remaining)}`
  ));
  return [
    'Bonjour,',
    '',
    `Veuillez trouver ci-joint la fiche d'appel "${sheet.title}" du ${sheet.sheet_date}.`,
    sheet.notes ? `Note : ${sheet.notes}` : null,
    '',
    'Resume par produit :',
    ...rows,
    '',
    'Cordialement,',
    'ALTA MAREE',
  ].filter((line) => line !== null).join('\n');
}

function renderSupplierEmailHtml(sheet, totals) {
  const rows = totals.map((product) => `
    <tr>
      <td>${escapeHtml(product.designation || product.label || product.plu || 'Produit')}</td>
      <td style="text-align:right">${escapeHtml(formatNumber(product.stock))}</td>
      <td style="text-align:right">${escapeHtml(formatNumber(product.sold))}</td>
      <td style="text-align:right;color:${product.remaining < 0 ? '#b42318' : '#111'}">${escapeHtml(formatNumber(product.remaining))}</td>
    </tr>
  `).join('');
  return `
    <p>Bonjour,</p>
    <p>Veuillez trouver ci-joint la fiche d'appel <strong>${escapeHtml(sheet.title)}</strong> du ${escapeHtml(sheet.sheet_date)}.</p>
    ${sheet.notes ? `<p><strong>Note :</strong> ${escapeHtml(sheet.notes)}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;max-width:720px">
      <thead>
        <tr>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Produit</th>
          <th style="text-align:right;border-bottom:1px solid #111;padding:6px">Stock initial</th>
          <th style="text-align:right;border-bottom:1px solid #111;padding:6px">Vendu</th>
          <th style="text-align:right;border-bottom:1px solid #111;padding:6px">Reste</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p>Cordialement,<br>ALTA MAREE</p>
  `;
}

function renderSheetPdfHtml(sheet) {
  const totals = productTotals(sheet);
  const rows = sheet.clients.map((client) => {
    const cells = sheet.products.filter((product) => product.article_id).map((product) => {
      const entry = sheet.entries[String(client.id)]?.[String(product.uid)] || {};
      return `
        <td>
          <div class="cell">
            <div><span>Colis</span><strong>${escapeHtml(entry.colis || '')}</strong></div>
            <div><span>Kg</span><strong>${escapeHtml(entry.kg || '')}</strong></div>
          </div>
        </td>
      `;
    }).join('');
    return `
      <tr>
        <th><strong>${escapeHtml(client.name || client.legal_name || 'Client')}</strong><small>${escapeHtml([client.code, client.city].filter(Boolean).join(' - '))}</small></th>
        ${cells}
      </tr>
    `;
  }).join('');
  const heads = sheet.products.filter((product) => product.article_id).map((product) => {
    const total = totals.find((row) => String(row.uid) === String(product.uid)) || {};
    return `
      <th>
        <div class="product">${escapeHtml(product.designation || product.label || product.plu || 'Produit')}</div>
        <div>Prix: ${escapeHtml(product.price || '')} EUR</div>
        <div>Stock: ${escapeHtml(formatNumber(total.stock || 0))}</div>
        <div>Vendu: ${escapeHtml(formatNumber(total.sold || 0))}</div>
        <div class="${Number(total.remaining || 0) < 0 ? 'alert' : ''}">Reste: ${escapeHtml(formatNumber(total.remaining || 0))}</div>
      </th>
    `;
  }).join('');
  return `
    <!doctype html>
    <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <style>
        @page { size: A4 landscape; margin: 8mm; }
        body { font-family: Arial, sans-serif; color:#111; }
        header { display:flex; justify-content:space-between; gap:16px; margin-bottom:8px; }
        h1 { font-size:18pt; margin:0; }
        p { margin:3px 0; }
        table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:7.5pt; }
        th, td { border:1px solid #111; vertical-align:top; }
        thead th { height:19mm; padding:1.5mm; background:#eef3f5; }
        tbody th { width:38mm; padding:1.4mm; text-align:left; background:#f8fafb; }
        tbody th small { display:block; margin-top:1mm; font-weight:400; }
        tbody td { height:11mm; padding:0; }
        .product { min-height:7mm; font-weight:700; overflow-wrap:anywhere; }
        .alert { color:#b42318; font-weight:700; }
        .cell { display:grid; grid-template-columns:1fr 1fr; min-height:11mm; }
        .cell div { display:grid; grid-template-rows:3.5mm 1fr; border-right:1px solid #aaa; text-align:center; }
        .cell div:last-child { border-right:0; }
        .cell span { border-bottom:1px solid #bbb; background:#f8fafb; font-size:5.5pt; font-weight:700; text-transform:uppercase; }
        .cell strong { font-size:8pt; padding-top:1.5mm; }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>${escapeHtml(sheet.title)}</h1>
          ${sheet.notes ? `<p>${escapeHtml(sheet.notes)}</p>` : ''}
        </div>
        <strong>${escapeHtml(sheet.sheet_date)}</strong>
      </header>
      <table>
        <thead><tr><th>Clients</th>${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>
  `;
}

function renderSupplierSheetPdfHtml(sheet, supplier) {
  const lines = sheetLines(sheet);
  const rows = lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.product.designation || line.product.label || line.product.plu || 'Produit')}</td>
      <td>${escapeHtml(line.client.name || line.client.legal_name || 'Magasin')}</td>
      <td class="num">${escapeHtml(formatNumber(line.packageCount, 0))}</td>
      <td class="num">${escapeHtml(formatNumber(line.weightPerPackage))}</td>
      <td class="num">${escapeHtml(formatNumber(line.quantity))}</td>
    </tr>
  `).join('');
  return `
    <!doctype html>
    <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <style>
        @page { size: A4 landscape; margin: 8mm; }
        body { font-family: Arial, sans-serif; color:#111; }
        header { display:flex; justify-content:space-between; gap:16px; margin-bottom:10px; }
        h1 { font-size:18pt; margin:0; }
        p { margin:3px 0; }
        table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:8pt; }
        th, td { border:1px solid #111; padding:1.6mm; vertical-align:top; }
        th { background:#eef3f5; text-align:left; }
        .num { text-align:right; }
        .notes { margin:8px 0; font-size:9pt; }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>${escapeHtml(sheet.title)}</h1>
          <p>Fournisseur : <strong>${escapeHtml(supplier?.name || supplier?.code || '-')}</strong></p>
          ${sheet.notes ? `<p class="notes">${escapeHtml(sheet.notes)}</p>` : ''}
        </div>
        <strong>${escapeHtml(sheet.sheet_date)}</strong>
      </header>
      <table>
        <thead>
          <tr>
            <th>Produit</th>
            <th>Magasin</th>
            <th>Colis</th>
            <th>Kg/colis</th>
            <th>Poids total kg</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5">Aucune ligne.</td></tr>'}</tbody>
      </table>
    </body>
    </html>
  `;
}

async function supplierById(db, storeId, supplierId) {
  if (!supplierId) return null;
  const result = await db.query(
    `SELECT id, code, name, email
     FROM suppliers
     WHERE id = $1 AND store_id = $2 AND status = 'active'
     LIMIT 1`,
    [supplierId, storeId]
  );
  return result.rows[0] || null;
}

async function getStoreReplyTo(db, storeId) {
  const result = await db.query('SELECT email FROM store_settings WHERE store_id = $1 LIMIT 1', [storeId]);
  return clean(result.rows[0]?.email);
}

router.post('/quick-order-sheets/email-preview', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const sheet = normalizeSheetPayload(req.body);
    const supplier = await supplierById(req.dbPool, req.user.store_id, sheet.supplier_id);
    if (!supplier) return res.status(404).json({ error: 'Fournisseur actif introuvable' });
    const totals = productTotals(sheet);
    res.json({
      ok: true,
      supplier,
      to: supplier.email || null,
      subject: `Fiche d'appel ${sheet.sheet_date} - ${sheet.title}`,
      text: renderSupplierEmailText(sheet, totals),
      html: renderSupplierEmailHtml(sheet, totals),
      totals,
      missing_email: !supplier.email,
    });
  } catch (err) {
    console.error('Erreur preview fiche appel fournisseur :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur preview email fournisseur' });
  }
});

router.post('/quick-order-sheets/pdf', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const sheet = normalizeSheetPayload(req.body);
    const pdf = await renderHtmlToPdf(renderSheetPdfHtml(sheet), {
      format: 'A4',
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    });
    return sendPdf(res, pdf, `fiche-appel-${sheet.sheet_date}.pdf`);
  } catch (err) {
    console.error('Erreur PDF fiche appel :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur generation PDF fiche appel' });
  }
});

router.post('/quick-order-sheets/send-supplier-email', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_OUTBOUND_EMAILS === 'true') {
      return res.status(409).json({ error: 'Envoi email desactive dans cet environnement' });
    }
    if (req.body?.preview_confirmed !== true || req.body?.confirm_send !== true) {
      return res.status(400).json({ error: 'Apercu et confirmation obligatoires avant envoi' });
    }
    const sheet = normalizeSheetPayload(req.body);
    const supplier = await supplierById(req.dbPool, req.user.store_id, sheet.supplier_id);
    if (!supplier) return res.status(404).json({ error: 'Fournisseur actif introuvable' });
    const recipientResolution = await resolveDocumentRecipients(req.dbPool, {
      entityType: 'supplier',
      entityId: supplier.id,
      documentType: 'purchase_order',
      storeId: req.user.store_id,
    });
    const recipients = recipientsToEmailList(recipientResolution);
    if (!recipients.length) return res.status(400).json({ error: 'Aucun destinataire email configuré pour ce document.' });

    const totals = productTotals(sheet);
    const pdf = await renderHtmlToPdf(renderSupplierSheetPdfHtml(sheet, supplier), {
      format: 'A4',
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    });
    const subject = clean(req.body.subject) || `Fiche d'appel ${sheet.sheet_date} - ${sheet.title}`;
    const text = renderSupplierEmailText(sheet, totals);
    const email = await sendEmail({
      to: recipients,
      subject,
      text,
      html: renderSupplierEmailHtml(sheet, totals),
      replyTo: await getStoreReplyTo(req.dbPool, req.user.store_id),
      attachments: [{
        filename: `fiche-appel-${sheet.sheet_date}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }],
    });
    res.json({ ok: true, to: recipients, recipient_source: recipientResolution.source, supplier_id: supplier.id, email });
  } catch (err) {
    console.error('Erreur envoi fiche appel fournisseur :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur envoi fournisseur' });
  }
});

async function fetchClients(db, storeId, ids) {
  const result = await db.query(
    `SELECT c.id, c.code, c.name, c.legal_name, c.tariff_level, c.vat_rate, c.is_vat_exempt,
      COALESCE(c.is_royale_maree_member, false) is_royale_maree_member,
      c.parent_client_id, c.store_identifier,
      COALESCE(c.billed_client_id, c.id) billed_client_id,
      billed.code billed_client_code, billed.name billed_client_name,
      billed.tariff_level billed_tariff_level, billed.vat_rate billed_vat_rate,
      billed.is_vat_exempt billed_is_vat_exempt,
      billed.store_identifier billed_store_identifier,
      parent.code parent_client_code, parent.name parent_client_name,
      parent.tariff_level parent_tariff_level, parent.vat_rate parent_vat_rate,
      parent.is_vat_exempt parent_is_vat_exempt,
      parent.store_identifier parent_store_identifier
     FROM clients c
     LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
     LEFT JOIN clients parent ON parent.id = c.parent_client_id AND parent.store_id = c.store_id
     WHERE c.store_id = $1 AND c.id = ANY($2::uuid[]) AND COALESCE(c.status, 'active') <> 'inactive'`,
    [storeId, ids]
  );
  return new Map(result.rows.map((client) => [String(client.id), client]));
}

function orderTargetForClient(client) {
  const parentIsRoyaleMaree = client.parent_client_id && (
    client.is_royale_maree_member === true
    || isRoyaleMareeClient({ name: client.parent_client_name, code: client.parent_client_code })
  );
  if (parentIsRoyaleMaree) {
    return {
      documentClientId: client.parent_client_id,
      documentClientName: client.parent_client_name,
      documentClientCode: client.parent_client_code,
      tariffLevel: client.parent_tariff_level || client.billed_tariff_level || client.tariff_level,
      vatRate: client.parent_vat_rate ?? client.billed_vat_rate ?? client.vat_rate,
      vatExempt: Boolean(client.parent_is_vat_exempt ?? client.billed_is_vat_exempt ?? client.is_vat_exempt),
      flow: 'royale_maree',
    };
  }

  const billedIsRoyaleMaree = client.billed_client_id
    && String(client.billed_client_id) !== String(client.id)
    && isRoyaleMareeClient({ name: client.billed_client_name, code: client.billed_client_code });
  if (billedIsRoyaleMaree) {
    return {
      documentClientId: client.billed_client_id,
      documentClientName: client.billed_client_name,
      documentClientCode: client.billed_client_code,
      tariffLevel: client.billed_tariff_level || client.tariff_level,
      vatRate: client.billed_vat_rate ?? client.vat_rate,
      vatExempt: Boolean(client.billed_is_vat_exempt ?? client.is_vat_exempt),
      flow: 'royale_maree',
    };
  }

  return {
    documentClientId: client.id,
    documentClientName: client.name,
    documentClientCode: client.code,
    tariffLevel: client.tariff_level,
    vatRate: client.vat_rate,
    vatExempt: Boolean(client.is_vat_exempt),
    flow: 'classic',
  };
}

function deliveredSnapshotForLine(line, documentClientId, forceSourceClient = false) {
  if (!forceSourceClient && String(line.client.id) === String(documentClientId)) {
    return {
      id: null,
      name: null,
      code: null,
      store_identifier: null,
    };
  }
  return {
    id: line.client.id,
    name: line.client.name || line.client.legal_name,
    code: line.client.code,
    store_identifier: line.client.store_identifier,
  };
}

async function fetchArticles(db, storeId, ids) {
  const result = await db.query(
    `SELECT a.id, a.plu, a.designation, a.sale_unit, a.unit, a.vat_rate, COALESCE(ss.pma, 0) pma
     FROM articles a
     LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
     WHERE a.store_id = $1 AND a.id = ANY($2::uuid[]) AND a.is_active = true`,
    [storeId, ids]
  );
  return new Map(result.rows.map((article) => [String(article.id), article]));
}

async function fetchGeneratedOrders(db, storeId, orderIds) {
  const ids = (Array.isArray(orderIds) ? orderIds : []).filter(isUuid);
  if (!ids.length) return [];
  const result = await db.query(
    `SELECT sd.id, sd.reference_number, sd.client_id, sd.document_date, sd.status, sd.document_type,
            c.name AS client_name, COUNT(sl.id) AS line_count
     FROM sales_documents sd
     LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
     LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
     WHERE sd.store_id = $1 AND sd.id = ANY($2::uuid[])
     GROUP BY sd.id, c.name
     ORDER BY sd.created_at ASC`,
    [storeId, ids]
  );
  return result.rows;
}

async function fetchGeneratedOrderLineSnapshots(db, storeId, orderIds) {
  const ids = (Array.isArray(orderIds) ? orderIds : []).filter(isUuid);
  if (!ids.length) return [];
  const result = await db.query(
    `SELECT sales_document_id, delivered_client_id, delivered_client_name_snapshot,
            delivered_client_code_snapshot, delivered_client_store_identifier_snapshot,
            source_inventory_line ->> 'source_client_id' AS source_client_id
     FROM sales_lines
     WHERE store_id = $1 AND sales_document_id = ANY($2::uuid[])
     ORDER BY sales_document_id, line_number`,
    [storeId, ids]
  );
  return result.rows;
}

function existingGenerationMatchesGroups(existingOrders, groups, existingLines = []) {
  const groupList = Array.from(groups.values());
  if (existingOrders.length !== groupList.length) return false;
  return groupList.every((group) => existingOrders.some((order) => (
    String(order.client_id) === String(group.documentClientId)
    && Number(order.line_count || 0) === group.lines.length
    && existingOrderLinesMatchGroup(order, group, existingLines)
  )));
}

function existingOrderLinesMatchGroup(order, group, existingLines) {
  if (group.flow !== 'royale_maree') return true;
  const rows = existingLines.filter((line) => String(line.sales_document_id) === String(order.id));
  const expectedByClient = new Map();
  for (const line of group.lines) {
    const sourceClientId = String(line.client.id);
    expectedByClient.set(sourceClientId, (expectedByClient.get(sourceClientId) || 0) + 1);
  }

  const validByClient = new Map();
  for (const row of rows) {
    const sourceClientId = String(row.source_client_id || '');
    if (
      sourceClientId
      && String(row.delivered_client_id || '') === sourceClientId
      && clean(row.delivered_client_name_snapshot)
    ) {
      validByClient.set(sourceClientId, (validByClient.get(sourceClientId) || 0) + 1);
    }
  }

  return Array.from(expectedByClient.entries()).every(([sourceClientId, expectedCount]) => (
    (validByClient.get(sourceClientId) || 0) >= expectedCount
  ));
}

async function resetGeneratedOrders(db, storeId, orderIds) {
  const ids = (Array.isArray(orderIds) ? orderIds : []).filter(isUuid);
  if (!ids.length) return { deleted: 0 };
  const documents = await db.query(
    `SELECT id, status, document_type, origin
     FROM sales_documents
     WHERE store_id = $1 AND id = ANY($2::uuid[])
     FOR UPDATE`,
    [storeId, ids]
  );
  const unsafe = documents.rows.find((document) => (
    document.document_type !== 'ORDER'
    || document.origin !== 'quick_order_sheet'
    || document.status !== 'draft'
  ));
  if (unsafe) {
    const error = new Error('Regeneration impossible: une commande deja generee n est plus un brouillon fiche appel');
    error.status = 409;
    throw error;
  }
  await db.query('DELETE FROM sales_documents WHERE store_id = $1 AND id = ANY($2::uuid[])', [storeId, ids]);
  return { deleted: documents.rows.length };
}

router.post('/quick-order-sheets/generate-orders', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  const logContext = {
    sheet_id: clean(req.body?.sheet_id),
    store_id: req.user?.store_id,
    client_key: req.user?.client_key || null,
  };
  try {
    if (req.body?.confirm_generate !== true) {
      return res.status(400).json({ error: 'Confirmation obligatoire avant generation des commandes' });
    }
    const sheet = normalizeSheetPayload(req.body);
    const sourceLines = sheetLines(sheet);
    console.info('quick_order_sheet.generate_orders.start', {
      ...logContext,
      sheet_id: sheet.sheet_id,
      received_lines: sourceLines.length,
      received_clients: sheet.clients.length,
      received_products: sheet.products.length,
    });
    if (!sourceLines.length) return res.status(400).json({ error: 'Aucune ligne saisie a transformer en commande' });

    await db.query('BEGIN');
    await ensureGenerationTable(db);

    const clients = await fetchClients(db, req.user.store_id, [...new Set(sourceLines.map((line) => line.client.id).filter(isUuid))]);
    const articles = await fetchArticles(db, req.user.store_id, [...new Set(sourceLines.map((line) => line.product.article_id).filter(isUuid))]);
    const groups = new Map();
    for (const line of sourceLines) {
      const client = clients.get(String(line.client.id));
      const article = articles.get(String(line.product.article_id));
      if (!client || !article) continue;
      const target = orderTargetForClient(client);
      const key = String(target.documentClientId);
      if (!groups.has(key)) groups.set(key, { ...target, lines: [] });
      groups.get(key).lines.push({ ...line, client, article });
    }
    console.info('quick_order_sheet.generate_orders.matching', {
      ...logContext,
      sheet_id: sheet.sheet_id,
      fetched_clients: clients.size,
      fetched_articles: articles.size,
      groups: groups.size,
      processed_clients: Array.from(groups.values()).map((group) => ({
        flow: group.flow,
        billed_client_id: group.documentClientId,
        billed_client_name: group.documentClientName,
        delivered_clients: Array.from(new Set(group.lines.map((line) => line.client.name || line.client.code || line.client.id))),
        lines: group.lines.length,
      })),
    });
    if (!groups.size) {
      const error = new Error('Aucune ligne valide apres rapprochement clients/articles');
      error.status = 400;
      throw error;
    }

    const existing = await db.query(
      'SELECT generated_order_ids FROM quick_order_sheet_generations WHERE store_id = $1 AND sheet_id = $2 LIMIT 1 FOR UPDATE',
      [req.user.store_id, sheet.sheet_id]
    );
    if (existing.rows.length) {
      const existingOrderIds = existing.rows[0].generated_order_ids || [];
      const existingOrders = await fetchGeneratedOrders(db, req.user.store_id, existingOrderIds);
      const existingLineSnapshots = await fetchGeneratedOrderLineSnapshots(db, req.user.store_id, existingOrderIds);
      const compatible = existingGenerationMatchesGroups(existingOrders, groups, existingLineSnapshots);
      if (compatible && req.body?.force_regenerate !== true) {
        await db.query('COMMIT');
        console.info('quick_order_sheet.generate_orders.idempotent', {
          ...logContext,
          sheet_id: sheet.sheet_id,
          order_ids: existingOrderIds,
        });
        return res.json({ ok: true, existing: true, order_ids: existingOrderIds, orders: existingOrders });
      }
      if (req.body?.force_regenerate !== true) {
        await db.query('ROLLBACK');
        return res.status(409).json({
          error: 'Cette fiche a deja genere des commandes avec un ancien regroupement. Regeneration controlee requise.',
          can_regenerate: true,
          order_ids: existingOrderIds,
          orders: existingOrders,
        });
      }
      const reset = await resetGeneratedOrders(db, req.user.store_id, existingOrderIds);
      await db.query('DELETE FROM quick_order_sheet_generations WHERE store_id = $1 AND sheet_id = $2', [req.user.store_id, sheet.sheet_id]);
      console.info('quick_order_sheet.generate_orders.regenerate_reset', {
        ...logContext,
        sheet_id: sheet.sheet_id,
        deleted_orders: reset.deleted,
        previous_order_ids: existingOrderIds,
      });
    }

    const orderIds = [];
    const createdOrders = [];
    for (const group of groups.values()) {
      const docClientId = group.documentClientId;
      const tariffLevel = Number(group.tariffLevel || 1);
      const vatRate = Number(group.vatRate ?? 5.5);
      const vatExempt = Boolean(group.vatExempt);
      const order = await db.query(
        `INSERT INTO sales_documents(
          id, store_id, client_key, client_id, billed_client_id, document_date, status, document_type, origin,
          reference_number, notes, tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot, created_by, updated_by
        ) VALUES(
          gen_random_uuid(), $1, $2, $3, $3, $4::date, 'draft', 'ORDER', 'quick_order_sheet',
          NULL, $5, $6, $7, $8, $9, $9
        ) RETURNING id, reference_number`,
        [
          req.user.store_id,
          req.user.client_key || null,
          docClientId,
          sheet.sheet_date,
          [sheet.title, sheet.notes, `Fiche source: ${sheet.sheet_id}`].filter(Boolean).join('\n'),
          tariffLevel,
          vatRate,
          vatExempt,
          req.user.id,
        ]
      );
      const orderId = order.rows[0].id;
      orderIds.push(orderId);
      createdOrders.push({
        id: orderId,
        reference_number: order.rows[0].reference_number,
        client_id: docClientId,
        client_name: group.documentClientName,
        status: 'draft',
        document_type: 'ORDER',
        line_count: group.lines.length,
      });

      let lineNumber = 1;
      for (const line of group.lines) {
        const unitPrice = pos(line.product.price);
        const lineVatRate = vatExempt ? 0 : num(line.article.vat_rate, vatRate);
        const amountHt = Number((line.quantity * unitPrice).toFixed(2));
        const vatAmount = Number((amountHt * lineVatRate / 100).toFixed(2));
        const amountTtc = Number((amountHt + vatAmount).toFixed(2));
        const unitTtc = line.quantity > 0 ? Number((amountTtc / line.quantity).toFixed(4)) : Number((unitPrice * (1 + lineVatRate / 100)).toFixed(4));
        const delivered = deliveredSnapshotForLine(line, docClientId, group.flow === 'royale_maree');
        console.info('quick_order_sheet.generate_orders.line_before_insert', {
          ...logContext,
          sheet_id: sheet.sheet_id,
          flow: group.flow,
          order_id: orderId,
          source_client_id: line.client.id,
          source_client_name: line.client.name || line.client.legal_name || null,
          doc_client_id: docClientId,
          delivered_client_id: delivered.id,
          delivered_client_name_snapshot: delivered.name,
          delivered_client_code_snapshot: delivered.code,
          delivered_client_store_identifier_snapshot: delivered.store_identifier,
        });
        await db.query(
          `INSERT INTO sales_lines(
            id, store_id, client_key, sales_document_id, line_number, article_id, article_plu, article_label,
            package_count, weight_per_package, total_weight, sold_quantity, sale_unit,
            unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc,
            unit_cost_ex_vat, line_margin_ex_vat, delivered_client_id, delivered_client_name_snapshot,
            delivered_client_code_snapshot, delivered_client_store_identifier_snapshot,
            line_status, source_inventory_line, created_by, updated_by
          ) VALUES(
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $10, 'kg', $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, 'pending', $23::jsonb, $24, $24
          )`,
          [
            req.user.store_id,
            req.user.client_key || null,
            orderId,
            lineNumber++,
            line.article.id,
            line.article.plu || line.product.plu || null,
            line.product.designation || line.article.designation,
            line.packageCount,
            line.weightPerPackage,
            line.quantity,
            unitPrice,
            unitTtc,
            lineVatRate,
            amountHt,
            vatAmount,
            amountTtc,
            num(line.article.pma, 0),
            Number((amountHt - line.quantity * num(line.article.pma, 0)).toFixed(2)),
            delivered.id,
            delivered.name,
            delivered.code,
            delivered.store_identifier,
            JSON.stringify({
              quick_order_sheet_id: sheet.sheet_id,
              column_uid: line.product.uid,
              source_client_id: line.client.id,
              source_client_name: line.client.name || line.client.legal_name || null,
              source_client_code: line.client.code || null,
              source_client_store_identifier: line.client.store_identifier || null,
              flow: group.flow,
            }),
            req.user.id,
          ]
        );
      }
      console.info('quick_order_sheet.generate_orders.order_created', {
        ...logContext,
        sheet_id: sheet.sheet_id,
        flow: group.flow,
        order_id: orderId,
        reference_number: order.rows[0].reference_number,
        billed_client_id: docClientId,
        billed_client_name: group.documentClientName,
        delivered_clients: group.lines.map((line) => ({
          id: line.client.id,
          name: line.client.name,
          code: line.client.code,
          store_identifier: line.client.store_identifier,
        })),
        line_count: group.lines.length,
      });
      await db.query(
        `UPDATE sales_documents sd SET total_amount_ex_vat = x.ht, total_vat_amount = x.vat, total_amount_inc_vat = x.ttc, updated_at = NOW()
         FROM (SELECT COALESCE(SUM(line_amount_ht), 0) ht, COALESCE(SUM(line_vat_amount), 0) vat, COALESCE(SUM(line_amount_ttc), 0) ttc FROM sales_lines WHERE sales_document_id = $1) x
         WHERE sd.id = $1`,
        [orderId]
      );
    }

    await db.query(
      `INSERT INTO quick_order_sheet_generations(store_id, sheet_id, client_key, title, sheet_date, notes, generated_order_ids, payload_snapshot, created_by)
       VALUES($1, $2, $3, $4, $5::date, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        req.user.store_id,
        sheet.sheet_id,
        req.user.client_key || null,
        sheet.title,
        sheet.sheet_date,
        sheet.notes,
        JSON.stringify(orderIds),
        JSON.stringify(sheet),
        req.user.id,
      ]
    );
    const orders = await fetchGeneratedOrders(db, req.user.store_id, orderIds);
    await db.query('COMMIT');
    console.info('quick_order_sheet.generate_orders.success', {
      ...logContext,
      sheet_id: sheet.sheet_id,
      order_ids: orderIds,
      order_count: orderIds.length,
    });
    res.status(201).json({ ok: true, existing: false, order_ids: orderIds, orders: orders.length ? orders : createdOrders });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('quick_order_sheet.generate_orders.rollback', {
      ...logContext,
      message: err.message,
      status: err.status || 500,
      stack: err.stack,
    });
    res.status(err.status || 500).json({ error: err.message || 'Erreur generation commandes' });
  } finally {
    db.release();
  }
});

module.exports = router;
