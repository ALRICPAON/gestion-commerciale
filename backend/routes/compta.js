const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(value, base) {
  return base > 0 ? (value / base) * 100 : 0;
}

async function computeDaily(client, { storeId, departmentId, date }) {
  const closureRes = await client.query(
    `
    SELECT *
    FROM compta_daily_closures
    WHERE store_id = $1
      AND department_id = $2
      AND closure_date = $3
    `,
    [storeId, departmentId, date]
  );

  const existing = closureRes.rows[0] || {};

  const previousRes = await client.query(
    `
    SELECT stock_end_value_ht
    FROM compta_daily_closures
    WHERE store_id = $1
      AND department_id = $2
      AND closure_date < $3
      AND validated = true
    ORDER BY closure_date DESC
    LIMIT 1
    `,
    [storeId, departmentId, date]
  );

  const purchasesRes = await client.query(
    `
    SELECT COALESCE(SUM(total_amount_ex_vat), 0) AS purchases_ht
    FROM purchases
    WHERE store_id = $1
      AND department_id = $2
      AND purchase_date = $3
      AND status IN ('received', 'closed')
    `,
    [storeId, departmentId, date]
  );

  const theoreticalRes = await client.query(
    `
    SELECT
      COALESCE(SUM(sl.line_total_ht), 0) AS theoretical_ca_ht,
      COALESCE(SUM(sl.line_cost_ex_vat), 0) AS theoretical_cost_ht
    FROM sales_lines sl
    JOIN sales_documents sd ON sd.id = sl.sales_document_id
    WHERE sd.store_id = $1
      AND sd.department_id = $2
      AND sd.document_date = $3
      AND sd.status = 'validated'
    `,
    [storeId, departmentId, date]
  );

  const stockStart = num(previousRes.rows[0]?.stock_end_value_ht);
  const purchasesHt = num(purchasesRes.rows[0]?.purchases_ht);
  const stockEnd = num(existing.stock_end_value_ht);
  const caReal = num(existing.ca_real_ht);
  const caN1 = num(existing.ca_n1_ht);

  const theoreticalCa = num(theoreticalRes.rows[0]?.theoretical_ca_ht);
  const theoreticalCost = num(theoreticalRes.rows[0]?.theoretical_cost_ht);
  const theoreticalMargin = theoreticalCa - theoreticalCost;

  const realConsumedCost = stockStart + purchasesHt - stockEnd;
  const realMargin = caReal - realConsumedCost;

  return {
    stock_start_value_ht: stockStart,
    purchases_ht: purchasesHt,
    real_consumed_cost_ht: realConsumedCost,
    real_margin_ht: realMargin,
    real_margin_pct: pct(realMargin, caReal),

    theoretical_ca_ht: theoreticalCa,
    theoretical_cost_ht: theoreticalCost,
    theoretical_margin_ht: theoreticalMargin,
    theoretical_margin_pct: pct(theoreticalMargin, theoreticalCa),

    delta_ca_real_vs_theoretical: caReal - theoreticalCa,
    delta_margin_real_vs_theoretical: realMargin - theoreticalMargin,

    delta_ca_vs_n1: caReal - caN1,
    delta_ca_vs_n1_pct: pct(caReal - caN1, caN1),
  };
}

async function rebuildDailyArticleTheoreticalLines(client, { storeId, departmentId, date }) {
  await client.query(
    `
    DELETE FROM compta_daily_article_theoretical_lines
    WHERE store_id = $1
      AND department_id = $2
      AND closure_date = $3
    `,
    [storeId, departmentId, date]
  );

  const linesRes = await client.query(
    `
    SELECT
      sl.id AS source_line_id,
      sd.id AS source_document_id,
      sl.article_id,
      a.plu AS article_plu,
      COALESCE(sl.article_label, a.designation, '') AS article_label,
      sl.sold_quantity,
      sl.sale_unit,
      sl.unit_sale_price_ht,
      sl.unit_cost_ex_vat,
      sl.line_total_ht,
      sl.line_cost_ex_vat
    FROM sales_lines sl
    JOIN sales_documents sd ON sd.id = sl.sales_document_id
    LEFT JOIN articles a ON a.id = sl.article_id
    WHERE sd.store_id = $1
      AND sd.department_id = $2
      AND sd.document_date = $3
      AND sd.status = 'validated'
      AND sl.line_status = 'validated'
    ORDER BY article_label ASC
    `,
    [storeId, departmentId, date]
  );

  for (const line of linesRes.rows) {
    const qty = num(line.sold_quantity);
    const unitSalePriceHt = num(line.unit_sale_price_ht);
    const unitCostHt = num(line.unit_cost_ex_vat);

    const theoreticalCaHt = num(line.line_total_ht) || qty * unitSalePriceHt;
    const theoreticalCostHt = num(line.line_cost_ex_vat) || qty * unitCostHt;
    const theoreticalMarginHt = theoreticalCaHt - theoreticalCostHt;
    const theoreticalMarginPct = pct(theoreticalMarginHt, theoreticalCaHt);

    const pricingIssue = unitSalePriceHt <= 0 || theoreticalCaHt <= 0;
    const costIssue = unitCostHt <= 0 || theoreticalCostHt <= 0;
    const negativeMargin = theoreticalMarginHt < 0;

    const notes = [];
    if (pricingIssue) notes.push('PV absent ou CA théorique nul');
    if (costIssue) notes.push('Coût absent ou nul');
    if (negativeMargin) notes.push('Marge négative');

    await client.query(
      `
      INSERT INTO compta_daily_article_theoretical_lines (
        store_id,
        department_id,
        closure_date,
        article_id,
        article_plu,
        article_label,
        qty_sold_theoretical,
        sale_unit,
        unit_sale_price_ht,
        unit_cost_ht,
        theoretical_ca_ht,
        theoretical_cost_ht,
        theoretical_margin_ht,
        theoretical_margin_pct,
        pricing_issue,
        cost_issue,
        negative_margin,
        anomaly_note,
        source_document_id,
        source_line_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
      `,
      [
        storeId,
        departmentId,
        date,
        line.article_id,
        line.article_plu,
        line.article_label,
        qty,
        line.sale_unit,
        unitSalePriceHt,
        unitCostHt,
        theoreticalCaHt,
        theoreticalCostHt,
        theoreticalMarginHt,
        theoreticalMarginPct,
        pricingIssue,
        costIssue,
        negativeMargin,
        notes.join(' / ') || null,
        line.source_document_id,
        line.source_line_id,
      ]
    );
  }
}

