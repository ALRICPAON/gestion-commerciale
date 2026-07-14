const assert = require('assert');

const {
  BLOCK_TYPES,
  blocksToText,
  renderDocumentBlock,
} = require('../services/quality/qualityDocumentBlockService');

function run() {
  ['rich_text', 'document_table', 'mermaid_diagram', 'image', 'attachment', 'to_complete', 'separator']
    .forEach((type) => assert(BLOCK_TYPES.has(type), `missing block type ${type}`));

  const rich = renderDocumentBlock({
    block_type: 'rich_text',
    is_visible: true,
    content: { html: '<p>Introduction</p>' },
  });
  assert(rich.includes('Introduction'), 'rich_text block should render html');

  const missing = renderDocumentBlock({
    block_type: 'to_complete',
    is_visible: true,
    content: { text: 'frequence des analyses microbiologiques' },
  });
  assert(missing.includes('A completer'), 'to_complete block should render callout');
  assert(!renderDocumentBlock({
    block_type: 'to_complete',
    is_visible: true,
    content: { text: 'hidden' },
  }, { include_missing: false }), 'to_complete block should respect include_missing=false');

  const separator = renderDocumentBlock({ block_type: 'separator', is_visible: true, content: {} });
  assert(separator.includes('quality-document-separator'), 'separator block should render separator');

  const text = blocksToText([
    { block_type: 'rich_text', is_visible: true, content: { html: '<p>Texte</p>' } },
    { block_type: 'to_complete', is_visible: true, content: { text: 'Point a verifier' } },
  ]);
  assert(text.includes('Texte'), 'blocksToText should include rich text');
  assert(text.includes('Point a verifier'), 'blocksToText should include to_complete text');

  console.log('quality document block tests ok');
}

run();
