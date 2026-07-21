const { fetchPennylaneTrialBalance } = require('./pennylaneTrialBalance');
const {
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
} = require('./repository');
const { calculateIncomeStatement, compareReports } = require('./calculator');

function normalizePeriod(query = {}) {
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  return {
    periodStart: safeDate(query.period_start || query.periodStart || firstDay),
    periodEnd: safeDate(query.period_end || query.periodEnd || now.toISOString().slice(0, 10)),
    isAuxiliary: query.is_auxiliary === true || String(query.is_auxiliary || '').toLowerCase() === 'true',
  };
}

async function syncTrialBalance(db, {
  storeId,
  periodStart,
  periodEnd,
  isAuxiliary = false,
  fetcher = fetchPennylaneTrialBalance,
}) {
  const log = await startSyncLog(db, { storeId, periodStart, periodEnd });
  try {
    const result = await fetcher({ periodStart, periodEnd, isAuxiliary });
    const snapshot = await saveTrialBalanceSnapshot(db, {
      storeId,
      periodStart,
      periodEnd,
      isAuxiliary,
      lines: result.lines,
      status: 'success',
    });
    await completeSyncLog(db, {
      logId: log.id,
      status: 'success',
      processedCount: result.lines.length,
    });
    return { snapshot, lines: result.lines, pages: result.pages };
  } catch (err) {
    await completeSyncLog(db, {
      logId: log.id,
      status: 'failed',
      processedCount: 0,
      errorMessage: err.message,
    }).catch(() => {});
    throw err;
  }
}

async function getTrialBalance(db, {
  storeId,
  periodStart,
  periodEnd,
  isAuxiliary = false,
  refresh = false,
}) {
  if (refresh) {
    return syncTrialBalance(db, { storeId, periodStart, periodEnd, isAuxiliary });
  }

  const snapshot = await latestSnapshot(db, { storeId, periodStart, periodEnd, isAuxiliary });
  if (!snapshot) return { snapshot: null, lines: [], pages: 0 };
  const lines = await snapshotLines(db, snapshot.id);
  return { snapshot, lines, pages: 0 };
}

async function incomeStatement(db, {
  storeId,
  periodStart,
  periodEnd,
  isAuxiliary = false,
  refresh = false,
}) {
  const balance = await getTrialBalance(db, { storeId, periodStart, periodEnd, isAuxiliary, refresh });
  const mappings = await loadMappings(db, storeId);
  const syncLog = await lastSyncLog(db, { storeId, periodStart, periodEnd });
  return {
    ...calculateIncomeStatement({
      lines: balance.lines,
      mappings,
      snapshot: balance.snapshot,
      periodStart,
      periodEnd,
    }),
    last_sync: syncLog,
  };
}

async function comparison(db, {
  storeId,
  periodStart,
  periodEnd,
  comparisonPeriodStart,
  comparisonPeriodEnd,
  isAuxiliary = false,
  refresh = false,
}) {
  const current = await incomeStatement(db, {
    storeId,
    periodStart,
    periodEnd,
    isAuxiliary,
    refresh,
  });
  const previous = await incomeStatement(db, {
    storeId,
    periodStart: comparisonPeriodStart,
    periodEnd: comparisonPeriodEnd,
    isAuxiliary,
    refresh: false,
  });
  return compareReports(current, previous);
}

module.exports = {
  comparison,
  getTrialBalance,
  incomeStatement,
  listMappings,
  normalizePeriod,
  syncTrialBalance,
  updateMapping,
};