router.use(authenticateToken);
router.use(attachDbContext);
router.use(requireAdminOrManager);

router.get('/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { department_id } = req.query;
    const storeId = req.user.store_id;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const closureRes = await req.dbPool.query(
      `
      SELECT *
      FROM compta_daily_closures
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date = $3
      `,
      [storeId, department_id, date]
    );

    const client = await req.dbPool.connect();
    let computed;
    try {
      computed = await computeDaily(client, {
        storeId,
        departmentId: department_id,
        date,
      });
    } finally {
      client.release();
    }

    res.json({
      closure: closureRes.rows[0] || null,
      computed,
    });
  } catch (err) {
    console.error('GET /api/compta/daily/:date', err);
    res.status(500).json({ error: 'Erreur chargement compta journee' });
  }
});

router.post('/daily/save-inputs', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const userId = req.user.id;

    const {
      department_id,
      closure_date,
      ca_real_ht,
      ca_n1_ht,
      stock_end_value_ht,
      notes,
    } = req.body;

    if (!department_id || !closure_date) {
      return res.status(400).json({ error: 'department_id et closure_date obligatoires' });
    }

    const existingRes = await req.dbPool.query(
      `
      SELECT validated
      FROM compta_daily_closures
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date = $3
      `,
      [storeId, department_id, closure_date]
    );

    if (existingRes.rows[0]?.validated) {
      return res.status(400).json({ error: 'Journee deja validee' });
    }

    const result = await req.dbPool.query(
      `
      INSERT INTO compta_daily_closures (
        store_id,
        department_id,
        closure_date,
        ca_real_ht,
        ca_n1_ht,
        stock_end_value_ht,
        notes,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (store_id, department_id, closure_date)
      DO UPDATE SET
        ca_real_ht = EXCLUDED.ca_real_ht,
        ca_n1_ht = EXCLUDED.ca_n1_ht,
        stock_end_value_ht = EXCLUDED.stock_end_value_ht,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
      `,
      [
        storeId,
        department_id,
        closure_date,
        num(ca_real_ht),
        num(ca_n1_ht),
        num(stock_end_value_ht),
        notes || null,
      ]
    );

    res.json({ closure: result.rows[0], updated_by: userId });
  } catch (err) {
    console.error('POST /api/compta/daily/save-inputs', err);
    res.status(500).json({ error: 'Erreur sauvegarde saisie compta' });
  }
});

router.post('/daily/compute', async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const storeId = req.user.store_id;
    const { department_id, closure_date } = req.body;

    if (!department_id || !closure_date) {
      return res.status(400).json({ error: 'department_id et closure_date obligatoires' });
    }

    await client.query('BEGIN');

    const computed = await computeDaily(client, {
      storeId,
      departmentId: department_id,
      date: closure_date,
    });

    await rebuildDailyArticleTheoreticalLines(client, {
  storeId,
  departmentId: department_id,
  date: closure_date,
});

    const result = await client.query(
      `
      UPDATE compta_daily_closures
      SET
        stock_start_value_ht = $4,
        purchases_ht = $5,
        real_consumed_cost_ht = $6,
        real_margin_ht = $7,
        real_margin_pct = $8,
        theoretical_ca_ht = $9,
        theoretical_cost_ht = $10,
        theoretical_margin_ht = $11,
        theoretical_margin_pct = $12,
        delta_ca_real_vs_theoretical = $13,
        delta_margin_real_vs_theoretical = $14,
        delta_ca_vs_n1 = $15,
        delta_ca_vs_n1_pct = $16,
        updated_at = NOW()
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date = $3
        AND validated = false
      RETURNING *
      `,
      [
        storeId,
        department_id,
        closure_date,
        computed.stock_start_value_ht,
        computed.purchases_ht,
        computed.real_consumed_cost_ht,
        computed.real_margin_ht,
        computed.real_margin_pct,
        computed.theoretical_ca_ht,
        computed.theoretical_cost_ht,
        computed.theoretical_margin_ht,
        computed.theoretical_margin_pct,
        computed.delta_ca_real_vs_theoretical,
        computed.delta_margin_real_vs_theoretical,
        computed.delta_ca_vs_n1,
        computed.delta_ca_vs_n1_pct,
      ]
    );

    await client.query('COMMIT');

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Journee introuvable ou deja validee' });
    }

    res.json({ closure: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/compta/daily/compute', err);
    res.status(500).json({ error: 'Erreur calcul compta journee' });
  } finally {
    client.release();
  }
});

