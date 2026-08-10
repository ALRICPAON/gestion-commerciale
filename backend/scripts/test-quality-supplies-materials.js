const assert = require('assert');
const fs = require('fs');
const path = require('path');

const suppliesMaterials = require('../services/quality/suppliesMaterials');
const { QUALITY_PERMISSIONS } = require('../services/quality/permissions');
const { listMcpTools } = require('../services/agent/agentToolRegistry');
const { buildCoverageReport } = require('../services/agent/agentFullCoverageService');
const { listModules } = require('../services/agent/agentModuleCatalog');
const { buildPublicMcpTools } = require('../routes/mcpServer')._private;

const ROOT = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '101_supplies_materials.sql');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

async function main() {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS supplies_materials'), 'Table supplies_materials manquante');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS supply_material_links'), 'Table de liaison manquante');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS supply_material_supplier_history'), 'Historique fournisseur manquant');
  assert(migration.includes('ADD COLUMN IF NOT EXISTS supply_material_id uuid'), 'Lien nettoyage supply_material_id manquant');
  assert(migration.includes('quality_document_references'), 'La migration doit referencer le systeme documentaire maitre');
  assert(migration.includes('Rollback manuel'), 'Rollback documente manquant');

  for (const permission of [
    'SUPPLIES_READ',
    'SUPPLIES_WRITE',
    'SUPPLIES_ARCHIVE',
    'SUPPLIES_DOCUMENTS',
  ]) {
    assert(QUALITY_PERMISSIONS[permission], `Permission ${permission} manquante`);
  }

  const qualityIndex = read('backend/routes/quality/index.js');
  assert(qualityIndex.includes("router.use('/supplies-materials'"), 'Route supplies-materials non montee');

  const homeCard = read('frontend/quality/js/home-card.js');
  assert(homeCard.includes('supplies_materials.read'), 'Carte Home non protegee par permission fournitures');
  assert(!homeCard.includes("!sessionUser || !homeContent || document.querySelector('[data-module=\"quality\"]')"), 'La carte Qualite ne doit pas bloquer la carte Fournitures');
  assert(homeCard.includes("grid.querySelector('[data-module=\"supplies-materials\"]')"), 'Anti-doublon Fournitures manquant');
  assert(homeCard.includes("['admin', 'responsable']"), 'Roles admin/responsable non couverts explicitement');
  assert(read('frontend/supplies-materials.html').includes('Fournitures & matériels'), 'Page frontend manquante');
  const suppliesHtml = read('frontend/supplies-materials.html');
  const suppliesFrontend = read('frontend/js/supplies-materials.js');
  assert(suppliesHtml.includes('supply-upload-document-form'), 'Formulaire import document manquant');
  assert(suppliesHtml.includes('accept="application/pdf,image/jpeg,image/png"'), 'Restriction upload PDF/JPG/PNG manquante');
  assert(suppliesFrontend.includes('/api/quality/supplies-materials'), 'Frontend ne cible pas la route canonique');
  assert(suppliesFrontend.includes('body instanceof FormData'), 'Upload FormData doit retirer le Content-Type JSON');
  assert(suppliesFrontend.includes('fetchProtectedBlob'), 'Ouverture Blob protegee manquante');
  assert(!suppliesFrontend.includes('token='), 'Le front ne doit pas exposer le JWT en query string');

  const cleaningValidator = read('backend/validators/quality/cleaning.js');
  const cleaningService = read('backend/services/quality/cleaning.js');
  assert(cleaningValidator.includes('supply_material_id'), 'Payload nettoyage ne nettoie pas supply_material_id');
  assert(cleaningService.includes('assertSupplyMaterial'), 'Service nettoyage ne valide pas supply_material_id');
  assert(cleaningService.includes('before.supply_material_id || before.product_name'), 'Fallback product_name transitionnel manquant');
  assert(cleaningService.includes('supply_material_documents'), 'Les plans de nettoyage doivent exposer les documents du produit');

  const suppliesRoutes = read('backend/routes/quality/suppliesMaterials.js');
  assert(suppliesRoutes.includes("router.post('/:id/documents/upload'"), 'Route upload document fourniture manquante');
  assert(suppliesRoutes.includes("router.get('/documents/:documentId/file'"), 'Route fichier protegee manquante');
  assert(suppliesRoutes.includes('ALLOWED_MIME_TYPES'), 'Filtrage MIME upload manquant');
  assert(!fs.existsSync(path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '102_supplies_materials_upload.sql')), 'Aucune migration ne doit etre ajoutee pour cet upload');

  const suppliesService = read('backend/services/quality/suppliesMaterials.js');
  assert(suppliesService.includes('createSupplyMaterialDocumentFromUpload'), 'Service upload document fourniture manquant');
  assert(suppliesService.includes('linkExistingAttachmentToMasterDocument'), 'Upload doit passer par le document maitre');
  assert(suppliesService.includes('reused_existing'), 'Deduplication par document maitre manquante');
  assert(suppliesService.includes('product_photo'), 'Type photo produit manquant');
  [
    'cleaning_food_contact_products_without_attestation',
    'archived_documents_still_referenced',
    'used_in_procedure_without_regulatory_documents',
    'used_in_pms_but_inactive',
  ].forEach((diagnostic) => assert(suppliesService.includes(diagnostic), `Diagnostic manquant: ${diagnostic}`));

  const exportService = read('backend/services/quality/qualityDocumentationExportService.js');
  assert(exportService.includes('collectSupplyMaterialExternalAttachments'), 'Export DDPP ne collecte pas les documents fournitures');
  assert(exportService.includes('diagnoseSupplyMaterialExportCoverage'), 'Export DDPP ne signale pas les documents fournitures manquants');
  assert(exportService.includes('checksum_sha256') && exportService.includes("path:${path.resolve(item.file_path)}"), 'Deduplication DDPP par checksum/chemin attendue');

  const payload = suppliesMaterials.mapSupplyMaterialPayload({
    name: 'TECHLINE Désinfectant',
    category: 'cleaning_product',
    manufacturer: 'PLG',
    purchase_price: '12.50',
    metadata: {
      dosage: '1%',
      dilution_station_compatible: true,
      contact_time_minutes: 5,
      food_contact: true,
    },
  });
  assert.equal(payload.name, 'TECHLINE Désinfectant');
  assert.equal(payload.category, 'cleaning_product');
  assert.equal(payload.brand, 'PLG');
  assert.equal(payload.purchase_price, 12.5);
  assert.equal(payload.metadata.dilution_station_compatible, true);

  assert.throws(
    () => suppliesMaterials.mapSupplyMaterialPayload({ name: 'Sans categorie' }),
    /Categorie fourniture obligatoire/,
    'Une fiche sans categorie doit etre refusee'
  );

  const tools = listMcpTools();
  const toolNames = new Set(tools.map((tool) => tool.name));
  const expectedTools = [
    'list_supplies_materials',
    'get_supply_material',
    'search_supplies_materials',
    'list_supply_material_documents',
    'list_supply_material_links',
    'create_supply_material',
    'update_supply_material',
    'archive_supply_material',
    'add_supply_material_document_reference',
    'add_supply_material_link',
    'archive_supply_material_link',
    'diagnose_supplies_materials',
  ];
  expectedTools.forEach((name) => assert(toolNames.has(name), `Outil MCP manquant: ${name}`));
  const createTool = tools.find((tool) => tool.name === 'create_supply_material');
  assert.equal(createTool._meta.requiredPermission, 'supplies_materials.write');
  assert.equal(tools.find((tool) => tool.name === 'archive_supply_material')._meta.requiresConfirmation, true);

  const coverage = buildCoverageReport(buildPublicMcpTools(), listModules());
  assert.equal(coverage.coverage_complete, true, `Couverture incomplete: ${JSON.stringify(coverage.missing_tools)}`);
  assert(coverage.final_permissions.includes('supplies_materials.documents'), 'Permission finale documents fournitures absente');
  assert(coverage.matrix.some((row) => row.module === 'supplies_materials' && row.present), 'Module supplies_materials absent de la matrice');

  console.log(JSON.stringify({
    ok: true,
    migration: path.basename(migrationPath),
    categories: suppliesMaterials.SUPPLY_MATERIAL_CATEGORIES.length,
    mcp_tools: expectedTools.length,
    coverage_complete: coverage.coverage_complete,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
