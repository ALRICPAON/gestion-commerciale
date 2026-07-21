const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../db');
const { getPennylaneConfig } = require('../services/pennylane');
const { syncCashflowData } = require('../services/cashflow/pennylaneCashflowService');
const { debugCounts, getDistrimer } = require('../services/cashflow/service');

async function resolveStoreId() {
  if (process.env.CASHFLOW_DIAGNOSTIC_STORE_ID) return process.env.CASHFLOW_DIAGNOSTIC_STORE_ID;
  const result = await db.query('SELECT id FROM stores ORDER BY created_at ASC NULLS LAST LIMIT 1');
  return result.rows[0]?.id || null;
}

function statusLine(label, result, receivedKey = 'read') {
  if (!result) return `[ERROR] ${label}: no result`;
  if (result.failed) return `[ERROR] ${label}: ${result.status ? `HTTP ${result.status} - ` : ''}${result.message || result.error || 'failed'}`;
  const pages = result.pages || result.stats?.pages_count || 0;
  const received = result[receivedKey] ?? result.stats?.received_count ?? 0;
  const inserted = result.stats ? `, ${result.stats.inserted_count || 0} inserted, ${result.stats.updated_count || 0} updated` : '';
  const ignored = result.stats?.ignored_count ? `, ${result.stats.ignored_count} ignored` : '';
  return `[OK] ${label}: ${received} received${pages ? ` over ${pages} pages` : ''}${inserted}${ignored}`;
}

async function main() {
  const config = getPennylaneConfig();
  if (!config.enabled) {
    console.log('[ERROR] Pennylane: PENNYLANE_ENABLED is not true');
    return;
  }
  if (!config.apiToken) {
    console.log('[ERROR] Pennylane: API token missing');
    return;
  }

  const storeId = await resolveStoreId();
  if (!storeId) {
    console.log('[ERROR] Store: no store found. Set CASHFLOW_DIAGNOSTIC_STORE_ID.');
    return;
  }

  const result = await syncCashflowData(db, { storeId, userId: null });
  const counts = await debugCounts(db, storeId);
  const distrimer = await getDistrimer(db, storeId);

  console.log(statusLine('Bank accounts', result.bank_accounts));
  console.log(statusLine('Transactions', result.transactions));
  console.log(statusLine('Supplier invoices', result.supplier_invoices));
  console.log(statusLine('Supplier payments', result.supplier_payments));
  console.log(`[OK] Open supplier invoices: ${counts.openSupplierInvoices}`);
  console.log(`[OK] Trial balance accounts: ${counts.trialBalanceAccounts}`);
  console.log(`[OK] Class 6 accounts: ${counts.class6Accounts}`);
  console.log(`[OK] DISTRIMER: ${distrimer.items?.length || 0} open invoices, ${Number(distrimer.exposure || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} EUR outstanding`);

  if (Array.isArray(counts.latestResourceLogs)) {
    console.log('\nResource logs:');
    counts.latestResourceLogs.forEach((row) => {
      console.log(`- ${row.resource}: received=${row.received_count}, normalized=${row.normalized_count}, inserted=${row.inserted_count}, updated=${row.updated_count}, ignored=${row.ignored_count}, errors=${row.error_count}${row.error_message ? `, error=${row.error_message}` : ''}`);
    });
  }
}

main()
  .catch((error) => {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