router.post('/daily/validate', async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const storeId = req.user.store_id;
    const userId = req.user.id;
    const { department_id, closure_date } = req.body;

    if (!department_id || !closure_date) {
      return res.status(400).json({ error: 'department_id et closure_date obligatoires' });
    }

    await client.query('BEGIN');

    const computed = await computeDaily(client, {
      storeId,
      departmentId: department_id,
      date: closure_date,
    });

    await rebuildDailyArticleTheoreticalLines(client, {
  storeId,
  departmentId: department_id,
  date: closure_date,
});

    const result = await client.query(
      `
      UPDATE compta_daily_closures
      SET
        stock_start_value_ht = $4,
        purchases_ht = $5,
        real_consumed_cost_ht = $6,
        real_margin_ht = $7,
        real_margin_pct = $8,
        theoretical_ca_ht = $9,
        theoretical_cost_ht = $10,
        theoretical_margin_ht = $11,
        theoretical_margin_pct = $12,
        delta_ca_real_vs_theoretical = $13,
        delta_margin_real_vs_theoretical = $14,
        delta_ca_vs_n1 = $15,
        delta_ca_vs_n1_pct = $16,
        validated = true,
        validated_at = NOW(),
        validated_by = $17,
        updated_at = NOW()
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date = $3
        AND validated = false
      RETURNING *
      `,
      [
        storeId,
        department_id,
        closure_date,
        computed.stock_start_value_ht,
        computed.purchases_ht,
        computed.real_consumed_cost_ht,
        computed.real_margin_ht,
        computed.real_margin_pct,
        computed.theoretical_ca_ht,
        computed.theoretical_cost_ht,
        computed.theoretical_margin_ht,
        computed.theoretical_margin_pct,
        computed.delta_ca_real_vs_theoretical,
        computed.delta_margin_real_vs_theoretical,
        computed.delta_ca_vs_n1,
        computed.delta_ca_vs_n1_pct,
        userId,
      ]
    );

    await client.query('COMMIT');

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Journee introuvable ou deja validee' });
    }

    res.json({ closure: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/compta/daily/validate', err);
    res.status(500).json({ error: 'Erreur validation compta journee' });
  } finally {
    client.release();
  }
});

router.delete('/daily/:date/validation', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { date } = req.params;
    const { department_id } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const result = await req.dbPool.query(
      `
      UPDATE compta_daily_closures
      SET
        validated = false,
        validated_at = NULL,
        validated_by = NULL,
        updated_at = NOW()
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date = $3
      RETURNING *
      `,
      [storeId, department_id, date]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Journee introuvable' });
    }

    res.json({ closure: result.rows[0] });
  } catch (err) {
    console.error('DELETE /api/compta/daily/:date/validation', err);
    res.status(500).json({ error: 'Erreur annulation validation compta' });
  }
});

router.get('/period', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { department_id, start_date, end_date } = req.query;

    if (!department_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'department_id, start_date et end_date obligatoires'
      });
    }

    const summaryRes = await req.dbPool.query(
      `
      WITH period_rows AS (
        SELECT *
        FROM compta_daily_closures
        WHERE store_id = $1
          AND department_id = $2
          AND closure_date BETWEEN $3 AND $4
          AND validated = true
      ),
      first_row AS (
        SELECT stock_start_value_ht
        FROM period_rows
        ORDER BY closure_date ASC
        LIMIT 1
      ),
      last_row AS (
        SELECT stock_end_value_ht
        FROM period_rows
        ORDER BY closure_date DESC
        LIMIT 1
      )
      SELECT
        COUNT(*) AS days_count,

        COALESCE((SELECT stock_start_value_ht FROM first_row), 0) AS stock_start_value_ht,
        COALESCE((SELECT stock_end_value_ht FROM last_row), 0) AS stock_end_value_ht,

        COALESCE(SUM(ca_real_ht), 0) AS ca_real_ht,
        COALESCE(SUM(ca_n1_ht), 0) AS ca_n1_ht,

        COALESCE(SUM(purchases_ht), 0) AS purchases_ht,
        COALESCE(SUM(real_consumed_cost_ht), 0) AS real_consumed_cost_ht,
        COALESCE(SUM(real_margin_ht), 0) AS real_margin_ht,

        COALESCE(SUM(theoretical_ca_ht), 0) AS theoretical_ca_ht,
        COALESCE(SUM(theoretical_cost_ht), 0) AS theoretical_cost_ht,
        COALESCE(SUM(theoretical_margin_ht), 0) AS theoretical_margin_ht,

        COALESCE(SUM(delta_ca_real_vs_theoretical), 0) AS delta_ca_real_vs_theoretical,
        COALESCE(SUM(delta_margin_real_vs_theoretical), 0) AS delta_margin_real_vs_theoretical,
        COALESCE(SUM(delta_ca_vs_n1), 0) AS delta_ca_vs_n1
      FROM period_rows
      `,
      [storeId, department_id, start_date, end_date]
    );

    const daysRes = await req.dbPool.query(
      `
      SELECT *
      FROM compta_daily_closures
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date BETWEEN $3 AND $4
        AND validated = true
      ORDER BY closure_date ASC
      `,
      [storeId, department_id, start_date, end_date]
    );

    const s = summaryRes.rows[0];

    const caReal = num(s.ca_real_ht);
    const caN1 = num(s.ca_n1_ht);
    const realMargin = num(s.real_margin_ht);
    const theoreticalCa = num(s.theoretical_ca_ht);
    const theoreticalMargin = num(s.theoretical_margin_ht);

    res.json({
      summary: {
        ...s,
        real_margin_pct: pct(realMargin, caReal),
        theoretical_margin_pct: pct(theoreticalMargin, theoreticalCa),
        delta_ca_vs_n1_pct: pct(caReal - caN1, caN1),
      },
      days: daysRes.rows,
    });
  } catch (err) {
    console.error('GET /api/compta/period', err);
    res.status(500).json({ error: 'Erreur chargement dashboard compta' });
  }
});

