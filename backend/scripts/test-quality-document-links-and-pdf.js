const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(source, pattern, label) {
  assert(pattern.test(source), label);
}

function assertNotIncludes(source, pattern, label) {
  assert(!pattern.test(source), label);
}

function main() {
  const master = read('frontend/quality/js/master-documents.js');
  const docs = read('frontend/quality/js/documentation.js');
  const links = read('frontend/quality/js/quality-document-links.js');
  const service = read('backend/services/quality/masterDocuments.js');

  assertIncludes(master, /fetch\(`\$\{API_BASE_URL\}\/api\/quality\/master-documents\$\{path\}`[\s\S]*Authorization: `Bearer \$\{token\}`/, 'PDF document maitre doit utiliser fetch authentifie');
  assertIncludes(master, /URL\.createObjectURL\(blob\)/, 'PDF document maitre doit ouvrir un Blob local');
  assertNotIncludes(master, /window\.open\(`\$\{API_BASE_URL\}\/api\/quality\/master-documents\/\$\{encodeURIComponent\(state\.current\.id\)\}\/export-pdf/, 'PDF document maitre ne doit pas ouvrir une URL directe sans header');
  assertNotIncludes(master, /token=|access_token=|jwt=/i, 'Aucun token ne doit etre place dans une URL');

  assertIncludes(docs, /params\.get\('sectionId'\)/, 'documentation.html doit lire sectionId');
  assertIncludes(docs, /params\.get\('section'\)/, 'documentation.html doit accepter un code de chapitre');
  assertIncludes(docs, /Chapitre demande introuvable/, 'chapitre inexistant doit produire une erreur lisible');

  assertIncludes(links, /\/applicable\/\$\{encodeURIComponent\(targetType\)\}/, 'encart documents doit utiliser la resolution applicable derivee');
  assertIncludes(links, /data-master-document-pdf/, 'encart documents doit proposer le PDF authentifie');
  assertNotIncludes(links, /token=|access_token=|jwt=/i, 'Aucun token ne doit etre place dans les liens applicables');

  assertIncludes(service, /resolveStructuredContent/, 'service doit resoudre les UUID du contenu structure');
  assertIncludes(service, /deriveTemperatureRelations/, 'service doit deriver les relations temperature');
  assertIncludes(service, /deriveCleaningRelations/, 'service doit deriver les relations nettoyage');
  assertIncludes(service, /documentation\.html\?sectionId=/, 'liens chapitres doivent utiliser sectionId stable');

  console.log(JSON.stringify({
    ok: true,
    authenticated_pdf_fetch: true,
    no_token_in_url: true,
    section_id_navigation: true,
    missing_section_message: true,
    applicable_documents_endpoint: true,
    derived_temperature_relations: true,
    derived_cleaning_relations: true,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
