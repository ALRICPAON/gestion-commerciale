const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const {
  buildHtml,
  collectAttachmentAppendixItems,
  collectExternalAppendixItems,
  mergeAppendices,
  renderDocumentationMainPdf,
} = require('../services/quality/qualityDocumentationExportService');
const { normalizeDiagramData } = require('../services/quality/qualityDocumentationDiagramService');
const { normalizeTableData } = require('../services/quality/qualityDocumentationTableService');
const { closeSharedBrowserForTest } = require('../services/pdf/pdfRenderer');

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
  const diagramSource = 'flowchart TD\nA[Reception] --> B[Preparation immediate]\nB --> C[Conditionnement]\nC --> D[Expedition]';
  const diagram = {
    id: UUID,
    section_id: 'chapter-diagram',
    block_id: 'block-diagram',
    title: 'Flux produits frais - case n 13',
    diagram_data: normalizeDiagramData({
      schema_version: 1,
      version: 1,
      editor_mode: 'mermaid',
      title: 'Produits de la peche prepares',
      source: diagramSource,
      rendered_svg: '<svg viewBox="0 0 1200 800"><text>PPrreeppaarraattiioonn iimmmmeeddiiaattee</text></svg>',
    }, { assumeRenderedSvgCurrent: true }),
  };
  return {
    collection: { title: "Manuel qualite et dossier d'agrement sanitaire", version: '1.0' },
    sections: [
      { id: 'tome-1', section_type: 'tome', code: 'D1-3', title: 'Production', version: '1.0', status: 'validated', include_in_export: true, content_html: '<p>draft ready_for_review ' + UUID + '</p>' },
      { id: 'chapter-diagram', section_type: 'chapter', code: 'D1-3.2.3', title: 'Diagrammes de fabrication', version: '1.0', status: 'validated', include_in_export: true, content_html: '<p>Legacy</p>' },
      { id: 'chapter-plan', section_type: 'chapter', code: 'D1-2.8', title: 'Plans', version: '1.0', status: 'validated', include_in_export: true, content_html: '<p>Legacy plans</p>' },
      { id: 'tome-identity', section_type: 'tome', code: 'D1-1', title: 'Identite de l etablissement', version: '1.0', status: 'draft', include_in_export: true, content_html: '<p>Statut : Brouillon.</p><p>Identite reglementaire utile.</p>' },
      { id: 'chapter-identity', section_type: 'chapter', code: 'D1-1.2', title: 'Organisation', version: '1.0', status: 'to_complete', include_in_export: true, content_html: '<p>Organisation utile.</p>' },
      { id: 'tome-pms', section_type: 'tome', code: 'D1-2', title: 'Plan de maitrise sanitaire', version: '1.0', status: 'ready_for_review', include_in_export: true, content_html: '<p>Statut : Complet pour le depot.</p><p>PMS utile.</p>' },
      { id: 'legacy-tome', section_type: 'tome', code: 'T3', title: 'Production historique', version: '1.0', status: 'validated', include_in_export: true, content_html: '<p>Ancien tome T</p>' },
      { id: 'legacy-chapter', section_type: 'chapter', code: 'T2-C03', title: 'Plans historiques', version: '1.0', status: 'validated', include_in_export: true, content_html: '<p>Ancien chapitre T</p>' },
    ],
    missing_items: [
      { id: 'm-resolved', section_id: 'chapter-plan', status: 'resolved', section_code: 'D1-2.8', section_title: 'Resolve', description: 'Ancien point resolu', severity: 'normal' },
      { id: 'm-open-1', section_id: 'chapter-plan', status: 'open', section_code: 'D1-2.8', section_title: 'Plans', description: 'Plans de la case / contrat incendie', severity: 'external_pending' },
      { id: 'm-open-2', section_id: 'chapter-diagram', status: 'open', section_code: 'D1-3.2.3', section_title: 'Diagrammes', description: 'Verification terrain des diagrammes apres demarrage', severity: 'future' },
      { id: 'm-open-legacy', section_id: 'legacy-chapter', status: 'open', section_code: 'T2-C03', section_title: 'Plans historiques', description: 'Ancien point T a ignorer', severity: 'normal' },
    ],
    attachments: [
      { id: 'att-1', section_id: 'chapter-plan', section_title: 'Plans', filename: 'case 13 ÃƒÂ©tage.png', original_filename: 'case 13 ÃƒÂ©tage.png', mime_type: 'image/png', file_path: 'missing.png', include_in_export: true },
      { id: 'att-2', section_id: 'chapter-diagram', section_title: 'Analyses', filename: '2026.05.12 analyse EDM traitÃƒÂ©e.pdf', original_filename: '2026.05.12 analyse EDM traitÃƒÂ©e.pdf', mime_type: 'application/pdf', file_path: 'missing.pdf', include_in_export: true },
      { id: 'att-legacy', section_id: 'legacy-chapter', section_title: 'Plans historiques', filename: 'legacy-t.pdf', original_filename: 'legacy-t.pdf', mime_type: 'application/pdf', file_path: 'missing.pdf', include_in_export: true },
    ],
    blocks: [
      { id: 'block-text', chapter_id: 'chapter-diagram', block_type: 'rich_text', position: 10, is_visible: true, content: { html: '<p>Contenu metier utile. block_id: ' + UUID + ' draft</p>' } },
      { id: 'block-diagram', chapter_id: 'chapter-diagram', block_type: 'mermaid_diagram', position: 20, is_visible: true, content: { diagram_id: UUID }, diagram },
      { id: 'block-table', chapter_id: 'chapter-diagram', block_type: 'document_table', position: 30, is_visible: true, content: { table_id: table.id }, table },
      { id: 'block-plan', chapter_id: 'chapter-plan', block_type: 'image', position: 10, is_visible: true, content: { caption: 'Plan RDC et etage' }, attachment: { filename: 'plan.png', mime_type: 'image/png', file_path: '' } },
      { id: 'block-open', chapter_id: 'chapter-plan', block_type: 'to_complete', position: 20, is_visible: true, content: { text: 'Element ouvert interne' } },
    ],
    diagrams: [diagram, { id: OLD_DIAGRAM_ID, section_id: 'chapter-diagram', archived_at: null, diagram_data: normalizeDiagramData({ editor_mode: 'mermaid', source: 'flowchart TD\nX[Pelage si necessaire] --> Y[Fin]' }) }],
    tables: [table],
    master_annexes: [
      {
        document: {
          id: 'doc-1',
          reference_number: 'PROC-010',
          title: 'Nettoyage et desinfection',
          version: '1.0',
          status: 'valid',
          valid_from: '2026-05-01',
          structured_content: { object: 'Decrire le nettoyage', method: 'Application selon plan de nettoyage.' },
          references: [{ target_type: 'documentation_section', target_label: 'D1-2.8 Plans', relation_type: 'applies_to' }],
        },
        references: [{ target_label: 'D1-2.8 Plans' }],
      },
      {
        document: {
          id: 'doc-enr-005',
          reference_number: 'ENR-005',
          title: 'ContrÃ´le Ã  rÃ©ception',
          document_type: 'record_form',
          version: '1.0',
          valid_from: '2026-05-01',
          structured_content: {
            object: 'Formulaire papier historique ENR-005',
            method: 'En-tÃªte Ã  remplir\nCases conforme/non conforme\nLignes produit\nTempÃ©rature\nSignatures\nDÃ©cision\nClÃ´ture\nUTILISATION DANS ALTA\nModule\nPage\nMenu\nFonction',
            quality_links: 'record_for evidence_template applies_to',
          },
          references: [{ target_type: 'purchase', target_label: 'Reception', relation_type: 'record_for' }],
        },
        references: [{ target_label: 'Reception' }],
      },
      {
        document: { id: 'doc-enr-006', reference_number: 'ENR-006', title: 'RelevÃ©s de tempÃ©ratures', document_type: 'record_form', version: '1.0', valid_from: '2026-05-01', structured_content: { method: 'Formulaire temperature papier historique' } },
        references: [{ target_label: 'Maitrise temperatures' }],
      },
      {
        document: { id: 'doc-enr-010', reference_number: 'ENR-010', title: 'Nettoyage rÃ©alisÃ©', document_type: 'record_form', version: '1.0', valid_from: '2026-05-01', structured_content: { method: 'Dix sections du formulaire documentaire nettoyage' } },
        references: [{ target_label: 'Nettoyage' }],
      },
      {
        document: { id: 'doc-enr-017', reference_number: 'ENR-017', title: 'TraÃ§abilitÃ© lot', document_type: 'record_form', version: '1.0', valid_from: '2026-05-01', structured_content: { method: 'Formulaire vierge de tracabilite' } },
        references: [{ target_label: 'Tracabilite' }],
      },
      {
        document: { id: 'doc-enr-014', reference_number: 'ENR-014', title: 'Surveillance nuisibles', document_type: 'record_form', version: '1.0', valid_from: '2026-05-01', structured_content: { method: 'Support nuisibles generique' } },
        references: [{ target_label: 'Nuisibles' }],
      },
    ],
    external_master_attachments: [{
      document: { id: 'ext-1', title: 'Analyse eau', original_filename: '2026.05.12 analyse EDM traitÃƒÂ©e.pdf', storage_path: 'missing.pdf', mime_type: 'application/pdf' },
      references: [{ relation_type_label: 'Analyse eau/glace', target_label: 'D1-2.8 Plans' }],
    }],
  };
}

