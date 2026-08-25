const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const { resyncMermaidDiagramRender } = require('../services/quality/qualityDocumentationDiagramService');

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const storeId = argValue('store-id', process.env.ALTA_AGENT_STORE_ID);
  const diagramId = argValue('diagram-id');
  const userId = argValue('user-id', process.env.ALTA_AGENT_USER_ID || null);
  const apply = process.argv.includes('--apply');

  if (!storeId || !diagramId) {
    console.log(JSON.stringify({
      ok: false,
      error: 'Parametres obligatoires manquants.',
      usage: 'node backend/scripts/resync-quality-diagram-render.js --store-id=<STORE_ID> --diagram-id=<DIAGRAM_ID> [--apply] [--user-id=<USER_ID>]',
      default_mode: 'dry-run',
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const db = getDefaultPool();
  const result = await resyncMermaidDiagramRender(db, storeId, diagramId, userId, { dry_run: !apply });
  console.log(JSON.stringify({
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    ...result,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(closeAllPools);
