const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  return Number(num(value).toFixed(2));
}

function isoDate(value) {
  const date = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function weekNumber(dateValue) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function royaleFilterSql(alias) {
  return `(
    UPPER(${alias}.name) LIKE '%ROYALE%MAREE%'
    OR UPPER(${alias}.name) LIKE '%ROYALE%MARÉE%'
    OR UPPER(COALESCE(${alias}.code, '')) IN ('ROYALE_MAREE', 'ROYALE-MAREE', 'ROYALE')
  )`;
}

async function findRoyaleClient(db, storeId) {
  const result = await db.query(
    `
    SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt
    FROM clients
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
      AND ${royaleFilterSql('clients')}
    ORDER BY
      CASE WHEN UPPER(COALESCE(code, '')) IN ('ROYALE_MAREE', 'ROYALE-MAREE', 'ROYALE') THEN 0 ELSE 1 END,
      name ASC
    LIMIT 1
    `,
    [storeId]
  );
  return result.rows[0] || null;
}

async function nextCreditNoteReference(db, storeId, documentDate = new Date()) {
  const year = new Date(documentDate).getFullYear();
  const prefix = `AV-${year}-`;
  const suffixPattern = `^AV-${year}-([0-9]+)$`;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`customer-credit-note:${storeId}:${year}`]);
  const result = await db.query(
    `
    SELECT COALESCE(MAX((substring(reference_number FROM $2))::integer), 0) + 1 AS next_number
    FROM sales_documents
    WHERE store_id = $1
      AND UPPER(document_type) = 'CREDIT_NOTE'
      AND reference_number LIKE $3
      AND substring(reference_number FROM $2) IS NOT NULL
    `,
    [storeId, suffixPattern, `${prefix}%`]
  );
  return `${prefix}${String(Number(result.rows[0]?.next_number || 1)).padStart(5, '0')}`;
}