async function createTestPdf(filePath, label) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(label, { x: 50, y: 760, size: 14, font });
  fs.writeFileSync(filePath, Buffer.from(await pdf.save()));
}

async function extractPdfText(pdfBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), disableWorker: true }).promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    return pages.join('\n');
  } finally {
    await document.destroy();
  }
}

async function main() {
  const documentation = fixtureDocumentation();
  const identity = {
    company_name: 'ALTA MAREE',
    address_line1: 'Case n 13',
    postal_code: '85100',
    city: "Les Sables-d'Olonne",
    sanitary_approval_number: 'FR 85.999.001 CE',
  };
  const options = {
    profile: 'ddpp',
    export_type: 'ddpp',
    include_missing: true,
    include_attachments: true,
    include_master_annexes: true,
    include_external_master_documents: true,
    include_enr_examples: true,
  };
  const outputDir = path.resolve(__dirname, '..', 'uploads', 'quality-documentation-exports');
  const assetDir = path.join(outputDir, 'ddpp-test-assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const attachmentPaths = [path.join(assetDir, 'plan.pdf'), path.join(assetDir, 'analyse.pdf')];
  const externalPath = path.join(assetDir, 'document-externe.pdf');
  await createTestPdf(attachmentPaths[0], 'Plan case 13');
  await createTestPdf(attachmentPaths[1], 'Analyse eau');
  await createTestPdf(externalPath, 'Justificatif externe');
  documentation.attachments[0].file_path = attachmentPaths[0];
  documentation.attachments[0].mime_type = 'application/pdf';
  documentation.attachments[1].file_path = attachmentPaths[1];
  documentation.external_master_attachments[0].document.storage_path = externalPath;

  const rendered = await renderDocumentationMainPdf(documentation, identity, options);
  const html = rendered.html;

  assert(html.includes('demande en cours'), 'la couverture DDPP ne doit pas afficher de faux numero');
  assert(!html.includes('FR 85.999.001 CE'), 'le numero historique ne doit pas apparaitre');
  assert(!html.includes('draft'), 'les statuts internes doivent etre masques');
  assert(!html.includes('to_complete'), 'les statuts techniques doivent etre masques');
  assert(!html.includes(UUID), 'les UUID doivent etre masques du HTML DDPP');
  assert(!html.includes('block_id'), 'les metadonnees techniques doivent etre masquees');
  assert(!html.includes('Ancien point resolu'), 'les missing_items resolus ne doivent pas apparaitre');
  assert(!html.includes('T2-C03') && !html.includes('T3-C18') && !html.includes('T1-C01'), 'le profil DDPP D ne doit plus exposer les codes T historiques');
  assert(!html.includes('Ancien chapitre T') && !html.includes('Ancien point T a ignorer') && !html.includes('legacy-t.pdf'), 'les contenus rattaches aux anciens T doivent etre ignores');
  assert(!html.includes('Plans de la case / contrat incendie'), 'les points ouverts ne doivent pas etre exposes en DDPP');
  assert(!/Tableau de correspondance D1|Statut actuel|Éléments restant à compléter/i.test(html), 'le suivi interne ne doit pas etre rendu');
  assert(!/Statut\s*:\s*(?:Complet|Brouillon|À compléter|A completer)/i.test(html), 'les lignes de statut doivent etre retirees des chapitres');
  assert(!html.includes('Element ouvert interne'), 'les blocs to_complete doivent etre masques en DDPP');
  const orderedCodes = ['D1-1', 'D1-1.2', 'D1-2', 'D1-2.8', 'D1-3', 'D1-3.2.3'];
  orderedCodes.reduce((previousIndex, code) => {
    const index = html.indexOf(`<td>${code}</td>`, previousIndex + 1);
    assert(index > previousIndex, `le sommaire doit placer ${code} dans l ordre reglementaire`);
    return index;
  }, -1);
  const expectedSectionIds = documentation.sections.filter((section) => /^D/.test(section.code)).map((section) => section.id).sort();
  assert.deepStrictEqual(Object.keys(rendered.toc_page_numbers).sort(), expectedSectionIds, 'chaque chapitre D doit avoir une page de sommaire');
  for (const pageNumber of Object.values(rendered.toc_page_numbers)) {
    assert(Number.isInteger(pageNumber) && pageNumber > 0, 'chaque ligne du sommaire doit avoir un numero de page');
  }
  assert(!html.includes('Pelage si necessaire'), 'le rendu DDPP ne doit pas reprendre un ancien SVG Mermaid');
  assert(!html.includes(OLD_DIAGRAM_ID), 'un diagramme historique sans bloc actif ne doit pas apparaitre');
  assert(html.includes('case 13') && !html.includes('case 13 Ãƒ'), 'les noms de fichiers mojibake doivent etre corriges a l affichage');
  assert(html.toLowerCase().includes('analyse edm') && !html.includes('traitÃƒ'), 'les accents des annexes doivent etre lisibles');
  assert(!html.includes('application/pdf</td>'), 'les MIME bruts ne doivent pas etre exposes en DDPP');
  assert(html.includes('ENR-005') && /EXEMPLE DE SUPPORT ALTA - PR\S-OUVERTURE/.test(html), 'les exemples ENR doivent etre clairement marques pre-ouverture');
  assert(html.includes('toc-page') && !html.includes('target-counter'), 'le sommaire doit contenir des numeros calcules explicitement');
  assert(!/<td class="toc-page"><a[^>]*><\/a><\/td>/.test(html), 'aucune ligne du sommaire ne doit avoir une page vide');
  assert(html.includes('quality-pdf-block--split-table'), 'les tableaux larges doivent conserver le mode split-table');
  assert(html.includes('Annexes fichiers'), 'les annexes doivent etre organisees');
  assert(html.includes('PROC-010') && !html.includes('Statut valid'), 'les procedures doivent masquer les statuts internes');
  assert(!html.includes('remplir'), 'DDPP ne doit plus imprimer le formulaire complet ENR-005');
  assert(!html.includes('UTILISATION DANS ALTA'), 'DDPP doit masquer les sections internes des ENR');
  assert(!html.includes('record_for') && !html.includes('evidence_template'), 'DDPP doit masquer les relations techniques des ENR');
  assert(html.includes('Vue ALTA - reception fournisseur'), 'ENR-005 doit etre rendu en vue native reception ALTA');
  assert(html.includes('direct fournisseur') && html.includes('client'), 'ENR-005 direct_trade doit etre explicite');
  assert(html.includes('Contrôles physiques</th><td>Non applicables') || html.includes('Controles physiques</th><td>Non applicables'), 'ENR-005 direct_trade ne doit pas inventer de controles physiques');
  assert(html.includes('Non applicable - aucune mesure inventée') || html.includes('Non applicable - aucune mesure inventee'), 'ENR-005 direct_trade ne doit pas inventer de temperature');
  assert(!/prix|montant|total ht|total ttc/i.test(html), 'DDPP ENR ne doit pas exposer de prix ou montants');
  assert(html.includes('Vue ALTA') && html.toLowerCase().includes('temp'), 'ENR-006 doit etre rendu nativement');
  assert(html.includes('Vue ALTA') && html.toLowerCase().includes('nettoyage'), 'ENR-010 doit etre rendu nativement');
  assert(html.includes('Vue ALTA - filiation lot'), 'ENR-017 doit etre rendu nativement');
  assert(html.includes('Support DDPP - surveillance nuisibles'), 'ENR generique doit rester disponible');
  assert(/EXEMPLE DE SUPPORT ALTA - PR\S-OUVERTURE/.test(html), 'les vues fixture doivent porter le bandeau pre-ouverture');
  assert(!html.includes('PPrreeppaarraattiioonn'), 'le SVG stocke avec double couche texte doit etre ignore en DDPP');
  assert((html.match(/Preparation immediate/g) || []).length === 1, 'le libelle du diagramme doit etre rendu une seule fois depuis la source');

  const internalHtml = buildHtml(documentation, {
    company_name: 'ALTA MAREE',
    address_line1: 'Case n 13',
    postal_code: '85100',
    city: "Les Sables-d'Olonne",
    sanitary_approval_number: 'FR 85.999.001 CE',
  }, {
    export_type: 'full',
    include_missing: true,
    include_attachments: true,
    include_master_annexes: true,
    include_external_master_documents: true,
  });
  assert(internalHtml.includes('remplir'), 'l export interne doit conserver le formulaire ENR complet');
  assert(internalHtml.includes('UTILISATION DANS ALTA'), 'l export interne doit conserver les sections internes des ENR');
  assert(internalHtml.includes('Statut : Brouillon') && internalHtml.includes('Element ouvert interne'), 'l export interne doit conserver les statuts et le suivi');

  const sections = documentation.sections.filter((section) => /^D/.test(section.code));
  const renderOptions = { ...options, sections };
  const appendixItems = [
    ...collectAttachmentAppendixItems(documentation, renderOptions),
    ...collectExternalAppendixItems(documentation.external_master_attachments, renderOptions),
  ];
  const merged = await mergeAppendices(rendered.pdf, appendixItems);
  assert.strictEqual(merged.summary.embedded_attachments, 3, 'les pieces jointes et documents externes doivent rester fusionnes');
  const pdfText = await extractPdfText(merged.pdf);
  const normalizedPdfText = pdfText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  assert(!/tableau de correspondance|elements? restant a completer|\bbrouillon\b|\bcomplet(?:e)?\b|\bmanquant\b|statut actuel|element ouvert|suivi (?:de migration|projet)/i.test(normalizedPdfText), 'le PDF final ne doit exposer aucun workflow interne');
  assert(pdfText.includes('PROC-010') && pdfText.includes('ENR-005'), 'les PROC et ENR doivent rester presents dans le PDF final');
  assert(pdfText.includes('Plan case 13') && pdfText.includes('Justificatif externe'), 'les annexes doivent etre presentes dans le PDF fusionne');

  const outputPath = path.join(outputDir, 'ddpp-control-clean-workflow.pdf');
  fs.writeFileSync(outputPath, merged.pdf);

  console.log(JSON.stringify({
    ok: true,
    ddpp_profile: true,
    generated_pdf: outputPath,
    pages_in_toc: rendered.toc_page_numbers,
    embedded_attachments: merged.summary.embedded_attachments,
    bytes: merged.pdf.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => closeSharedBrowserForTest());
