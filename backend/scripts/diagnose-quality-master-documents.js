const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const {
  inventoryExistingAttachments,
  listMasterDocuments,
} = require('../services/quality/masterDocuments');

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  });
  return [...map.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => ({ key, items: list }));
}

async function main() {
  const storeId = argValue('store-id') || process.env.ALTA_STORE_ID || process.env.STORE_ID;
  if (!storeId) throw new Error('--store-id ou ALTA_STORE_ID requis');

  const db = getDefaultPool();
  const [attachments, masterDocuments] = await Promise.all([
    inventoryExistingAttachments(db, storeId),
    listMasterDocuments(db, storeId, { include_archived: true, limit: 500 }),
  ]);
  const exactDuplicates = groupBy(attachments, (item) => item.checksum_sha256);
  const potentialDuplicates = groupBy(attachments, (item) => `${item.original_filename || item.name || ''}::${item.file_size || ''}`);
  const masterByChecksum = new Map(masterDocuments.filter((doc) => doc.checksum_sha256).map((doc) => [doc.checksum_sha256, doc]));

  const proposed = attachments.map((item) => ({
    source_type: item.source_type,
    source_id: item.id,
    target_type: item.target_type,
    target_id: item.target_id,
    chapter_or_target: [item.target_code, item.target_title].filter(Boolean).join(' - ') || null,
    name: item.name,
    original_filename: item.original_filename,
    file_size: item.file_size,
    checksum_sha256: item.checksum_sha256,
    proposed_master_document_id: item.checksum_sha256 ? masterByChecksum.get(item.checksum_sha256)?.id || null : null,
    proposed_action: item.checksum_sha256 && masterByChecksum.has(item.checksum_sha256)
      ? 'reference_existing_master_document'
      : 'create_master_document_candidate',
    conflicts: item.checksum_sha256 ? [] : ['checksum_indisponible'],
  }));

  console.log(JSON.stringify({
    ok: true,
    mode: 'read_only',
    store_id: storeId,
    existing_attachments_count: attachments.length,
    master_documents_count: masterDocuments.length,
    attachments,
    exact_duplicates: exactDuplicates,
    potential_duplicates: potentialDuplicates,
    proposed_master_documents: proposed,
    rule: 'Aucune fusion automatique sur nom identique; seul un checksum identique signale un doublon exact.',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(() => closeAllPools());
