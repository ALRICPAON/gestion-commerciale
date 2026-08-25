const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderDiagramSvg } = require('../services/quality/qualityDocumentationDiagramService');
const { renderDocumentBlock } = require('../services/quality/qualityDocumentBlockService');
const {
  buildHtml,
  inlineImageDataUri,
  paginationPreparationScript,
} = require('../services/quality/qualityDocumentationExportService');
const { closeSharedBrowserForTest, renderHtmlToPdf } = require('../services/pdf/pdfRenderer');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

function imageAttachment(filePath, filename) {
  return {
    id: filename,
    section_id: 'chapter-1',
    filename,
    original_filename: filename,
    file_path: filePath,
    mime_type: 'image/png',
    include_in_export: true,
  };
}

function tableBlock() {
  return {
    id: 'table-1',
    section_id: 'chapter-1',
    block_id: 'block-table-1',
    title: 'Table HACCP',
    table_data: {
      title: 'Table HACCP',
      header: true,
      columns: [
        { id: 'danger', label: 'Danger', alignment: 'left' },
        { id: 'measure', label: 'Mesure', alignment: 'left' },
      ],
      rows: [
        { id: 'r1', cells: { danger: 'Temperature', measure: 'Controle reception' } },
      ],
    },
  };
}

function diagramBlock(title, diagramData, position) {
  return {
    id: `block-${position}`,
    chapter_id: 'chapter-1',
    block_type: 'mermaid_diagram',
    position,
    is_visible: true,
    content: { diagram_id: `diagram-${position}` },
    diagram: {
      id: `diagram-${position}`,
      section_id: 'chapter-1',
      block_id: `block-${position}`,
      title,
      diagram_data: diagramData,
    },
  };
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-pdf-assets-'));
  const normalPath = path.join(tempDir, 'case 13 rdc.png');
  const accentPath = path.join(tempDir, 'case 13 étage.png');
  fs.writeFileSync(normalPath, PNG_1X1);
  fs.writeFileSync(accentPath, PNG_1X1);

  const normalAttachment = imageAttachment(normalPath, 'case 13 rdc.png');
  const accentAttachment = imageAttachment(accentPath, 'case 13 étage.png');
  const table = tableBlock();

  const resolved = inlineImageDataUri(accentAttachment);
  assert(resolved.startsWith('data:image/png;base64,'), 'inline image resolver should embed local image bytes');

  const imageHtml = renderDocumentBlock({
    block_type: 'image',
    is_visible: true,
    title: 'Plan case 13',
    content: { caption: 'Plan case 13 étage' },
    attachment: accentAttachment,
  }, { resolveImageSrc: inlineImageDataUri });
  assert(imageHtml.includes('data:image/png;base64,'), 'image block should use resolved data URI');
  assert(!imageHtml.includes(accentPath), 'image block should not expose raw local path when resolver is used');

  const normalizedMermaidSvg = renderDiagramSvg({
    editor_mode: 'mermaid',
    title: 'SVG brut',
    source: 'flowchart TD\n A[Debut] --> B[Fin]',
    rendered_svg: '<svg width="640" height="320"><text x="10" y="20">Flux</text></svg>',
  }, { assumeRenderedSvgCurrent: true });
  assert(normalizedMermaidSvg.includes('viewBox="0 0 640 320"'), 'Mermaid SVG without viewBox should gain stable viewBox');
  assert(normalizedMermaidSvg.includes('quality-diagram-svg'), 'Mermaid SVG should carry PDF diagram class');
  assert(!/\swidth="640"/.test(normalizedMermaidSvg), 'Mermaid SVG fixed width should be removed for PDF scaling');

  const documentation = {
    collection: { title: 'Manuel qualite test', version: '1.0' },
    sections: [{
      id: 'chapter-1',
      section_type: 'chapter',
      code: 'T2-C03',
      title: 'Plans et flux',
      version: '1.0',
      status: 'draft',
      include_in_export: true,
      content_html: '<p>Legacy</p>',
    }],
    missing_items: [],
    attachments: [normalAttachment, accentAttachment],
    blocks: [
      { id: 'intro', chapter_id: 'chapter-1', block_type: 'rich_text', position: 10, is_visible: true, content: { html: '<p>Avant les visuels.</p>' } },
      { id: 'image-1', chapter_id: 'chapter-1', block_type: 'image', position: 20, is_visible: true, title: 'Plan RDC', content: { attachment_id: normalAttachment.id, caption: 'case 13 rdc.png' }, attachment: normalAttachment },
      diagramBlock('Diagramme simple', {
        version: 1,
        title: 'Diagramme simple',
        orientation: 'vertical',
        nodes: [
          { id: 'debut', label: 'Debut', type: 'start', x: 0, y: 0 },
          { id: 'fin', label: 'Fin', type: 'end', x: 0, y: 1 },
        ],
        edges: [{ id: 'e1', from: 'debut', to: 'fin', label: '' }],
      }, 30),
      diagramBlock('Diagramme branches', {
        version: 1,
        title: 'Diagramme branches',
        orientation: 'vertical',
        nodes: [
          { id: 'controle', label: 'Controle', type: 'control', x: 0, y: 0 },
          { id: 'decision', label: 'Conforme ?', type: 'decision', x: 0, y: 1 },
          { id: 'oui', label: 'Poursuite', type: 'process', x: -1, y: 2 },
          { id: 'non', label: 'Isolement', type: 'non_conformity', x: 1, y: 2 },
        ],
        edges: [
          { id: 'e1', from: 'controle', to: 'decision', label: '' },
          { id: 'e2', from: 'decision', to: 'oui', label: 'Oui' },
          { id: 'e3', from: 'decision', to: 'non', label: 'Non' },
        ],
      }, 40),
      { id: 'table', chapter_id: 'chapter-1', block_type: 'document_table', position: 50, is_visible: true, content: { table_id: table.id }, table },
      { id: 'image-2', chapter_id: 'chapter-1', block_type: 'image', position: 60, is_visible: true, title: 'Plan étage', content: { attachment_id: accentAttachment.id, caption: 'case 13 étage.png' }, attachment: accentAttachment },
      { id: 'outro', chapter_id: 'chapter-1', block_type: 'rich_text', position: 70, is_visible: true, content: { html: '<p>Apres les visuels.</p>' } },
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

  assert.strictEqual((html.match(/data:image\/png;base64,/g) || []).length, 2, 'both PNG blocks should be embedded as data URIs');
  assert(!html.includes(`src="${normalPath}`), 'normal image path should not be used as img src');
  assert(!html.includes(`src="${accentPath}`), 'accented image path should not be used as img src');
  assert(html.includes('quality-data-table'), 'document table should remain rendered');
  assert(html.includes('Diagramme simple'), 'simple diagram should render');
  assert(html.includes('Diagramme branches'), 'branched diagram should render');
  assert(html.includes('Avant les visuels') && html.includes('Apres les visuels'), 'successive elements should keep surrounding content');
  assert(html.includes('quality-pdf-block--oversize'), 'oversize pagination CSS should be available');
  assert(paginationPreparationScript().includes('quality-pdf-block--oversize'), 'pagination script should handle oversized visual blocks');

  const pdf = await renderHtmlToPdf(html, {
    beforePdfScript: paginationPreparationScript(),
    margin: { top: '18mm', right: '12mm', bottom: '18mm', left: '12mm' },
  });
  assert(pdf.length > 1000, 'full PDF generation should produce a non-empty buffer');
  await closeSharedBrowserForTest();

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('quality PDF rendering assets tests ok');
}

run().catch(async (error) => {
  await closeSharedBrowserForTest().catch(() => {});
  console.error(error);
  process.exit(1);
});
