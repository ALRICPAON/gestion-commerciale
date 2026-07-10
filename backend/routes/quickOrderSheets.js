const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { sendEmail } = require('../services/emailService');
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ''));
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
    if (!supplier.email) return res.status(400).json({ error: 'Aucun email fournisseur disponible' });

    const totals = productTotals(sheet);
    const pdf = await renderHtmlToPdf(renderSheetPdfHtml(sheet), {
      format: 'A4',
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    });
    const subject = clean(req.body.subject) || `Fiche d'appel ${sheet.sheet_date} - ${sheet.title}`;
    const text = renderSupplierEmailText(sheet, totals);
    const email = await sendEmail({
      to: supplier.email,
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
    res.json({ ok: true, to: supplier.email, supplier_id: supplier.id, email });
  } catch (err) {
    console.error('Erreur envoi fiche appel fournisseur :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur envoi fournisseur' });
  }
});

async function fetchClients(db, storeId, ids) {
  const result = await db.query(
    `SELECT c.id, c.code, c.name, c.tariff_level, c.vat_rate, c.is_vat_exempt,
      COALESCE(c.billed_client_id, c.id) billed_client_id,
      billed.code billed_client_code, billed.name billed_client_name,
      billed.tariff_level billed_tariff_level, billed.vat_rate billed_vat_rate,
      billed.is_vat_exempt billed_is_vat_exempt
     FROM clients c
     LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
     WHERE c.store_id = $1 AND c.id = ANY($2::uuid[]) AND COALESCE(c.status, 'active') <> 'inactive'`,
    [storeId, ids]
  );
  return new Map(result.rows.map((client) => [String(client.id), client]));
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

    const existing = await db.query(
      'SELECT generated_order_ids FROM quick_order_sheet_generations WHERE store_id = $1 AND sheet_id = $2 LIMIT 1 FOR UPDATE',
      [req.user.store_id, sheet.sheet_id]
    );
    if (existing.rows.length) {
      const existingOrderIds = existing.rows[0].generated_order_ids || [];
      const existingOrders = await fetchGeneratedOrders(db, req.user.store_id, existingOrderIds);
      await db.query('COMMIT');
      console.info('quick_order_sheet.generate_orders.idempotent', {
        ...logContext,
        sheet_id: sheet.sheet_id,
        order_ids: existingOrderIds,
      });
      return res.json({ ok: true, existing: true, order_ids: existingOrderIds, orders: existingOrders });
    }

    const clients = await fetchClients(db, req.user.store_id, [...new Set(sourceLines.map((line) => line.client.id).filter(isUuid))]);
    const articles = await fetchArticles(db, req.user.store_id, [...new Set(sourceLines.map((line) => line.product.article_id).filter(isUuid))]);
    const groups = new Map();
    for (const line of sourceLines) {
      const client = clients.get(String(line.client.id));
      const article = articles.get(String(line.product.article_id));
      if (!client || !article) continue;
      const billedClientId = client.billed_client_id || client.id;
      if (!groups.has(String(billedClientId))) groups.set(String(billedClientId), { billedClientId, billedClient: client, lines: [] });
      groups.get(String(billedClientId)).lines.push({ ...line, client, article });
    }
    console.info('quick_order_sheet.generate_orders.matching', {
      ...logContext,
      sheet_id: sheet.sheet_id,
      fetched_clients: clients.size,
      fetched_articles: articles.size,
      groups: groups.size,
      processed_clients: Array.from(groups.values()).map((group) => ({
        billed_client_id: group.billedClientId,
        lines: group.lines.length,
      })),
    });
    if (!groups.size) {
      const error = new Error('Aucune ligne valide apres rapprochement clients/articles');
      error.status = 400;
      throw error;
    }

    const orderIds = [];
    const createdOrders = [];
    for (const group of groups.values()) {
      const billed = group.billedClient;
      const docClientId = group.billedClientId;
      const tariffLevel = Number(billed.billed_tariff_level || billed.tariff_level || 1);
      const vatRate = Number(billed.billed_vat_rate ?? billed.vat_rate ?? 5.5);
      const vatExempt = Boolean(billed.billed_is_vat_exempt ?? billed.is_vat_exempt);
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
        await db.query(
          `INSERT INTO sales_lines(
            id, store_id, client_key, sales_document_id, line_number, article_id, article_plu, article_label,
            package_count, weight_per_package, total_weight, sold_quantity, sale_unit,
            unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc,
            unit_cost_ex_vat, line_margin_ex_vat, delivered_client_id, delivered_client_name_snapshot,
            delivered_client_code_snapshot, line_status, source_inventory_line, created_by, updated_by
          ) VALUES(
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $10, 'kg', $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, 'pending', $22::jsonb, $23, $23
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
            line.client.id === docClientId ? null : line.client.id,
            line.client.id === docClientId ? null : line.client.name,
            line.client.id === docClientId ? null : line.client.code,
            JSON.stringify({ quick_order_sheet_id: sheet.sheet_id, column_uid: line.product.uid, source_client_id: line.client.id }),
            req.user.id,
          ]
        );
      }
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
