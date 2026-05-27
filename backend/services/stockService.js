async function recomputeArticleStock(client, articleId, storeId, departmentId) {
  const lotsResult = await client.query(
    `
    SELECT
      qty_remaining,
      unit_cost_ex_vat,
      dlc
    FROM lots
    WHERE article_id = $1
      AND store_id = $2
      AND department_id = $3
      AND qty_remaining > 0
    `,
    [articleId, storeId, departmentId]
  );

  let totalQty = 0;
  let totalValue = 0;
  let nextDlc = null;

  for (const row of lotsResult.rows) {
    const qty = Number(row.qty_remaining || 0);
    const unitCost = Number(row.unit_cost_ex_vat || 0);

    totalQty += qty;
    totalValue += qty * unitCost;

    if (row.dlc) {
      const d = new Date(row.dlc);
      if (!nextDlc || d < nextDlc) {
        nextDlc = d;
      }
    }
  }

  const pma = totalQty > 0 ? totalValue / totalQty : 0;

  if (totalQty <= 0) {
    await client.query(
      `
      DELETE FROM stock_summary
      WHERE store_id = $1
        AND department_id = $2
        AND article_id = $3
      `,
      [storeId, departmentId, articleId]
    );
    return;
  }

  await client.query(
    `
    INSERT INTO stock_summary (
      store_id,
      department_id,
      article_id,
      stock_quantity,
      stock_value_ex_vat,
      pma,
      next_dlc
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (store_id, department_id, article_id)
    DO UPDATE SET
      stock_quantity = EXCLUDED.stock_quantity,
      stock_value_ex_vat = EXCLUDED.stock_value_ex_vat,
      pma = EXCLUDED.pma,
      next_dlc = EXCLUDED.next_dlc,
      updated_at = NOW()
    `,
    [
      storeId,
      departmentId,
      articleId,
      totalQty,
      totalValue,
      pma,
      nextDlc,
    ]
  );
}

module.exports = {
  recomputeArticleStock,
};
