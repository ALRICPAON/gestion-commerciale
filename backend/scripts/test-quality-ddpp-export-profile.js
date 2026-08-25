const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../services/quality/qualityDocumentationExportService');
const { normalizeDiagramData } = require('../services/quality/qualityDocumentationDiagramService');
const { normalizeTableData } = require('../services/quality/qualityDocumentationTableService');
const { closeSharedBrowserForTest, renderHtmlToPdf } = require('../services/pdf/pdfRenderer');

const UUID = '8c84a701-a84d-47c9-877f-f6d2aa89b45c';
const OLD_DIAGRAM_ID = '4ad1bd27-d39b-47b5-9edb-b3257ae3426b';

function wideTable() {
  return normalizeTableData({
    title: 'Matrice HACCP large',
    columns: ['Danger', 'Cause', 'Mesure', 'Surveillance', 'Action corrective', 'Enregistrement'],
    rows: Array.from({ length: 24 }, (_, index) => [
      `Danger ${index + 1}`,
      'Cause documentee',
      'Mesure de maitrise sans modification metier',
      'Controle selon PMS',
      'Correction et tracabilite',
      'ENR-017',
    ]),
  });
}

function fixtureDocumentation() {
  const table = {
    id: 'table-haccp',
    section_id: 'chapter-diagram',
    block_id: 'block-table',
    title: 'Matrice HACCP large',
    table_data: wideTable(),
  };
  const diagram = {
    id: UUID,
    section_id: 'chapter-diagram',
    block_id: 'block-diagram',
    title: 'T3-C18 - Diagramme de fabrication',
    diagram_data: {
      schema_version: 1,
      version: 1,
      editor_mode: 'mermaid',
      title: 'Produits de la peche prepares',
      source: 'flowchart TD\nA[Reception] --> B[Preparation]\nB --> C[Conditionnement]\nC --> D[Expedition]',
      rendered_svg: '<svg><text>Pelage si necessaire</text></svg>',
    },
  };
  return {
    collection: { title: "Manuel qualite et dossier d'agrement sanitaire", version: '1.0' },
    sections: [
      { id: 'tome-1', section_type: 'tome', code: 'T3', title: 'Production', version: '1.0', status: 'validated', include_in_export: true, content_html: '<p>draft ready_for_review ' + UUID + '</p>' },
      { id: 'chapter-diagram', section_type: 'chapter', code: 'T3-C18', title: 'Diagrammes de fabrication', version: '1.0', status: 'draft', include_in_export: true, content_html: '<p>Legacy</p>' },
      { id: 'chapter-plan', section_type: 'chapter', code: 'T2-C03', title: 'Plans', version: '1.0', status: 'to_complete', include_in_export: true, content_html: '<p>Legacy plans</p>' },
    ],
    missing_items: [
      { id: 'm-resolved', status: 'resolved', section_code: 'T1-C01', section_title: 'Resolve', description: 'Ancien point resolu', severity: 'normal' },
      { id: 'm-open-1', status: 'open', section_code: 'T2-C03', section_title: 'Plans', description: 'Plans de la case / contrat incendie', severity: 'external_pending' },
      { id: 'm-open-2', status: 'open', section_code: 'T3-C18', section_title: 'Diagrammes', description: 'Verification terrain des diagrammes apres demarrage', severity: 'future' },
      { id: 'm-open-3', status: 'open', section_code: 'ADMIN', section_title: 'Instruction', description: "Numero d'agrement apres instruction", severity: 'after_instruction' },
    ],
    attachments: [
      { id: 'att-1', section_title: 'Plans', filename: 'case 13 Ã©tage.png', original_filename: 'case 13 Ã©tage.png', mime_type: 'image/png', file_path: 'missing.png', include_in_export: true },
      { id: 'att-2', section_title: 'Analyses', filename: '2026.05.12 analyse EDM traitÃ©e.pdf', original_filename: '2026.05.12 analyse EDM traitÃ©e.pdf', mime_type: 'application/pdf', file_path: 'missing.pdf', include_in_export: true },
    ],
    blocks: [
      { id: 'block-text', chapter_id: 'chapter-diagram', block_type: 'rich_text', position: 10, is_visible: true, content: { html: '<p>Contenu metier utile. block_id: ' + UUID + ' draft</p>' } },
      { id: 'block-diagram', chapter_id: 'chapter-diagram', block_type: 'mermaid_diagram', position: 20, is_visible: true, content: { diagram_id: UUID }, diagram },
      { id: 'block-table', chapter_id: 'chapter-diagram', block_type: 'document_table', position: 30, is_visible: true, content: { table_id: table.id }, table },
      { id: 'block-plan', chapter_id: 'chapter-plan', block_type: 'image', position: 10, is_visible: true, content: { caption: 'Plan RDC et etage' }, attachment: { filename: 'plan.png', mime_type: 'image/png', file_path: '' } },
    ],
    diagrams: [diagram, { id: OLD_DIAGRAM_ID, section_id: 'chapter-diagram', archived_at: null, diagram_data: normalizeDiagramData({ editor_mode: 'mermaid', source: 'flowchart TD\nX[Pelage si necessaire] --> Y[Fin]' }) }],
    tables: [table],
    master_annexes: [{
      document: {
        id: 'doc-1',
        reference_number: 'PROC-010',
        title: 'Nettoyage et desinfection',
        version: '1.0',
        status: 'valid',
        valid_from: '2026-05-01',
        structured_content: { object: 'Decrire le nettoyage', method: 'Application selon plan de nettoyage.' },
        references: [{ target_type: 'documentation_section', target_label: 'T2-C03 Plans', relation_type: 'applies_to' }],
      },
      references: [{ target_label: 'T2-C03 Plans' }],
    }],
    external_master_attachments: [{
      document: { id: 'ext-1', title: 'Analyse eau', original_filename: '2026.05.12 analyse EDM traitÃ©e.pdf', storage_path: 'missing.pdf', mime_type: 'application/pdf' },
      references: [{ relation_type_label: 'Analyse eau/glace', target_label: 'T2-C03 Plans' }],
    }],
  };
}

