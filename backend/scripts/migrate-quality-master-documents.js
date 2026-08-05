const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const {
  addDocumentReference,
  inventoryExistingAttachments,
  linkExistingAttachmentToMasterDocument,
} = require('../services/quality/masterDocuments');

const CONFIRMATION = 'MIGRATE_QUALITY_MASTER_DOCUMENTS';

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const execute = process.argv.includes('--execute');
  const confirmation = argValue('confirmation');
  const storeId = argValue('store-id') || process.env.ALTA_STORE_ID || process.env.STORE_ID;
  const userId = argValue('user-id') || process.env.ALTA_AGENT_USER_ID || null;

  if (!storeId) throw new Error('--store-id ou ALTA_STORE_ID requis');
  if (execute && confirmation !== CONFIRMATION) {
    throw new Error(`Confirmation obligatoire: --confirmation="${CONFIRMATION}"`);
  }
  if (execute && !userId) throw new Error('--user-id ou ALTA_AGENT_USER_ID requis en mode --execute');
  if (!dryRun && !execute) throw new Error('Choisir --dry-run ou --execute');

  const db = getDefaultPool();
  const attachments = await inventoryExistingAttachments(db, storeId);
  const candidates = attachments.map((item) => ({
    source_type: item.source_type,
    source_id: item.id,
    target_type: item.target_type === 'documentation_section' ? 'documentation_section' : `quality_${item.target_type || 'object'}`,
    target_id: item.target_id,
    title: item.name || item.original_filename || 'Document maitre qualite',
    original_filename: item.original_filename,
    checksum_sha256: item.checksum_sha256,
    file_size: item.file_size,
  }));

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      store_id: storeId,
      candidate_count: candidates.length,
      candidates,
      rule: 'Aucune ecriture realisee. Aucune piece originale ne serait supprimee.',
    }, null, 2));
    return;
  }

  const created = [];
  for (const candidate of candidates) {
    const linked = await linkExistingAttachmentToMasterDocument(db, storeId, userId, {
      source_type: candidate.source_type,
      source_id: candidate.source_id,
      title: candidate.title,
      document_type: 'external_evidence',
      source_type_master: 'interne',
      checksum_sha256: candidate.checksum_sha256,
      status: 'draft',
    });
    const reference = await addDocumentReference(db, storeId, userId, {
      document_id: linked.document.id,
      target_type: candidate.target_type,
      target_id: candidate.target_id,
      relation_type: 'legacy_attachment',
      label: candidate.title,
    });
    created.push({ candidate, document_id: linked.document.id, reused_existing: linked.reused_existing, reference_id: reference.id });
  }

  console.log(JSON.stringify({
    ok: true,
    executed: true,
    store_id: storeId,
    migrated_count: created.length,
    created,
    rule: 'Les fichiers originaux ont ete conserves; seules des fiches maitres et references logiques ont ete creees.',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(() => closeAllPools());
