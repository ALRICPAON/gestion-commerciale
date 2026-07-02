require('dotenv').config();

const db = require('../db');
const { processPennylaneCustomerInvoiceSyncQueue } = require('../services/pennylane');

async function main() {
  try {
    const result = await processPennylaneCustomerInvoiceSyncQueue(db);
    console.info('Synchronisation Pennylane factures clients terminee', result);
    process.exitCode = result.failed > 0 ? 1 : 0;
  } catch (err) {
    console.error('Erreur worker synchronisation Pennylane factures clients :', err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
