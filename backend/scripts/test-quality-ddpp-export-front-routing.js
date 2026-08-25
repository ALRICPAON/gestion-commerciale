const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = require('../routes/quality/documentation');
const { buildHtml } = require('../services/quality/qualityDocumentationExportService');
const { closeSharedBrowserForTest, renderHtmlToPdf } = require('../services/pdf/pdfRenderer');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fixtureDocumentation() {
  return {
    collection: { title: "Manuel qualite et dossier d'agrement sanitaire", version: '1.0' },
    sections: [
      { id: 'tome-1', section_type: 'tome', code: 'T1', title: 'Generalites', version: '1.0', status: 'validated', include_in_export: true, content_html: '<p>ready_for_review to_complete</p>' },
      { id: 'chapter-1', section_type: 'chapter', code: 'T1-C01', title: 'Presentation', version: '1.0', status: 'draft', include_in_export: true, content_html: '<p>Contenu utile.</p>' },
    ],
    blocks: [
      { id: 'block-1', chapter_id: 'chapter-1', block_type: 'rich_text', position: 1, is_visible: true, content: { html: '<p>Contenu utile. ready_for_review to_complete Statut draft</p>' } },
    ],
    missing_items: [
      { id: 'missing-open', status: 'open', section_code: 'T1-C01', section_title: 'Presentation', description: 'Information terrain a completer', severity: 'future' },
    ],
    attachments: [],
    tables: [],
    diagrams: [],
    master_annexes: [{
      document: {
        id: 'enr-005',
        reference_number: 'ENR-005',
        title: 'Controle a reception',
        document_type: 'record_form',
        version: '1.0',
        status: 'valid',
        valid_from: '2026-05-01',
        structured_content: {
          object: 'Formulaire papier historique',
          method: 'En-tete a remplir\nCases conforme/non conforme\nLignes produit\nTemperature\nSignatures\nDecision\nCloture\nUTILISATION DANS ALTA\nModule\nPage\nMenu\nFonction',
          quality_links: 'record_for evidence_template applies_to',
        },
        references: [{ target_type: 'purchase', target_label: 'Reception', relation_type: 'record_for' }],
      },
      references: [{ target_label: 'Reception' }],
    }],
    external_master_attachments: [],
  };
}

async function main() {
  const page = read('frontend/quality/pages/documentation.html');
  const frontend = read('frontend/quality/js/documentation.js');

  assert(page.includes('export-internal-pdf-btn'), 'bouton export interne manquant');
  assert(page.includes('Export complet ALTA'), 'libelle export interne manquant');
  assert(page.includes('export-pdf-btn'), 'bouton export DDPP manquant');
  assert(page.includes('Export dossier DDPP'), 'libelle export DDPP manquant');
  assert(page.includes('documentation.js?v=7'), 'cache-buster documentation.js attendu');

  assert(frontend.includes("exportPayload(mode = 'preview')"), 'exportPayload doit utiliser un mode explicite');
  assert(frontend.includes("export_type: 'ddpp'"), 'payload DDPP doit envoyer export_type=ddpp');
  assert(frontend.includes("profile: 'ddpp'"), 'payload DDPP doit envoyer profile=ddpp');
  assert(frontend.includes("openPdf(`/${state.collection.id}/export-pdf`, 'ddpp')"), 'bouton DDPP doit appeler export-pdf en mode ddpp');
  assert(frontend.includes("openPdf(`/${state.collection.id}/export-pdf`, 'full')"), 'bouton interne doit appeler export-pdf en mode full');
  assert(!frontend.includes("openPdf(`/${state.collection.id}/export-pdf`, true)"), 'ancien boolen download ne doit plus router le PDF');

  const ddppPayload = {
    export_type: 'ddpp',
    profile: 'ddpp',
    include_missing: true,
    include_attachments: true,
    include_master_annexes: true,
    include_external_master_documents: true,
    include_enr_examples: true,
  };
  const ddppOptions = route.exportOptions(ddppPayload);
  assert.equal(ddppOptions.export_type, 'ddpp', 'route exportOptions doit conserver export_type ddpp');
  assert.equal(ddppOptions.profile, 'ddpp', 'route exportOptions doit conserver profile ddpp');
  assert.equal(ddppOptions.include_master_annexes, true, 'DDPP doit inclure les annexes metier');
  assert.equal(ddppOptions.include_external_master_documents, true, 'DDPP doit inclure les documents externes');

  const fullOptions = route.exportOptions({ export_type: 'full', include_master_annexes: true, include_external_master_documents: true });
  assert.equal(fullOptions.export_type, 'full', 'export interne doit rester full');
  assert.equal(fullOptions.profile, null, 'export interne ne doit pas devenir DDPP');
  assert.throws(() => route.exportOptions({ profile: 'unknown' }), /Profil d'export qualite invalide/, 'profil inconnu doit etre refuse');

  const documentation = fixtureDocumentation();
  const html = buildHtml(documentation, {
    company_name: 'ALTA MAREE',
    address_line1: 'Case n 13',
    postal_code: '85100',
    city: "Les Sables-d'Olonne",
    sanitary_approval_number: 'FR 85.999.001 CE',
  }, ddppOptions);

  assert(!html.includes('ready_for_review'), 'PDF DDPP route ne doit pas contenir ready_for_review');
  assert(!html.includes('to_complete'), 'PDF DDPP route ne doit pas contenir to_complete');
  assert(!html.includes('Statut draft'), 'PDF DDPP route ne doit pas contenir Statut draft');
  assert(!html.includes('<h1>Informations a completer</h1>'), 'PDF DDPP route ne doit pas rendre la page interne Informations a completer');
  assert(!html.includes('Documents et objets associes'), 'PDF DDPP route ne doit pas exposer Documents et objets associes');
  assert(html.includes('Vue ALTA - reception fournisseur'), 'PDF DDPP route doit utiliser le rendu ENR natif');
  assert(!html.includes('En-tete a remplir'), 'PDF DDPP route ne doit pas imprimer le formulaire ENR historique');

  const internalHtml = buildHtml(documentation, {
    company_name: 'ALTA MAREE',
    address_line1: 'Case n 13',
    postal_code: '85100',
    city: "Les Sables-d'Olonne",
    sanitary_approval_number: 'FR 85.999.001 CE',
  }, fullOptions);
  assert(internalHtml.includes('Documents et objets associes'), 'export interne doit conserver les objets associes');
  assert(internalHtml.includes('En-tete a remplir'), 'export interne doit conserver le formulaire ENR historique');

  const pdf = await renderHtmlToPdf(html, {
    margin: { top: '18mm', right: '12mm', bottom: '18mm', left: '12mm' },
  });
  const outputDir = path.resolve(__dirname, '..', 'uploads', 'quality-documentation-exports');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'ddpp-front-route-fixture.pdf');
  fs.writeFileSync(outputPath, pdf);

  console.log(JSON.stringify({
    ok: true,
    frontend_buttons: true,
    ddpp_payload: ddppPayload,
    route_options: ddppOptions,
    generated_pdf: outputPath,
    bytes: pdf.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => closeSharedBrowserForTest());