router.get('/suppliers', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { department_id } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const result = await req.dbPool.query(
      `
      SELECT id, code, name
      FROM suppliers
      WHERE store_id = $1
      ORDER BY name ASC
      `,
      [storeId]
    );

    res.json({ suppliers: result.rows });
  } catch (err) {
    console.error('GET /api/compta/suppliers', err);
    res.status(500).json({ error: 'Erreur chargement fournisseurs' });
  }
});

router.get('/supplier-purchases', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const {
      department_id,
      supplier_id,
      start_date,
      end_date,
      mode = 'open',
      invoice_id
    } = req.query;

    if (!department_id || !supplier_id) {
      return res.status(400).json({ error: 'department_id et supplier_id obligatoires' });
    }

    const result = await req.dbPool.query(
      `
      SELECT
        p.id,
        p.purchase_date,
        p.document_number,
        p.total_amount_ex_vat,
        p.status,

        (
          SELECT sil.supplier_invoice_id
          FROM supplier_invoice_links sil
          WHERE sil.purchase_id = p.id
          LIMIT 1
        ) AS linked_invoice_id,

        CASE
          WHEN EXISTS (
            SELECT 1
            FROM supplier_invoice_links sil
            WHERE sil.purchase_id = p.id
              AND ($7::uuid IS NULL OR sil.supplier_invoice_id <> $7::uuid)
          )
          THEN true
          ELSE false
        END AS already_linked

      FROM purchases p
      WHERE p.store_id = $1
        AND p.department_id = $2
        AND p.supplier_id = $3
        AND p.status IN ('received', 'closed')
        AND ($4::date IS NULL OR p.purchase_date >= $4::date)
        AND ($5::date IS NULL OR p.purchase_date <= $5::date)
        AND (
          $6 = 'all'
          OR NOT EXISTS (
            SELECT 1
            FROM supplier_invoice_links sil
            WHERE sil.purchase_id = p.id
              AND ($7::uuid IS NULL OR sil.supplier_invoice_id <> $7::uuid)
          )
        )
      ORDER BY p.purchase_date DESC
      `,
      [
        storeId,
        department_id,
        supplier_id,
        start_date || null,
        end_date || null,
        mode,
        invoice_id || null
      ]
    );

    res.json({ purchases: result.rows });
  } catch (err) {
    console.error('GET /api/compta/supplier-purchases', err);
    res.status(500).json({ error: 'Erreur chargement achats fournisseur' });
  }
});

router.get('/purchase-lines/:purchaseId', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { purchaseId } = req.params;
    const { department_id } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const result = await req.dbPool.query(
  `
  SELECT
    pl.id,
    pl.article_id,
    COALESCE(pl.supplier_label, a.designation, '') AS article_label,
    pl.ordered_quantity,
    pl.received_quantity,
    pl.unit_price_ex_vat,
    pl.line_amount_ex_vat AS line_total_ex_vat,
    EXISTS (
      SELECT 1
      FROM supplier_invoice_links sil
      WHERE sil.purchase_line_id = pl.id
    ) AS already_linked
  FROM purchase_lines pl
  JOIN purchases p ON p.id = pl.purchase_id
  LEFT JOIN articles a ON a.id = pl.article_id
  WHERE p.id = $1
    AND p.store_id = $2
    AND p.department_id = $3
  ORDER BY pl.line_number ASC
  `,
  [purchaseId, storeId, department_id]
);

    res.json({ lines: result.rows });
  } catch (err) {
    console.error('GET /api/compta/purchase-lines/:purchaseId', err);
    res.status(500).json({ error: 'Erreur chargement lignes achat' });
  }
});

