const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const { resyncSectionContentTextFromBlocks } = require('../services/quality/qualityDocumentBlockService');

const DEFAULT_CODES = [
  'T1-C03',
  'T1-C07',
  'T1-C08',
  'T2-C01',
  'T2-C07',
  'T3-C05',
  'T3-C06',
  'T3-C07',
  'T3-C11',
  'T3-C12',
];

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function codeList() {
  const raw = argValue('codes');
  if (!raw) return DEFAULT_CODES;
  if (raw === 'all') return null;
  return raw.split(',').map((code) => code.trim()).filter(Boolean);
}

async function findSections(db, storeId, codes) {
  const params = [storeId];
  const where = [
    'store_id = $1',
    "section_type <> 'tome'",
    'archived_at IS NULL',
  ];
  if (codes && codes.length) {
    params.push(codes);
    where.push(`code = ANY($${params.length}::text[])`);
  }
  const result = await db.query(
    `SELECT id, code, title, status, version, content_text, updated_at
     FROM quality_documentation_sections
     WHERE ${where.join(' AND ')}
     ORDER BY display_order ASC, code ASC`,
    params
  );
  return result.rows;
}

async function main() {
  const storeId = argValue('store-id', process.env.ALTA_AGENT_STORE_ID);
  const userId = argValue('user-id', process.env.ALTA_AGENT_USER_ID || null);
  const apply = process.argv.includes('--apply');
  const codes = codeList();

  if (!storeId) {
    console.log(JSON.stringify({
      ok: false,
      error: 'Parametre obligatoire manquant.',
      usage: 'node backend/scripts/resync-quality-content-text.js --store-id=<STORE_ID> [--codes=T1-C03,T1-C07|--codes=all] [--apply] [--user-id=<USER_ID>]',
      default_mode: 'dry-run',
      default_codes: DEFAULT_CODES,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const db = getDefaultPool();
  const sections = await findSections(db, storeId, codes);
  const results = [];
  for (const section of sections) {
    results.push(await resyncSectionContentTextFromBlocks(db, storeId, section.id, userId, { dry_run: !apply }));
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    store_id: storeId,
    codes: codes || 'all',
    matched: sections.length,
    changed: results.filter((item) => item.changed).length,
    results: results.map((item) => ({
      section_id: item.section_id,
      code: item.code,
      title: item.title,
      changed: item.changed,
      block_count: item.block_count,
      before: item.before,
      after: item.after,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(closeAllPools);