async function main() {
  const documentation = fixtureDocumentation();
  const html = buildHtml(documentation, {
    company_name: 'ALTA MAREE',
    address_line1: 'Case n 13',
    postal_code: '85100',
    city: "Les Sables-d'Olonne",
    sanitary_approval_number: 'FR 85.999.001 CE',
  }, {
    profile: 'ddpp',
    export_type: 'ddpp',
    include_missing: true,
    include_attachments: true,
    include_master_annexes: true,
    include_external_master_documents: true,
    include_enr_examples: true,
  });

  assert(html.includes("Agrément sanitaire : demande en cours"), 'la couverture DDPP ne doit pas afficher de faux numero');
  assert(!html.includes('FR 85.999.001 CE'), 'le numero historique ne doit pas apparaitre');
  assert(!html.includes('draft'), 'les statuts internes doivent etre masques');
  assert(!html.includes('to_complete'), 'les statuts techniques doivent etre masques');
  assert(!html.includes(UUID), 'les UUID doivent etre masques du HTML DDPP');
  assert(!html.includes('block_id'), 'les metadonnees techniques doivent etre masquees');
  assert(!html.includes('Ancien point resolu'), 'les missing_items resolus ne doivent pas apparaitre');
  assert(html.includes('Plans de la case / contrat incendie'), 'les points ouverts legitimes doivent rester visibles');
  assert(html.includes('Après instruction'), 'les points ouverts doivent etre classes sobrement');
  assert(!html.includes('Pelage si necessaire'), 'le rendu DDPP ne doit pas reprendre un ancien SVG Mermaid');
  assert(!html.includes(OLD_DIAGRAM_ID), 'un diagramme historique sans bloc actif ne doit pas apparaitre');
  assert(html.includes('case 13 étage'), 'les noms de fichiers mojibake doivent etre corriges a l affichage');
  assert(html.toLowerCase().includes('analyse edm traitée'), 'les accents des annexes doivent etre lisibles');
  assert(!html.includes('application/pdf</td>'), 'les MIME bruts ne doivent pas etre exposes en DDPP');
  assert(html.includes('ENR-005') && html.includes('pré-ouverture'), 'les exemples ENR doivent etre clairement marques pre-ouverture');
  assert(html.includes('toc-page') && html.includes('target-counter'), 'le sommaire doit porter un mecanisme de pagination imprimee');
  assert(html.includes('quality-pdf-block--split-table'), 'les tableaux larges doivent conserver le mode split-table');
  assert(html.includes('Annexes fichiers'), 'les annexes doivent etre organisees');
  assert(html.includes('PROC-010') && !html.includes('Statut valid'), 'les procedures doivent masquer les statuts internes');

  const pdf = await renderHtmlToPdf(html, {
    margin: { top: '18mm', right: '12mm', bottom: '18mm', left: '12mm' },
  });
  const outputDir = path.resolve(__dirname, '..', 'uploads', 'quality-documentation-exports');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'ddpp-test-fixture.pdf');
  fs.writeFileSync(outputPath, pdf);

  console.log(JSON.stringify({
    ok: true,
    ddpp_profile: true,
    generated_pdf: outputPath,
    bytes: pdf.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => closeSharedBrowserForTest());