async function buildSettlement(db, { storeId, from, to, deliveredClientId, commissionRate }) {
  const params = [storeId, from, to];
  const deliveredFilter = [];
  if (deliveredClientId) {
    params.push(deliveredClientId);
    deliveredFilter.push(`AND d.client_id = $${params.length}`);
  }

  const result = await db.query(
    `
    WITH royale_docs AS (
      SELECT d.*
      FROM sales_documents d
      LEFT JOIN clients billed
        ON billed.id = COALESCE(d.billed_client_id, d.client_id)
       AND billed.store_id = d.store_id
      WHERE d.store_id = $1
        AND d.document_date >= $2::date
        AND d.document_date <= $3::date
        AND d.document_type IN ('DELIVERY_NOTE', 'INVOICE')
        AND COALESCE(d.status, '') NOT IN ('draft', 'cancelled')
        AND ${royaleFilterSql('billed')}
        ${deliveredFilter.join(' ')}
    ),
    basis_docs AS (
      SELECT *
      FROM royale_docs
      WHERE document_type = 'DELIVERY_NOTE'
      UNION ALL
      SELECT inv.*
      FROM royale_docs inv
      WHERE inv.document_type = 'INVOICE'
        AND NOT EXISTS (
          SELECT 1
          FROM royale_docs dn
          WHERE dn.document_type = 'DELIVERY_NOTE'
            AND dn.id = inv.source_delivery_note_id
        )
    ),
    grouped AS (
      SELECT
        delivered.id AS delivered_client_id,
        delivered.code AS delivered_client_code,
        COALESCE(delivered.name, bd.delivered_client_name_snapshot, 'Magasin non renseigne') AS delivered_client_name,
        COALESCE(SUM(COALESCE(sl.sold_quantity, sl.total_weight, 0)), 0) AS total_weight_kg,
        COALESCE(SUM(COALESCE(sl.package_count, 0)), 0) AS package_count,
        COALESCE(SUM(sl.line_amount_ht), 0) AS total_ht,
        COALESCE(SUM(sl.line_vat_amount), 0) AS total_vat,
        COALESCE(SUM(sl.line_amount_ttc), 0) AS total_ttc,
        COUNT(DISTINCT bd.id) FILTER (WHERE bd.document_type = 'DELIVERY_NOTE')::int AS delivery_note_count,
        COUNT(DISTINCT bd.id) FILTER (WHERE bd.document_type = 'INVOICE')::int AS fallback_invoice_count
      FROM basis_docs bd
      LEFT JOIN sales_lines sl
        ON sl.sales_document_id = bd.id
       AND sl.store_id = bd.store_id
      LEFT JOIN clients delivered
        ON delivered.id = bd.client_id
       AND delivered.store_id = bd.store_id
      GROUP BY delivered.id, delivered.code, COALESCE(delivered.name, bd.delivered_client_name_snapshot, 'Magasin non renseigne')
    ),
    invoice_counts AS (
      SELECT d.client_id AS delivered_client_id, COUNT(DISTINCT d.id)::int AS invoice_count
      FROM royale_docs d
      WHERE d.document_type = 'INVOICE'
      GROUP BY d.client_id
    )
    SELECT g.*,
      COALESCE(ic.invoice_count, 0) AS invoice_count,
      $${params.length + 1}::numeric AS commission_rate_per_kg,
      ROUND(g.total_weight_kg * $${params.length + 1}::numeric, 2) AS credit_amount_ht
    FROM grouped g
    LEFT JOIN invoice_counts ic ON ic.delivered_client_id IS NOT DISTINCT FROM g.delivered_client_id
    WHERE g.total_weight_kg <> 0 OR g.total_ht <> 0
    ORDER BY g.delivered_client_name ASC
    `,
    [...params, commissionRate]
  );

  const rows = result.rows.map((row) => ({
    ...row,
    total_weight_kg: num(row.total_weight_kg),
    package_count: num(row.package_count),
    total_ht: money(row.total_ht),
    total_vat: money(row.total_vat),
    total_ttc: money(row.total_ttc),
    commission_rate_per_kg: num(row.commission_rate_per_kg),
    credit_amount_ht: money(row.credit_amount_ht),
  }));

  const totals = rows.reduce((acc, row) => ({
    total_weight_kg: num(acc.total_weight_kg + row.total_weight_kg),
    package_count: num(acc.package_count + row.package_count),
    total_ht: money(acc.total_ht + row.total_ht),
    total_vat: money(acc.total_vat + row.total_vat),
    total_ttc: money(acc.total_ttc + row.total_ttc),
    delivery_note_count: acc.delivery_note_count + Number(row.delivery_note_count || 0),
    invoice_count: acc.invoice_count + Number(row.invoice_count || 0),
    credit_amount_ht: money(acc.credit_amount_ht + row.credit_amount_ht),
  }), {
    total_weight_kg: 0,
    package_count: 0,
    total_ht: 0,
    total_vat: 0,
    total_ttc: 0,
    delivery_note_count: 0,
    invoice_count: 0,
    credit_amount_ht: 0,
  });

  return { rows, totals };
}

router.get('/royale-maree-settlement', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const from = isoDate(clean(req.query.from));
    const to = isoDate(clean(req.query.to) || from);
    const commissionRate = num(req.query.commission_rate, 0.30);
    const deliveredClientId = clean(req.query.delivered_client_id);
    const royaleClient = await findRoyaleClient(req.dbPool, req.user.store_id);
    if (!royaleClient) {
      return res.json({
        ok: true,
        royale_client: null,
        rows: [],
        totals: null,
        message: 'Client ROYALE MAREE introuvable sur ce magasin.',
      });
    }
    const settlement = await buildSettlement(req.dbPool, {
      storeId: req.user.store_id,
      from,
      to,
      deliveredClientId,
      commissionRate,
    });
    return res.json({
      ok: true,
      from,
      to,
      commission_rate: commissionRate,
      royale_client: royaleClient,
      ...settlement,
      message: settlement.rows.length ? null : 'Aucun BL ou facture Royale Maree trouve sur la periode.',
    });
  } catch (err) {
    console.error('Erreur settlement Royale Maree :', err);
    return res.status(500).json({ error: 'Erreur calcul settlement Royale Maree' });
  }
});

