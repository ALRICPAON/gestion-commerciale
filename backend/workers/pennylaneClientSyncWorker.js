require('dotenv').config();

const db = require('../db');
const { processPennylaneClientSyncQueue } = require('../services/pennylane');

async function main() {
  try {
    const result = await processPennylaneClientSyncQueue(db);
    console.info('Synchronisation Pennylane clients terminee', result);
    process.exitCode = result.failed > 0 ? 1 : 0;
  } catch (err) {
    console.error('Erreur worker synchronisation Pennylane clients :', err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();