router.post('/supplier-invoices', async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const storeId = req.user.store_id;
    const userId = req.user.id;

    const {
      department_id,
      supplier_id,
      invoice_date,
      invoice_number,
      amount_ht,
      validated_amount_ht,
      notes,
      links
    } = req.body;

    if (!department_id || !supplier_id || !invoice_date || !invoice_number) {
      return res.status(400).json({ error: 'Champs facture obligatoires manquants' });
    }

    if (!Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ error: 'Aucun achat ou ligne pointé' });
    }

    await client.query('BEGIN');

    const totalLinked = links.reduce(
      (sum, l) => sum + Number(l.linked_amount_ht || 0),
      0
    );

    const invoiceAmount = Number(amount_ht || 0);
    const realAmount = Number(validated_amount_ht || invoiceAmount);
    const gap = realAmount - totalLinked;

    const status = Math.abs(gap) < 0.01 ? 'validated' : 'validated';

    const invoiceRes = await client.query(
      `
      INSERT INTO supplier_invoices (
        store_id,
        department_id,
        supplier_id,
        invoice_date,
        invoice_number,
        amount_ht,
        validated_amount_ht,
        gap_ht,
        status,
        notes,
        created_by,
        validated_by,
        validated_at,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,NOW(),NOW(),NOW())
      RETURNING *
      `,
      [
        storeId,
        department_id,
        supplier_id,
        invoice_date,
        invoice_number,
        invoiceAmount,
        realAmount,
        gap,
        status,
        notes || null,
        userId
      ]
    );

    const invoice = invoiceRes.rows[0];

    for (const link of links) {
      await client.query(
        `
        INSERT INTO supplier_invoice_links (
          supplier_invoice_id,
          purchase_id,
          purchase_line_id,
          linked_amount_ht
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          invoice.id,
          link.purchase_id || null,
          link.purchase_line_id || null,
          Number(link.linked_amount_ht || 0)
        ]
      );
    }

    await client.query('COMMIT');

    res.json({
      invoice,
      total_linked_ht: totalLinked,
      gap_ht: gap
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/compta/supplier-invoices', err);
    res.status(500).json({ error: 'Erreur validation facture fournisseur' });
  } finally {
    client.release();
  }
});

router.get('/supplier-invoices', async (req, res) => {
  try {
    const storeId = req.user.store_id;

    const {
      department_id,
      supplier_id,
      start_date,
      end_date,
      status,
      search
    } = req.query;

    if (!department_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'department_id, start_date et end_date obligatoires'
      });
    }

    const result = await req.dbPool.query(
      `
      SELECT
        si.id,
        si.invoice_date,
        si.invoice_number,
        si.amount_ht,
        si.validated_amount_ht,
        si.gap_ht,
        si.status,
        si.notes,
        s.code AS supplier_code,
        s.name AS supplier_name
      FROM supplier_invoices si
      LEFT JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.store_id = $1
        AND si.department_id = $2
        AND si.invoice_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR si.supplier_id = $5::uuid)
        AND ($6::text IS NULL OR si.status = $6::text)
        AND (
          $7::text IS NULL
          OR LOWER(si.invoice_number) LIKE LOWER('%' || $7::text || '%')
        )
      ORDER BY si.invoice_date DESC, si.created_at DESC
      `,
      [
        storeId,
        department_id,
        start_date,
        end_date,
        supplier_id || null,
        status || null,
        search || null
      ]
    );

    res.json({ invoices: result.rows });
  } catch (err) {
    console.error('GET /api/compta/supplier-invoices', err);
    res.status(500).json({ error: 'Erreur chargement factures lettrées' });
  }
});

router.get('/supplier-invoices/:id', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { id } = req.params;
    const { department_id } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const invoiceRes = await req.dbPool.query(
      `
      SELECT
        si.*,
        s.code AS supplier_code,
        s.name AS supplier_name
      FROM supplier_invoices si
      LEFT JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.id = $1
        AND si.store_id = $2
        AND si.department_id = $3
      `,
      [id, storeId, department_id]
    );

    const invoice = invoiceRes.rows[0];

    if (!invoice) {
      return res.status(404).json({ error: 'Facture introuvable' });
    }

    const linksRes = await req.dbPool.query(
      `
      SELECT
        sil.id,
        sil.purchase_id,
        sil.purchase_line_id,
        sil.linked_amount_ht,

        p.purchase_date,
        p.document_number,
        p.total_amount_ex_vat,

        pl.supplier_label,
        pl.line_amount_ex_vat
      FROM supplier_invoice_links sil
      LEFT JOIN purchases p ON p.id = sil.purchase_id
      LEFT JOIN purchase_lines pl ON pl.id = sil.purchase_line_id
      WHERE sil.supplier_invoice_id = $1
      ORDER BY p.purchase_date DESC, p.document_number ASC
      `,
      [id]
    );

    res.json({
      invoice,
      links: linksRes.rows
    });
  } catch (err) {
    console.error('GET /api/compta/supplier-invoices/:id', err);
    res.status(500).json({ error: 'Erreur détail facture lettrée' });
  }
});

router.put('/supplier-invoices/:id', async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const storeId = req.user.store_id;
    const userId = req.user.id;
    const { id } = req.params;

    const {
      department_id,
      supplier_id,
      invoice_date,
      invoice_number,
      amount_ht,
      validated_amount_ht,
      notes,
      links
    } = req.body;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    if (!Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ error: 'Aucun achat ou ligne pointé' });
    }

    await client.query('BEGIN');

    // Vérifier que la facture existe
    const invoiceCheckRes = await client.query(
      `
      SELECT *
      FROM supplier_invoices
      WHERE id = $1
        AND store_id = $2
        AND department_id = $3
      `,
      [id, storeId, department_id]
    );

    if (invoiceCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture introuvable' });
    }

    // Calculer totaux
    const totalLinked = links.reduce(
      (sum, l) => sum + Number(l.linked_amount_ht || 0),
      0
    );

    const invoiceAmount = Number(amount_ht || 0);
    const realAmount = Number(validated_amount_ht || invoiceAmount);
    const gap = realAmount - totalLinked;

    // Supprimer les anciens liens
    await client.query(
      `
      DELETE FROM supplier_invoice_links
      WHERE supplier_invoice_id = $1
      `,
      [id]
    );

    // Mettre à jour la facture
    const updateRes = await client.query(
      `
      UPDATE supplier_invoices
      SET
        supplier_id = $2,
        invoice_date = $3,
        invoice_number = $4,
        amount_ht = $5,
        validated_amount_ht = $6,
        gap_ht = $7,
        notes = $8,
        status = 'validated',
        validated_by = $9,
        validated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        supplier_id,
        invoice_date,
        invoice_number,
        invoiceAmount,
        realAmount,
        gap,
        notes || null,
        userId
      ]
    );

    const invoice = updateRes.rows[0];

    // Insérer les nouveaux liens
    for (const link of links) {
      await client.query(
        `
        INSERT INTO supplier_invoice_links (
          supplier_invoice_id,
          purchase_id,
          purchase_line_id,
          linked_amount_ht
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          id,
          link.purchase_id || null,
          link.purchase_line_id || null,
          Number(link.linked_amount_ht || 0)
        ]
      );
    }

    await client.query('COMMIT');

    res.json({
      invoice,
      total_linked_ht: totalLinked,
      gap_ht: gap
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/compta/supplier-invoices/:id', err);
    res.status(500).json({ error: 'Erreur modification facture fournisseur' });
  } finally {
    client.release();
  }
});

router.delete('/supplier-invoices/:id/unlink', async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const storeId = req.user.store_id;
    const { id } = req.params;
    const { department_id } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    await client.query('BEGIN');

    const invoiceRes = await client.query(
      `
      SELECT *
      FROM supplier_invoices
      WHERE id = $1
        AND store_id = $2
        AND department_id = $3
      `,
      [id, storeId, department_id]
    );

    const invoice = invoiceRes.rows[0];

    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture introuvable' });
    }

    await client.query(
      `
      DELETE FROM supplier_invoice_links
      WHERE supplier_invoice_id = $1
      `,
      [id]
    );

    await client.query(
      `
      UPDATE supplier_invoices
      SET
        status = 'draft',
        validated_by = NULL,
        validated_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      invoice_id: id,
      message: 'Facture déverrouillée, anciens liens supprimés'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/compta/supplier-invoices/:id/unlink', err);
    res.status(500).json({ error: 'Erreur déverrouillage facture' });
  } finally {
    client.release();
  }
});

