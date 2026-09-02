require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { getDefaultPool } = require('../dbRegistry');

async function main() {
  if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER) {
    console.log('SKIP purchase receipt stock sync audit: DB_HOST/DB_NAME/DB_USER non configures');
    return;
  }

  const pool = getDefaultPool();
  const result = await pool.query(`
    WITH received_lines AS (
      SELECT
        p.id AS purchase_id,
        p.bl_number,
        p.status,
        pl.id AS purchase_line_id,
        pl.line_number,
        pl.article_id,
        CASE
          WHEN COALESCE(pl.price_unit, 'kg') = 'colis' THEN COALESCE(pl.received_colis, pl.ordered_colis, 0)
          WHEN COALESCE(pl.price_unit, 'kg') = 'piece' THEN
            CASE
              WHEN COALESCE(pl.received_colis, pl.ordered_colis, 0) > 0
               AND COALESCE(pl.received_pieces, pl.ordered_pieces, 0) > 0
              THEN COALESCE(pl.received_colis, pl.ordered_colis, 0) * COALESCE(pl.received_pieces, pl.ordered_pieces, 0)
              ELSE COALESCE(pl.received_pieces, pl.ordered_pieces, 0)
            END
          ELSE
            CASE
              WHEN COALESCE(pl.received_colis, pl.ordered_colis, 0) > 0
               AND COALESCE(pl.received_quantity, pl.ordered_quantity, 0) > 0
              THEN COALESCE(pl.received_colis, pl.ordered_colis, 0) * COALESCE(pl.received_quantity, pl.ordered_quantity, 0)
              ELSE COALESCE(pl.received_quantity, pl.ordered_quantity, 0)
            END
        END AS expected_qty,
        COALESCE(SUM(l.qty_initial), 0) AS lot_qty_initial,
        COALESCE(SUM(l.qty_remaining), 0) AS lot_qty_remaining,
        COALESCE(SUM(sm.quantity) FILTER (WHERE sm.movement_type = 'purchase_in'), 0) AS purchase_in_qty,
        COUNT(DISTINCT l.id) AS lot_count,
        COUNT(DISTINCT sm.id) FILTER (WHERE sm.movement_type = 'purchase_in') AS purchase_in_count
      FROM purchases p
      JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
      LEFT JOIN lots l ON l.purchase_line_id = pl.id AND l.store_id = pl.store_id
      LEFT JOIN stock_movements sm
        ON sm.source_table = 'purchase_lines'
       AND sm.source_id = pl.id
       AND sm.store_id = pl.store_id
      WHERE p.status IN ('received', 'received_pending_invoice')
      GROUP BY p.id, p.bl_number, p.status, pl.id, pl.line_number, pl.article_id, pl.price_unit,
        pl.received_colis, pl.ordered_colis, pl.received_pieces, pl.ordered_pieces,
        pl.received_quantity, pl.ordered_quantity
    )
    SELECT *
    FROM received_lines
    WHERE ABS(expected_qty - lot_qty_initial) > 0.0001
       OR ABS(expected_qty - purchase_in_qty) > 0.0001
       OR (expected_qty > 0 AND lot_count = 0)
       OR (expected_qty > 0 AND purchase_in_count = 0)
    ORDER BY purchase_id, line_number
    LIMIT 200
  `);

  if (!result.rows.length) {
    console.log('OK purchase receipt stock sync audit: aucune incoherence ligne/lot/mouvement detectee');
    return;
  }

  console.log(`WARN purchase receipt stock sync audit: ${result.rows.length} incoherence(s) detectee(s)`);
  for (const row of result.rows) {
    console.log(JSON.stringify({
      purchase_id: row.purchase_id,
      bl_number: row.bl_number,
      status: row.status,
      purchase_line_id: row.purchase_line_id,
      line_number: row.line_number,
      article_id: row.article_id,
      expected_qty: Number(row.expected_qty),
      lot_qty_initial: Number(row.lot_qty_initial),
      lot_qty_remaining: Number(row.lot_qty_remaining),
      purchase_in_qty: Number(row.purchase_in_qty),
      lot_count: Number(row.lot_count),
      purchase_in_count: Number(row.purchase_in_count),
    }));
  }
}

main()
  .catch((error) => {
    console.error('Erreur audit purchase receipt stock sync:', JSON.stringify({
      message: error.message || null,
      code: error.code || null,
      errno: error.errno || null,
      syscall: error.syscall || null,
      address: error.address || null,
      port: error.port || null,
      db_host_configured: Boolean(process.env.DB_HOST),
      db_name_configured: Boolean(process.env.DB_NAME),
      db_user_configured: Boolean(process.env.DB_USER),
    }));
    process.exitCode = 1;
  })
  .finally(() => {
    require('../dbRegistry').closeAllPools().catch(() => {});
  });
