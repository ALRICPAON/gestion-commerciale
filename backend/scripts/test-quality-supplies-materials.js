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
  assert(read('frontend/supplies-materials.html').includes('Fournitures & matériels'), 'Page frontend manquante');
  assert(read('frontend/js/supplies-materials.js').includes('/api/quality/supplies-materials'), 'Frontend ne cible pas la route canonique');

  const cleaningValidator = read('backend/validators/quality/cleaning.js');
  const cleaningService = read('backend/services/quality/cleaning.js');
  assert(cleaningValidator.includes('supply_material_id'), 'Payload nettoyage ne nettoie pas supply_material_id');
  assert(cleaningService.includes('assertSupplyMaterial'), 'Service nettoyage ne valide pas supply_material_id');
  assert(cleaningService.includes('before.supply_material_id || before.product_name'), 'Fallback product_name transitionnel manquant');

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