router.get('/daily/:date/article-lines', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { date } = req.params;
    const { department_id, anomalies_only } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const params = [storeId, department_id, date];
    let where = `
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date = $3
    `;

    if (anomalies_only === 'true') {
      where += `
        AND (
          pricing_issue = true
          OR cost_issue = true
          OR negative_margin = true
        )
      `;
    }

    const result = await req.dbPool.query(
      `
      SELECT *
      FROM compta_daily_article_theoretical_lines
      ${where}
      ORDER BY
        pricing_issue DESC,
        cost_issue DESC,
        negative_margin DESC,
        theoretical_ca_ht DESC,
        article_label ASC
      `,
      params
    );

    res.json({ lines: result.rows });
  } catch (err) {
    console.error('GET /api/compta/daily/:date/article-lines', err);
    res.status(500).json({ error: 'Erreur chargement analyse articles' });
  }
});

router.get('/analysis', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { department_id, start_date, end_date, anomalies_only } = req.query;

    if (!department_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'department_id, start_date et end_date obligatoires'
      });
    }

    const summaryRes = await req.dbPool.query(
      `
      SELECT
        COUNT(*) AS line_count,
        COALESCE(SUM(qty_sold_theoretical), 0) AS total_qty,
        COALESCE(SUM(theoretical_ca_ht), 0) AS theoretical_ca_ht,
        COALESCE(SUM(theoretical_cost_ht), 0) AS theoretical_cost_ht,
        COALESCE(SUM(theoretical_margin_ht), 0) AS theoretical_margin_ht,

        COUNT(*) FILTER (WHERE pricing_issue = true) AS pricing_issues,
        COUNT(*) FILTER (WHERE cost_issue = true) AS cost_issues,
        COUNT(*) FILTER (WHERE negative_margin = true) AS negative_margins
      FROM compta_daily_article_theoretical_lines
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date BETWEEN $3 AND $4
      `,
      [storeId, department_id, start_date, end_date]
    );

    const articlesRes = await req.dbPool.query(
      `
      SELECT
        article_id,
        article_plu,
        article_label,
        sale_unit,

        COALESCE(SUM(qty_sold_theoretical), 0) AS qty_sold,
        COALESCE(SUM(theoretical_ca_ht), 0) AS ca_ht,
        COALESCE(SUM(theoretical_cost_ht), 0) AS cost_ht,
        COALESCE(SUM(theoretical_margin_ht), 0) AS margin_ht,

        CASE
          WHEN COALESCE(SUM(theoretical_ca_ht), 0) > 0
          THEN COALESCE(SUM(theoretical_margin_ht), 0) / COALESCE(SUM(theoretical_ca_ht), 0) * 100
          ELSE 0
        END AS margin_pct,

        BOOL_OR(pricing_issue) AS pricing_issue,
        BOOL_OR(cost_issue) AS cost_issue,
        BOOL_OR(negative_margin) AS negative_margin,

        STRING_AGG(DISTINCT anomaly_note, ' / ') FILTER (WHERE anomaly_note IS NOT NULL) AS anomaly_note
      FROM compta_daily_article_theoretical_lines
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date BETWEEN $3 AND $4
        AND (
          $5::boolean = false
          OR pricing_issue = true
          OR cost_issue = true
          OR negative_margin = true
        )
      GROUP BY article_id, article_plu, article_label, sale_unit
      ORDER BY
        BOOL_OR(pricing_issue) DESC,
        BOOL_OR(cost_issue) DESC,
        BOOL_OR(negative_margin) DESC,
        COALESCE(SUM(theoretical_margin_ht), 0) ASC,
        COALESCE(SUM(theoretical_ca_ht), 0) DESC
      LIMIT 300
      `,
      [
        storeId,
        department_id,
        start_date,
        end_date,
        anomalies_only === 'true'
      ]
    );

    const daysRes = await req.dbPool.query(
      `
      SELECT
        closure_date,
        ca_real_ht,
        theoretical_ca_ht,
        real_margin_ht,
        theoretical_margin_ht,
        delta_ca_real_vs_theoretical,
        delta_margin_real_vs_theoretical
      FROM compta_daily_closures
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date BETWEEN $3 AND $4
        AND validated = true
      ORDER BY closure_date ASC
      `,
      [storeId, department_id, start_date, end_date]
    );

    res.json({
      summary: summaryRes.rows[0],
      articles: articlesRes.rows,
      days: daysRes.rows
    });
  } catch (err) {
    console.error('GET /api/compta/analysis', err);
    res.status(500).json({ error: 'Erreur analyse comptabilité' });
  }
});