router.post('/royale-maree-settlement/credit-note', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    const body = req.body || {};
    const from = isoDate(clean(body.from));
    const to = isoDate(clean(body.to) || from);
    const commissionRate = num(body.commission_rate, 0.30);
    const deliveredClientId = clean(body.delivered_client_id);
    const documentDate = isoDate(clean(body.document_date));
    await db.query('BEGIN');
    const royaleClient = await findRoyaleClient(db, req.user.store_id);
    if (!royaleClient) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Client ROYALE MAREE introuvable' });
    }
    const settlement = await buildSettlement(db, {
      storeId: req.user.store_id,
      from,
      to,
      deliveredClientId,
      commissionRate,
    });
    if (!settlement.rows.length || settlement.totals.credit_amount_ht <= 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune commission Royale Maree a crediter sur cette periode' });
    }

    const reference = clean(body.reference_number) || await nextCreditNoteReference(db, req.user.store_id, documentDate);
    const week = weekNumber(from);
    const label = `Commission Royale Maree semaine ${week} - du ${from.split('-').reverse().join('/')} au ${to.split('-').reverse().join('/')} - ${settlement.totals.total_weight_kg.toFixed(3)} kg x ${commissionRate.toFixed(2)} EUR/kg`;
    const totalHt = money(settlement.totals.credit_amount_ht);
    const vatRate = royaleClient.is_vat_exempt ? 0 : num(royaleClient.vat_rate, 0);
    const vat = money(totalHt * vatRate / 100);
    const totalTtc = money(totalHt + vat);

    const created = await db.query(
      `
      INSERT INTO sales_documents (
        id, store_id, client_key, client_id, billed_client_id,
        document_date, status, document_type, origin, reference_number, notes,
        total_amount_ex_vat, total_vat_amount, total_amount_inc_vat,
        tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot,
        billed_client_name_snapshot, billed_client_code_snapshot,
        locked_at, validated_at, pennylane_status, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $3,
        $4::date, 'validated', 'CREDIT_NOTE', 'royale_maree_settlement', $5, $6,
        $7, $8, $9, $10, $11, $12, $13, $14,
        NOW(), NOW(), 'not_sent', $15, $15
      )
      RETURNING id, reference_number, total_amount_ex_vat, total_amount_inc_vat
      `,
      [
        req.user.store_id,
        req.user.client_key || null,
        royaleClient.id,
        documentDate,
        reference,
        clean(body.notes) || `Commission centrale Royale Maree du ${from} au ${to}`,
        totalHt,
        vat,
        totalTtc,
        royaleClient.tariff_level || 1,
        vatRate,
        Boolean(royaleClient.is_vat_exempt),
        royaleClient.name,
        royaleClient.code,
        req.user.id,
      ]
    );

    await db.query(
      `
      INSERT INTO sales_lines (
        id, store_id, client_key, sales_document_id, line_number, article_label,
        total_weight, sold_quantity, sale_unit,
        unit_sale_price_ht, unit_sale_price_ttc, vat_rate,
        line_amount_ht, line_vat_amount, line_amount_ttc,
        unit_cost_ex_vat, line_margin_ex_vat, line_status, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 1, $4,
        $5, $5, 'kg',
        $6, $7, $8,
        $9, $10, $11,
        0, $9, 'credited', $12, $12
      )
      `,
      [
        req.user.store_id,
        req.user.client_key || null,
        created.rows[0].id,
        label,
        settlement.totals.total_weight_kg,
        commissionRate,
        commissionRate * (1 + vatRate / 100),
        vatRate,
        totalHt,
        vat,
        totalTtc,
        req.user.id,
      ]
    );

    await db.query('COMMIT');
    return res.status(201).json({
      ok: true,
      credit_note_id: created.rows[0].id,
      credit_note_reference: created.rows[0].reference_number,
      royale_client: royaleClient,
      label,
      totals: settlement.totals,
      amount_ht: totalHt,
      amount_ttc: totalTtc,
    });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur creation avoir Royale Maree :', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Numero avoir deja utilise, reessaie la creation' });
    return res.status(500).json({ error: 'Erreur creation avoir Royale Maree' });
  } finally {
    db.release();
  }
});

module.exports = router;
