async function recomputeArticleStock(client, articleId, storeId) {
  const result = await client.query(
    `
    SELECT
      COALESCE(SUM(qty_remaining), 0) AS qty,
      COALESCE(SUM(qty_remaining * unit_cost_ex_vat), 0) AS value,
      MIN(dlc) FILTER (WHERE qty_remaining > 0 AND dlc IS NOT NULL) AS next_dlc
    FROM lots
    WHERE store_id = $1
      AND article_id = $2
      AND qty_remaining > 0
    `,
    [storeId, articleId]
  );

  const qty = Number(result.rows[0]?.qty || 0);
  const baseValue = Number(result.rows[0]?.value || 0);
  const componentsResult = await client.query(
    `
    SELECT COALESCE(SUM(scc.amount_ex_vat), 0) AS value
    FROM stock_cost_components scc
    WHERE scc.store_id = $1
      AND scc.article_id = $2
      AND scc.status = 'active'
      AND (
        scc.lot_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM lots l
          WHERE l.id = scc.lot_id
            AND l.store_id = scc.store_id
            AND l.article_id = scc.article_id
            AND l.qty_remaining > 0
        )
      )
    `,
    [storeId, articleId]
  );
  const componentValue = Number(componentsResult.rows[0]?.value || 0);
  const value = baseValue + componentValue;
  const pma = qty > 0 ? Number((value / qty).toFixed(4)) : 0;
  const nextDlc = result.rows[0]?.next_dlc || null;

  await client.query(
    `
    INSERT INTO stock_summary (id, store_id, article_id, stock_quantity, stock_value_ex_vat, pma, next_dlc, updated_at)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (store_id, article_id)
    DO UPDATE SET
      stock_quantity = EXCLUDED.stock_quantity,
      stock_value_ex_vat = EXCLUDED.stock_value_ex_vat,
      pma = EXCLUDED.pma,
      next_dlc = EXCLUDED.next_dlc,
      updated_at = NOW()
    `,
    [storeId, articleId, qty, value, pma, nextDlc]
  );
}

module.exports = { recomputeArticleStock };