router.get('/supplier-stats', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { department_id, start_date, end_date, supplier_id } = req.query;

    if (!department_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'department_id, start_date et end_date obligatoires'
      });
    }

    const summaryRes = await req.dbPool.query(
      `
      SELECT
        COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht,
        COALESCE(SUM(pl.received_quantity), 0) AS total_volume
      FROM purchase_lines pl
      JOIN purchases p ON p.id = pl.purchase_id
      WHERE p.store_id = $1
        AND p.department_id = $2
        AND p.purchase_date BETWEEN $3 AND $4
        AND p.status IN ('received', 'closed')
        AND ($5::uuid IS NULL OR p.supplier_id = $5::uuid)
      `,
      [storeId, department_id, start_date, end_date, supplier_id || null]
    );

    const suppliersRes = await req.dbPool.query(
      `
      WITH supplier_purchases AS (
        SELECT
          s.id AS supplier_id,
          s.code,
          s.name,
          COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht,
          COALESCE(SUM(pl.received_quantity), 0) AS total_volume,
          COUNT(DISTINCT p.id) AS purchases_count,
          COUNT(DISTINCT pl.article_id) AS articles_count
        FROM suppliers s
        LEFT JOIN purchases p
          ON p.supplier_id = s.id
         AND p.store_id = $1
         AND p.department_id = $2
         AND p.purchase_date BETWEEN $3 AND $4
         AND p.status IN ('received', 'closed')
        LEFT JOIN purchase_lines pl
          ON pl.purchase_id = p.id
        WHERE s.store_id = $1
          AND ($5::uuid IS NULL OR s.id = $5::uuid)
        GROUP BY s.id, s.code, s.name
      ),

      supplier_sales AS (
        SELECT
          l.supplier_id,
          COALESCE(SUM(sm.quantity * sl.unit_sale_price_ht), 0) AS ca_ht,
          COALESCE(SUM(sm.quantity * sm.unit_cost_ex_vat), 0) AS cost_ht,
          COALESCE(SUM((sm.quantity * sl.unit_sale_price_ht) - (sm.quantity * sm.unit_cost_ex_vat)), 0) AS margin_ht
        FROM stock_movements sm
        JOIN lots l ON l.id = sm.lot_id
        JOIN sales_lines sl ON sl.id = sm.source_id
        JOIN sales_documents sd ON sd.id = sl.sales_document_id
        WHERE sm.store_id = $1
          AND sm.department_id = $2
          AND sm.source_table = 'sales_lines'
          AND sd.document_date BETWEEN $3 AND $4
          AND sd.status = 'validated'
          AND sm.movement_type IN ('sale_out', 'inventory_sale_out')
          AND ($5::uuid IS NULL OR l.supplier_id = $5::uuid)
        GROUP BY l.supplier_id
      )

      SELECT
        sp.supplier_id AS id,
        sp.code,
        sp.name,
        sp.purchases_ht,
        sp.total_volume,
        sp.purchases_count,
        sp.articles_count,

        COALESCE(ss.ca_ht, 0) AS ca_ht,
        COALESCE(ss.cost_ht, 0) AS cost_ht,
        COALESCE(ss.margin_ht, 0) AS margin_ht,

        CASE
          WHEN COALESCE(ss.ca_ht, 0) > 0
          THEN COALESCE(ss.margin_ht, 0) / COALESCE(ss.ca_ht, 0) * 100
          ELSE 0
        END AS margin_pct

      FROM supplier_purchases sp
      LEFT JOIN supplier_sales ss ON ss.supplier_id = sp.supplier_id
      ORDER BY margin_ht DESC, purchases_ht DESC
      `,
      [storeId, department_id, start_date, end_date, supplier_id || null]
    );

    res.json({
      summary: summaryRes.rows[0],
      suppliers: suppliersRes.rows
    });

  } catch (err) {
    console.error('GET /api/compta/supplier-stats', err);
    res.status(500).json({
      error: 'Erreur statistiques fournisseurs'
    });
  }
});

