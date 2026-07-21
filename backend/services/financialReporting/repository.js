function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function safeDate(value) {
  const text = clean(value);
  if (!text) return new Date().toISOString().slice(0, 10);
  return text.slice(0, 10);
}

function normalizeBool(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function lineParams(snapshotId, line) {
  return [
    snapshotId,
    clean(line.account_number),
    clean(line.formatted_account_number || line.account_number),
    clean(line.account_label),
    Number(line.total_debit || 0),
    Number(line.total_credit || 0),
    Number(line.net_balance ?? (Number(line.total_credit || 0) - Number(line.total_debit || 0))),
  ];
}

async function startSyncLog(db, { storeId, periodStart, periodEnd }) {
  const result = await db.query(
    `INSERT INTO financial_report_sync_logs (store_id, period_start, period_end, status)
     VALUES ($1, $2::date, $3::date, 'started')
     RETURNING id, started_at`,
    [storeId, periodStart, periodEnd]
  );
  return result.rows[0];
}

async function completeSyncLog(db, { logId, status, processedCount = 0, errorMessage = null }) {
  if (!logId) return null;
  const result = await db.query(
    `UPDATE financial_report_sync_logs
     SET status = $2,
         processed_count = $3,
         error_message = $4,
         completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [logId, status, processedCount, errorMessage]
  );
  return result.rows[0] || null;
}

async function saveTrialBalanceSnapshot(db, {
  storeId,
  periodStart,
  periodEnd,
  isAuxiliary = false,
  lines = [],
  status = 'success',
  source = 'pennylane_trial_balance',
  errorMessage = null,
}) {
  await db.query('BEGIN');
  try {
    const snapshot = await db.query(
      `INSERT INTO pennylane_trial_balance_snapshots (
         store_id, period_start, period_end, is_auxiliary, status, fetched_at, source, error_message
       ) VALUES ($1, $2::date, $3::date, $4, $5, now(), $6, $7)
       ON CONFLICT (store_id, period_start, period_end, is_auxiliary, source)
       DO UPDATE SET
         status = EXCLUDED.status,
         fetched_at = EXCLUDED.fetched_at,
         error_message = EXCLUDED.error_message,
         updated_at = now()
       RETURNING *`,
      [storeId, periodStart, periodEnd, normalizeBool(isAuxiliary), status, source, errorMessage]
    );
    const snapshotId = snapshot.rows[0].id;
    await db.query('DELETE FROM pennylane_trial_balance_lines WHERE snapshot_id = $1', [snapshotId]);
    for (const line of lines) {
      if (!clean(line.account_number)) continue;
      await db.query(
        `INSERT INTO pennylane_trial_balance_lines (
          snapshot_id, account_number, formatted_account_number, account_label,
          total_debit, total_credit, net_balance
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        lineParams(snapshotId, line)
      );
    }
    await db.query('COMMIT');
    return { ...snapshot.rows[0], line_count: lines.length };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function latestSnapshot(db, { storeId, periodStart, periodEnd, isAuxiliary = false }) {
  const result = await db.query(
    `SELECT *
     FROM pennylane_trial_balance_snapshots
     WHERE store_id = $1
       AND period_start = $2::date
       AND period_end = $3::date
       AND is_auxiliary = $4
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [storeId, safeDate(periodStart), safeDate(periodEnd), normalizeBool(isAuxiliary)]
  );
  return result.rows[0] || null;
}

async function snapshotLines(db, snapshotId) {
  if (!snapshotId) return [];
  const result = await db.query(
    `SELECT id, account_number, formatted_account_number, account_label,
            total_debit, total_credit, net_balance
     FROM pennylane_trial_balance_lines
     WHERE snapshot_id = $1
     ORDER BY account_number`,
    [snapshotId]
  );
  return result.rows;
}

async function loadMappings(db, storeId) {
  const result = await db.query(
    `SELECT *
     FROM financial_report_mappings
     WHERE is_active = true
       AND (store_id IS NULL OR store_id = $1)
     ORDER BY store_id NULLS FIRST, length(account_prefix) DESC, display_order ASC, account_prefix ASC`,
    [storeId]
  );
  return result.rows;
}

async function listMappings(db, storeId) {
  const result = await db.query(
    `SELECT *
     FROM financial_report_mappings
     WHERE store_id IS NULL OR store_id = $1
     ORDER BY display_order ASC, account_prefix ASC, store_id NULLS FIRST`,
    [storeId]
  );
  return result.rows;
}

async function updateMapping(db, { id, storeId, patch }) {
  const allowed = {
    account_prefix: clean(patch.account_prefix),
    section_code: clean(patch.section_code),
    subsection_code: clean(patch.subsection_code),
    display_label: clean(patch.display_label),
    calculation_sign: Number(patch.calculation_sign),
    display_order: Number(patch.display_order),
    is_active: patch.is_active,
  };
  const hasCalculationSign = Object.prototype.hasOwnProperty.call(patch, 'calculation_sign');
  if (![1, -1].includes(allowed.calculation_sign)) allowed.calculation_sign = null;
  const hasSubsectionCode = Object.prototype.hasOwnProperty.call(patch, 'subsection_code');
  const result = await db.query(
    `UPDATE financial_report_mappings
     SET account_prefix = COALESCE($3, account_prefix),
         section_code = COALESCE($4, section_code),
         subsection_code = CASE WHEN $10::boolean THEN $5 ELSE subsection_code END,
         display_label = COALESCE($6, display_label),
         calculation_sign = CASE WHEN $11::boolean THEN $7 ELSE calculation_sign END,
         display_order = CASE WHEN $8::int IS NULL THEN display_order ELSE $8::int END,
         is_active = CASE WHEN $9::boolean IS NULL THEN is_active ELSE $9::boolean END,
         updated_at = now()
     WHERE id = $1
       AND (store_id IS NULL OR store_id = $2)
     RETURNING *`,
    [
      id,
      storeId,
      allowed.account_prefix,
      allowed.section_code,
      allowed.subsection_code,
      allowed.display_label,
      allowed.calculation_sign,
      Number.isFinite(allowed.display_order) ? allowed.display_order : null,
      typeof allowed.is_active === 'boolean' ? allowed.is_active : null,
      hasSubsectionCode,
      hasCalculationSign,
    ]
  );
  return result.rows[0] || null;
}

async function lastSyncLog(db, { storeId, periodStart, periodEnd }) {
  const result = await db.query(
    `SELECT *
     FROM financial_report_sync_logs
     WHERE store_id = $1
       AND period_start = $2::date
       AND period_end = $3::date
     ORDER BY started_at DESC
     LIMIT 1`,
    [storeId, safeDate(periodStart), safeDate(periodEnd)]
  );
  return result.rows[0] || null;
}

module.exports = {
  completeSyncLog,
  lastSyncLog,
  latestSnapshot,
  listMappings,
  loadMappings,
  safeDate,
  saveTrialBalanceSnapshot,
  snapshotLines,
  startSyncLog,
  updateMapping,
};
