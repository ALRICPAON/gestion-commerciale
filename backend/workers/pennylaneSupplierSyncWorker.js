require('dotenv').config();

const db = require('../db');
const { processPennylaneSupplierSyncQueue } = require('../services/pennylane');

async function main() {
  try {
    const result = await processPennylaneSupplierSyncQueue(db);
    console.info('Synchronisation Pennylane fournisseurs terminee', result);
    process.exitCode = result.failed > 0 ? 1 : 0;
  } catch (err) {
    console.error('Erreur worker synchronisation Pennylane fournisseurs :', err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