router.get('/article-stats', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const { department_id, start_date, end_date, article_id } = req.query;

    if (!department_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'department_id, start_date et end_date obligatoires'
      });
    }

    const summaryRes = await req.dbPool.query(
      `
      SELECT
        COALESCE(SUM(qty_sold_theoretical), 0) AS total_qty,
        COALESCE(SUM(theoretical_ca_ht), 0) AS ca_ht,
        COALESCE(SUM(theoretical_cost_ht), 0) AS cost_ht,
        COALESCE(SUM(theoretical_margin_ht), 0) AS margin_ht,
        COUNT(DISTINCT article_id) AS articles_count
      FROM compta_daily_article_theoretical_lines
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR article_id = $5::uuid)
      `,
      [storeId, department_id, start_date, end_date, article_id || null]
    );

    const articlesRes = await req.dbPool.query(
      `
      SELECT
        article_id AS id,
        article_plu,
        article_label,
        sale_unit,

        COALESCE(SUM(qty_sold_theoretical), 0) AS qty_sold,
        COALESCE(SUM(theoretical_ca_ht), 0) AS ca_ht,
        COALESCE(SUM(theoretical_cost_ht), 0) AS cost_ht,
        COALESCE(SUM(theoretical_margin_ht), 0) AS margin_ht,

        CASE
          WHEN COALESCE(SUM(theoretical_ca_ht), 0) > 0
          THEN COALESCE(SUM(theoretical_margin_ht), 0) / COALESCE(SUM(theoretical_ca_ht), 0) * 100
          ELSE 0
        END AS margin_pct,

        BOOL_OR(pricing_issue) AS pricing_issue,
        BOOL_OR(cost_issue) AS cost_issue,
        BOOL_OR(negative_margin) AS negative_margin

      FROM compta_daily_article_theoretical_lines
      WHERE store_id = $1
        AND department_id = $2
        AND closure_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR article_id = $5::uuid)
      GROUP BY article_id, article_plu, article_label, sale_unit
      ORDER BY margin_ht DESC, ca_ht DESC
      LIMIT 500
      `,
      [storeId, department_id, start_date, end_date, article_id || null]
    );

    res.json({
      summary: summaryRes.rows[0],
      articles: articlesRes.rows
    });
  } catch (err) {
    console.error('GET /api/compta/article-stats', err);
    res.status(500).json({ error: 'Erreur statistiques articles' });
  }
});

router.get('/inventory-anomalies', async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const {
      department_id,
      start_date,
      end_date,
      anomaly_type,
    } = req.query;

    if (!department_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'department_id, start_date et end_date obligatoires'
      });
    }

    const result = await req.dbPool.query(
      `
      SELECT
        ia.id,
        ia.inventory_date,
        ia.anomaly_type,
        ia.action_type,
        ia.article_plu,
        ia.article_label,
        ia.ean,
        ia.stock_quantity,
        ia.sold_quantity,
        ia.sale_unit,
        ia.unit_sale_price_ttc,
        ia.line_total_ttc,
        ia.reason,
        ia.source_row_number,
        ia.created_at,
        u.email AS user_email,
        sd.reference_number AS sales_document_reference
      FROM inventory_anomalies ia
      LEFT JOIN users u
        ON u.id = ia.created_by
      LEFT JOIN sales_documents sd
        ON sd.id = ia.sales_document_id
      WHERE ia.store_id = $1
        AND ia.department_id = $2
        AND ia.inventory_date BETWEEN $3::date AND $4::date
        AND ($5::text IS NULL OR ia.anomaly_type = $5::text)
      ORDER BY ia.inventory_date DESC, ia.created_at DESC
      `,
      [
        storeId,
        department_id,
        start_date,
        end_date,
        anomaly_type || null,
      ]
    );

    res.json({ anomalies: result.rows });
  } catch (err) {
    console.error('GET /api/compta/inventory-anomalies', err);
    res.status(500).json({ error: 'Erreur chargement anomalies inventaire' });
  }
});

module.exports = router;
