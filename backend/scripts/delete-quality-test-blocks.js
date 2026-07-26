const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const { deleteDocumentBlock, withTransaction } = require('../services/quality/qualityDocumentBlockService');

const DEFAULT_BLOCK_IDS = [
  '857bbe85-3be8-478a-be7b-ac2423486275',
  '9b273864-8558-4425-a383-2454360c278a',
];

function argValues(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length)).filter(Boolean);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const blockIds = argValues('block-id');
  const ids = blockIds.length ? blockIds : DEFAULT_BLOCK_IDS;

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      apply: false,
      block_ids: ids,
      message: 'Ajouter --apply pour supprimer ces blocs via qualityDocumentBlockService.deleteDocumentBlock.',
    }, null, 2));
    return;
  }

  const storeId = process.env.ALTA_AGENT_STORE_ID;
  if (!storeId) throw new Error('ALTA_AGENT_STORE_ID requis pour supprimer les blocs de test');

  const db = getDefaultPool();
  const deleted = [];
  for (const blockId of ids) {
    const block = await withTransaction(db, (client) => deleteDocumentBlock(
      client,
      storeId,
      blockId,
      process.env.ALTA_AGENT_USER_ID || null
    ));
    deleted.push({
      block_id: blockId,
      deleted: Boolean(block),
      block_type: block?.block_type || null,
      position: block?.position || null,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    apply: true,
    deleted,
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    error: error.message || 'Erreur suppression blocs test qualite',
    code: error.code || null,
  }, null, 2));
  process.exitCode = 1;
}).finally(closeAllPools);
