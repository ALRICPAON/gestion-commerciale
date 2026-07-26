const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const { executeAgentTool } = require('../services/agent/agentToolExecutor');

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function summarizeBlock(block) {
  const content = block.content || {};
  const table = block.table?.table_data;
  const diagram = block.diagram?.diagram_data;
  return {
    block_id: block.id,
    block_type: block.block_type,
    position: block.position,
    summary: String(
      content.html ||
      table?.title ||
      diagram?.title ||
      block.title ||
      ''
    ).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
  };
}

async function call(db, context, name, input = {}) {
  return executeAgentTool({
    db,
    context,
    name,
    input,
    confirmed: true,
  });
}

async function main() {
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({
      ok: false,
      error: 'Ajouter --apply pour creer puis supprimer les blocs de verification.',
      example: 'node backend/scripts/verify-quality-block-tools.js --apply --section-code=T1-C01',
    }, null, 2));
    return;
  }

  const db = getDefaultPool();
  const sectionCode = argValue('section-code', 'T1-C01');
  const context = {
    store_id: process.env.ALTA_AGENT_STORE_ID,
    user_id: process.env.ALTA_AGENT_USER_ID || null,
    role: 'trusted_owner',
    user_permissions: ['agent.use', 'mcp.execute', 'quality.documentation.read', 'quality.documentation.edit'],
    agent_permissions: ['agent.use', 'mcp.execute', 'quality.documentation.read', 'quality.documentation.edit'],
    source: 'mcp',
    trusted_mode: true,
  };

  const before = await call(db, context, 'get_quality_section_blocks', { code: sectionCode });
  const sectionId = before.data.section?.id;
  if (!sectionId) throw new Error(`Chapitre introuvable : ${sectionCode}`);

  const createdText = await call(db, context, 'quality.documentation.add_text_block', {
    chapter_id: sectionId,
    html: '<p>Verification MCP bloc texte temporaire.</p>',
  });
  const textBlockId = createdText.data.execution_result.block.id;

  const createdTable = await call(db, context, 'quality.documentation.add_table_block', {
    chapter_id: sectionId,
    title: 'Verification MCP tableau temporaire',
    columns: ['Champ', 'Valeur'],
    rows: [['Verification', 'OK']],
  });
  const tableBlockId = createdTable.data.execution_result.block.id;

  const afterCreate = await call(db, context, 'get_quality_section_blocks', { section_id: sectionId });
  const createdIds = new Set([textBlockId, tableBlockId]);
  const createdSummaries = afterCreate.data.blocks.filter((block) => createdIds.has(block.id)).map(summarizeBlock);

  await call(db, context, 'quality.documentation.delete_block', { block_id: tableBlockId });
  await call(db, context, 'quality.documentation.delete_block', { block_id: textBlockId });

  const afterDelete = await call(db, context, 'get_quality_section_blocks', { section_id: sectionId });

  console.log(JSON.stringify({
    ok: true,
    section_code: sectionCode,
    section_id: sectionId,
    before_count: before.data.blocks.length,
    after_create_count: afterCreate.data.blocks.length,
    after_delete_count: afterDelete.data.blocks.length,
    created_blocks: createdSummaries,
    deleted_block_ids: [textBlockId, tableBlockId],
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    error: error.message || 'Erreur verification outils blocs qualite',
    code: error.code || null,
  }, null, 2));
  process.exitCode = 1;
}).finally(closeAllPools);
