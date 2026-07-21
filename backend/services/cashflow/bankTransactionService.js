async function latestBankSnapshot(db, storeId) {
  const result = await db.query(
    `
    SELECT *
    FROM cashflow_bank_snapshots
    WHERE store_id = $1
    ORDER BY snapshot_at DESC, created_at DESC
    LIMIT 1
    `,
    [storeId]
  );
  return result.rows[0] || null;
}

async function listBankTransactions(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['store_id = $1'];

  if (query.direction && query.direction !== 'all') {
    params.push(query.direction === 'out' ? 'out' : 'in');
    where.push(`direction = $${params.length}`);
  }
  if (query.reconciled === 'true' || query.reconciled === 'false') {
    params.push(query.reconciled === 'true');
    where.push(`reconciled = $${params.length}`);
  }
  if (query.from) {
    params.push(query.from);
    where.push(`transaction_date >= $${params.length}::date`);
  }
  if (query.to) {
    params.push(query.to);
    where.push(`transaction_date <= $${params.length}::date`);
  }

  const result = await db.query(
    `
    SELECT *
    FROM cashflow_bank_transactions
    WHERE ${where.join(' AND ')}
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT 500
    `,
    params
  );
  return result.rows;
}

module.exports = {
  latestBankSnapshot,
  listBankTransactions,
};
