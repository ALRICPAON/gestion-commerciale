const assert = require('assert');

const { buildHtml, paginationPreparationScript } = require('../services/quality/qualityDocumentationExportService');

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index + 1}`,
    cells: {
      point: `Point ${index + 1}`,
      action: `Action ${index + 1}`,
    },
  }));
}

function table(id, sectionId, rowCount) {
  return {
    id,
    section_id: sectionId,
    block_id: `block-${id}`,
    title: rowCount > 18 ? 'Grand tableau' : 'Petit tableau',
    table_data: {
      title: rowCount > 18 ? 'Grand tableau' : 'Petit tableau',
      header: true,
      columns: [
        { id: 'point', label: 'Point', alignment: 'left' },
        { id: 'action', label: 'Action', alignment: 'left' },
      ],
      rows: rows(rowCount),
    },
  };
}

function run() {
  const smallTable = table('small-table', 'chapter-1', 4);
  const largeTable = table('large-table', 'chapter-1', 40);
  const documentation = {
    collection: { title: 'Manuel qualite test', version: '1.0' },
    sections: [{
      id: 'chapter-1',
      section_type: 'chapter',
      code: 'T1-C01',
      title: 'Chapitre pagination',
      version: '1.0',
      status: 'draft',
      include_in_export: true,
      content_html: '<p>Legacy</p>',
    }],
    missing_items: [],
    attachments: [],
    tables: [smallTable, largeTable],
    diagrams: [{
      id: 'diagram-1',
      section_id: 'chapter-1',
      block_id: 'diagram-block',
      title: 'Diagramme',
      diagram_data: {
        editor_mode: 'mermaid',
        source: 'flowchart TD\n    A([Debut]) --> B[Diagramme]\n    B --> C([Fin])',
        rendered_svg: '<svg class="quality-diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="5" y="20">Diagramme</text></svg>',
      },
    }],
    blocks: [
      { id: 'b1', chapter_id: 'chapter-1', block_type: 'rich_text', position: 10, is_visible: true, content: { html: '<h3>Titre conserve</h3><p>Texte avec paragraphes.</p>' } },
      { id: 'b2', chapter_id: 'chapter-1', block_type: 'document_table', position: 20, is_visible: true, content: { table_id: smallTable.id }, table: smallTable },
      { id: 'b3', chapter_id: 'chapter-1', block_type: 'document_table', position: 30, is_visible: true, content: { table_id: largeTable.id }, table: largeTable },
      { id: 'b4', chapter_id: 'chapter-1', block_type: 'mermaid_diagram', position: 40, is_visible: true, content: { diagram_id: 'diagram-1' }, diagram: documentationDiagram() },
      { id: 'b5', chapter_id: 'chapter-1', block_type: 'to_complete', position: 50, is_visible: true, content: { text: 'Frequence a definir' } },
    ],
    exports: [],
  };

  const html = buildHtml(documentation, {
    company_name: 'ALTA MAREE',
    address_line1: '',
    postal_code: '',
    city: '',
    country: '',
  });

  assert(html.includes('quality-pdf-block--keep'), 'small/non-splittable blocks should use keep class');
  assert(html.includes('quality-pdf-block--split-table'), 'large tables should use split-table class');
  assert(html.includes('thead { display: table-header-group'), 'table headers should repeat on page breaks');
  assert(html.includes('break-after: avoid-page'), 'headings should avoid isolated page breaks');
  assert(html.includes('.rich-content ul,'), 'lists should receive pagination rules');
  assert(html.includes('max-height: 230mm'), 'diagrams should be constrained to page height');
  assert(html.includes('max-height: 225mm'), 'images should be constrained to page height');
  assert(html.includes('.quality-to-complete-block'), 'to_complete callouts should receive keep rules');
  assert(html.includes('.quality-pdf-force-break'), 'forced page-break class should be available');

  const script = paginationPreparationScript();
  assert(script.includes('getBoundingClientRect'), 'pagination script should measure block height');
  assert(script.includes('quality-pdf-force-break'), 'pagination script should force page breaks');

  console.log('quality documentation PDF pagination tests ok');
}

function documentationDiagram() {
  return {
    id: 'diagram-1',
    section_id: 'chapter-1',
    block_id: 'diagram-block',
    title: 'Diagramme',
    diagram_data: {
      editor_mode: 'mermaid',
      source: 'flowchart TD\n    A([Debut]) --> B[Diagramme]\n    B --> C([Fin])',
      rendered_svg: '<svg class="quality-diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="5" y="20">Diagramme</text></svg>',
    },
  };
}

run();
