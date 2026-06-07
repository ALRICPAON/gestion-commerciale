const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { DB_CLIENTS, getPoolByClientKey } = require('../dbRegistry');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
let schedulerStarted = false;
let lastAutomaticRunKey = null;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  return Number(num(value).toFixed(2));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value, fallback) {
  const raw = clean(value);
  if (!raw) return fallback;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function periodRange(query = {}) {
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const period = clean(query.period) || 'day';

  if (period === 'custom') {
    const from = parseDate(query.from, utcToday);
    const to = parseDate(query.to, from);
    return { period, from, to };
  }

  if (period === 'week') {
    const day = utcToday.getUTCDay() || 7;
    const from = addDays(utcToday, 1 - day);
    return { period, from, to: addDays(from, 6) };
  }

  if (period === 'month') {
    const from = new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth(), 1));
    const to = new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth() + 1, 0));
    return { period, from, to };
  }

  return { period: 'day', from: utcToday, to: utcToday };
}

function rangeBounds(range) {
  const fromStart = `${isoDate(range.from)}T00:00:00.000Z`;
  const toEnd = `${isoDate(range.to)}T23:59:59.999Z`;
  return { fromDate: isoDate(range.from), toDate: isoDate(range.to), fromStart, toEnd };
}

async function createStockSnapshot(db, { storeId, snapshotType = 'manual', snapshotDate = new Date(), createdBy = null }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (snapshotType === 'automatic') {
      const existing = await client.query(
        `SELECT id, snapshot_date, total_value_ht
         FROM stock_snapshots
         WHERE store_id = $1
           AND snapshot_type = 'automatic'
           AND snapshot_date >= $2::date
           AND snapshot_date < ($2::date + INTERVAL '1 day')
         LIMIT 1`,
        [storeId, isoDate(snapshotDate)]
      );
      if (existing.rows.length) {
        await client.query('COMMIT');
        return { snapshot: existing.rows[0], reused: true };
      }
    }

    const totalResult = await client.query(
      `SELECT COALESCE(SUM(qty_remaining * COALESCE(unit_cost_ex_vat, 0)), 0) AS total_value_ht
       FROM lots
       WHERE store_id = $1
         AND qty_remaining <> 0`,
      [storeId]
    );
    const totalValue = num(totalResult.rows[0]?.total_value_ht);

    const snapshotResult = await client.query(
      `INSERT INTO stock_snapshots(id, store_id, snapshot_date, snapshot_type, total_value_ht, created_by)
       VALUES(gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING id, store_id, snapshot_date, snapshot_type, total_value_ht, created_at, created_by`,
      [storeId, snapshotDate, snapshotType, totalValue, createdBy]
    );
    const snapshot = snapshotResult.rows[0];

    await client.query(
      `INSERT INTO stock_snapshot_lines(id, snapshot_id, article_id, lot_id, quantity, unit_cost_ht, total_value_ht)
       SELECT gen_random_uuid(), $1, article_id, id, qty_remaining,
         COALESCE(unit_cost_ex_vat, 0),
         qty_remaining * COALESCE(unit_cost_ex_vat, 0)
       FROM lots
       WHERE store_id = $2
         AND qty_remaining <> 0`,
      [snapshot.id, storeId]
    );

    await client.query('COMMIT');
    return { snapshot, reused: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function latestSnapshotBefore(db, storeId, bound) {
  const result = await db.query(
    `SELECT id, snapshot_date, snapshot_type, total_value_ht
     FROM stock_snapshots
     WHERE store_id = $1
       AND snapshot_date <= $2
     ORDER BY snapshot_date DESC
     LIMIT 1`,
    [storeId, bound]
  );
  return result.rows[0] || null;
}

async function salesTotals(db, storeId, fromDate, toDate) {
  const result = await db.query(
    `SELECT
       COALESCE(SUM(total_amount_ex_vat), 0) AS ca_ht,
       COALESCE(SUM(total_amount_inc_vat), 0) AS ca_ttc
     FROM sales_documents sd
     WHERE sd.store_id = $1
       AND sd.document_date >= $2::date
       AND sd.document_date <= $3::date
       AND sd.status NOT IN ('draft', 'cancelled')
       AND (
         sd.document_type IN ('INVOICE', 'manual_sale', 'inventory_sale')
         OR (
           sd.document_type = 'DELIVERY_NOTE'
           AND NOT EXISTS (
             SELECT 1 FROM sales_documents inv
             WHERE inv.store_id = sd.store_id
               AND inv.document_type = 'INVOICE'
               AND inv.source_delivery_note_id = sd.id
           )
         )
       )`,
    [storeId, fromDate, toDate]
  );
  return result.rows[0] || { ca_ht: 0, ca_ttc: 0 };
}

async function purchaseTotals(db, storeId, fromDate, toDate) {
  const result = await db.query(
    `SELECT COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht
     FROM purchases p
     JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
     WHERE p.store_id = $1
       AND COALESCE(p.receipt_date, p.purchase_date) >= $2::date
       AND COALESCE(p.receipt_date, p.purchase_date) <= $3::date
       AND p.status <> 'cancelled'`,
    [storeId, fromDate, toDate]
  );
  return result.rows[0] || { purchases_ht: 0 };
}

async function dashboard(db, storeId, range) {
  const bounds = rangeBounds(range);
  const [initialSnapshot, finalSnapshot, sales, purchases] = await Promise.all([
    latestSnapshotBefore(db, storeId, bounds.fromStart),
    latestSnapshotBefore(db, storeId, bounds.toEnd),
    salesTotals(db, storeId, bounds.fromDate, bounds.toDate),
    purchaseTotals(db, storeId, bounds.fromDate, bounds.toDate),
  ]);

  const hasSnapshots = Boolean(initialSnapshot && finalSnapshot);
  const caHt = money(sales.ca_ht);
  const caTtc = money(sales.ca_ttc);
  const purchasesHt = money(purchases.purchases_ht);
  const stockInitialHt = hasSnapshots ? money(initialSnapshot.total_value_ht) : null;
  const stockFinalHt = hasSnapshots ? money(finalSnapshot.total_value_ht) : null;
  const consumedPurchasesHt = hasSnapshots ? money(purchasesHt + stockInitialHt - stockFinalHt) : null;
  const grossMarginHt = hasSnapshots ? money(caHt - consumedPurchasesHt) : null;
  const marginRate = hasSnapshots && caHt > 0 ? Number(((grossMarginHt / caHt) * 100).toFixed(2)) : null;

  return {
    period: range.period,
    from: bounds.fromDate,
    to: bounds.toDate,
    kpis: {
      ca_ht: caHt,
      ca_ttc: caTtc,
      purchases_ht: purchasesHt,
      stock_initial_ht: stockInitialHt,
      stock_final_ht: stockFinalHt,
      consumed_purchases_ht: consumedPurchasesHt,
      gross_margin_ht: grossMarginHt,
      margin_rate: marginRate,
    },
    snapshots: {
      available: hasSnapshots,
      initial: initialSnapshot,
      final: finalSnapshot,
      message: hasSnapshots ? null : 'Capture de stock manquante pour calculer stock initial, stock final, achats consommes et marge.',
    },
    formula: {
      consumed_purchases_ht: 'Achats periode + Stock initial - Stock final',
      gross_margin_ht: 'CA HT - Achats consommes HT',
      margin_rate: 'Marge brute HT / CA HT',
    },
    chart: [
      { label: 'CA HT', value: caHt },
      { label: 'Achats HT', value: purchasesHt },
      { label: 'Marge HT', value: grossMarginHt || 0 },
    ],
  };
}

router.post('/stock-snapshots', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const type = clean(req.body?.snapshot_type) === 'automatic' ? 'automatic' : 'manual';
    const snapshotDate = clean(req.body?.snapshot_date) ? new Date(req.body.snapshot_date) : new Date();
    const result = await createStockSnapshot(req.dbPool, {
      storeId: req.user.store_id,
      snapshotType: type,
      snapshotDate,
      createdBy: req.user.id,
    });
    res.status(result.reused ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    console.error('Erreur creation capture stock :', error);
    res.status(500).json({ error: 'Erreur creation capture stock' });
  }
});

router.get('/stock-snapshots', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    let where = 'WHERE store_id = $1';
    if (clean(req.query.from)) {
      params.push(req.query.from);
      where += ` AND snapshot_date >= $${params.length}::date`;
    }
    if (clean(req.query.to)) {
      params.push(req.query.to);
      where += ` AND snapshot_date < ($${params.length}::date + INTERVAL '1 day')`;
    }
    params.push(Math.min(Number(req.query.limit) || 50, 500));
    const result = await req.dbPool.query(
      `SELECT id, store_id, snapshot_date, snapshot_type, total_value_ht, created_at, created_by
       FROM stock_snapshots
       ${where}
       ORDER BY snapshot_date DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur liste captures stock :', error);
    res.status(500).json({ error: 'Erreur liste captures stock' });
  }
});

router.get('/dashboard', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const range = periodRange(req.query || {});
    const result = await dashboard(req.dbPool, req.user.store_id, range);
    res.json(result);
  } catch (error) {
    console.error('Erreur dashboard :', error);
    res.status(500).json({ error: 'Erreur dashboard' });
  }
});

async function automaticSnapshotForPool(pool, clientKey) {
  const stores = await pool.query(
    `SELECT DISTINCT store_id FROM stock_summary
     UNION
     SELECT DISTINCT store_id FROM lots`
  );
  for (const row of stores.rows) {
    try {
      await createStockSnapshot(pool, {
        storeId: row.store_id,
        snapshotType: 'automatic',
        snapshotDate: new Date(),
        createdBy: null,
      });
      console.info('Capture stock automatique 22h creee', { client_key: clientKey, store_id: row.store_id });
    } catch (error) {
      console.error('Erreur capture stock automatique 22h', { client_key: clientKey, store_id: row.store_id, error: error.message });
    }
  }
}

function startAutomaticStockSnapshotScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    const now = new Date();
    if (now.getHours() !== 22) return;
    const runKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}`;
    if (lastAutomaticRunKey === runKey) return;
    lastAutomaticRunKey = runKey;

    for (const clientKey of Object.keys(DB_CLIENTS)) {
      try {
        await automaticSnapshotForPool(getPoolByClientKey(clientKey), clientKey);
      } catch (error) {
        console.error('Erreur planificateur capture stock', { client_key: clientKey, error: error.message });
      }
    }
  };

  setInterval(tick, 15 * 60 * 1000);
  tick().catch((error) => console.error('Erreur demarrage planificateur captures stock', error));
}

startAutomaticStockSnapshotScheduler();

module.exports = router;
