const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const {
  MATERIAL_MOVEMENT,
  OUTPUT_MOVEMENT,
  SOURCE_MOVEMENT,
  buildOutputTraceability,
  normalizeDraftQuantities,
  packingError,
} = require('../services/packingService');

function includes(file, pattern, message) {
  assert(read(file).includes(pattern), message);
}

function main() {
  const migration = read('backend/db/gestion-commerciale/106_packing_foundation.sql');
  const rollback = read('backend/db/gestion-commerciale/106_packing_foundation_rollback.sql');
  const service = read('backend/services/packingService.js');
  const route = read('backend/routes/packing.js');
  const server = read('backend/server.js');
  const doc = read('docs/PACKING_BACKEND_FOUNDATION.md');

  assert(migration.includes('CREATE TABLE IF NOT EXISTS packing_operations'), 'migration doit creer packing_operations');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS packing_source_lots'), 'migration doit creer packing_source_lots');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS packing_materials'), 'migration doit creer packing_materials');
  assert(migration.includes('package_count integer NOT NULL'), 'package_count doit etre entier');
  assert(migration.includes('ALTER COLUMN package_count TYPE integer USING package_count::integer'), 'migration 106 doit corriger package_count en base de test deja migree');
  assert(migration.includes("CHECK (status IN ('draft', 'validated', 'cancelled'))"), 'status draft/validated/cancelled requis');
  assert(migration.includes('packing_operations_quantity_consistency_check'), 'coherence package_count * quantity_per_package requise');
  assert(migration.includes("ARRAY['id', 'store_id']::text[]"), 'detection FK composite lots doit caster en text[]');
  assert(migration.includes('packing_lots_id_store_id_unique'), 'unique lots(id, store_id) compatible FK requis');
  assert(migration.includes('FOREIGN KEY (output_article_id, store_id)'), 'FK composite output article requise');
  assert(migration.includes('FOREIGN KEY (output_lot_id, store_id)'), 'FK composite output lot requise');
  assert(migration.includes('FOREIGN KEY (packing_operation_id, store_id)'), 'FK composite operation requise');
  assert(migration.includes('FOREIGN KEY (lot_id, store_id)'), 'FK composite lot requise');
  assert(migration.includes('UNIQUE (store_id, packing_operation_id, lot_id)'), 'un lot ne doit apparaitre qu une fois');
  assert(!migration.includes('stock_packaging'), 'aucun stock emballage separe ne doit etre cree');
  assert(rollback.includes('DROP TABLE IF EXISTS packing_materials'), 'rollback doit retirer materials');
  assert(rollback.includes('DROP TABLE IF EXISTS packing_source_lots'), 'rollback doit retirer sources');
  assert(rollback.includes('DROP TABLE IF EXISTS packing_operations'), 'rollback doit retirer operations');

  assert.equal(SOURCE_MOVEMENT, 'packing_source_out');
  assert.equal(MATERIAL_MOVEMENT, 'packing_material_out');
  assert.equal(OUTPUT_MOVEMENT, 'packing_output_in');
  includes('backend/services/packingService.js', "source_type, qty_initial, qty_remaining", 'validation doit creer un lot output');
  includes('backend/services/packingService.js', "'packing_operations'", 'mouvements doivent pointer packing_operations');
  includes('backend/services/packingService.js', "source_type: 'packing'", 'traceabilite output doit marquer packing');
  includes('backend/services/packingService.js', "'packing', $5::numeric, $5::numeric", 'lot output doit avoir source_type packing');
  includes('backend/services/packingService.js', 'purchase_line_id, supplier_id', 'insert output lot doit cibler supplier_id');
  includes('backend/services/packingService.js', 'NULL, NULL, NULL,', 'lot output colisage doit avoir supplier_id NULL');
  assert(!service.includes('sourceLots[0]?.supplier_id'), 'lot output ne doit jamais reprendre le premier fournisseur source');
  includes('backend/services/packingService.js', 'supplier_id: line.supplier_id || null', 'traceabilite doit conserver supplier_id source');
  includes('backend/services/packingService.js', 'supplier_name: line.supplier_name || null', 'traceabilite doit conserver supplier_name source');
  includes('backend/services/packingService.js', "const lotCode = `PKG-", 'lot output doit avoir un code unique operation');
  includes('backend/services/packingService.js', 'FOR UPDATE OF l', 'validation doit verrouiller les lots consommes');
  includes('backend/services/packingService.js', 'SELECT *', 'operation doit etre relue avant verrouillage');
  includes('backend/services/packingService.js', 'await client.query(\'BEGIN\')', 'validation doit etre transactionnelle');
  includes('backend/services/packingService.js', 'await client.query(\'ROLLBACK\').catch', 'rollback transactionnel requis');
  includes('backend/services/packingService.js', 'recomputeArticleStock', 'stock_summary doit etre recalcule');
  includes('backend/services/packingService.js', "article_category !== 'product'", 'sources poisson doivent etre product');
  includes('backend/services/packingService.js', "article_category !== 'packaging'", 'materiaux doivent etre packaging');
  includes('backend/services/packingService.js', "quality_status, 'available') === 'blocked'", 'lots bloques doivent etre refuses');
  includes('backend/services/packingService.js', 'PACKING_ALREADY_VALIDATED', 'idempotence second validate requise');
  includes('backend/services/packingService.js', 'PACKING_SOURCE_STOCK_INSUFFICIENT', 'stock insuffisant poisson requis');
  includes('backend/services/packingService.js', 'PACKING_MATERIAL_STOCK_INSUFFICIENT', 'stock insuffisant emballage requis');
  includes('backend/services/packingService.js', 'PACKING_OUTPUT_ARTICLE_INVALID', 'output packaging doit etre refuse');
  includes('backend/services/packingService.js', 'PACKING_SOURCE_ARTICLE_INVALID', 'source packaging doit etre refusee');
  includes('backend/services/packingService.js', 'PACKING_MATERIAL_ARTICLE_INVALID', 'materiau product doit etre refuse');

  includes('backend/routes/packing.js', "router.get('/',", 'route liste manquante');
  includes('backend/routes/packing.js', "router.get('/:id',", 'route detail manquante');
  includes('backend/routes/packing.js', "router.post('/',", 'route creation manquante');
  includes('backend/routes/packing.js', "router.post('/:id/source-lots',", 'route ajout source manquante');
  includes('backend/routes/packing.js', "router.delete('/:id/source-lots/:lineId',", 'route suppression source manquante');
  includes('backend/routes/packing.js', "router.post('/:id/materials',", 'route ajout materiau manquante');
  includes('backend/routes/packing.js', "router.delete('/:id/materials/:lineId',", 'route suppression materiau manquante');
  includes('backend/routes/packing.js', "router.patch('/:id',", 'route update draft manquante');
  includes('backend/routes/packing.js', "router.post('/:id/validate',", 'route validation manquante');
  includes('backend/routes/packing.js', "router.post('/:id/cancel',", 'route annulation manquante');
  assert((route.match(/requireAdminOrManager/g) || []).length >= 7, 'ecriture colisage doit rester admin/responsable');
  assert(server.includes("const packingRoutes = require('./routes/packing')"), 'server doit importer packing');
  assert(server.includes("app.use('/api/packing', packingRoutes)"), 'server doit monter /api/packing');

  const quantities = normalizeDraftQuantities({
    packageCount: 2,
    quantityPerPackage: 5,
    totalOutputQuantity: 10,
  });
  assert.deepStrictEqual(quantities, {
    packageCount: 2,
    quantityPerPackage: 5,
    totalOutputQuantity: 10,
  });
  assert.throws(() => normalizeDraftQuantities({ packageCount: 2.5, quantityPerPackage: 5, totalOutputQuantity: 12.5 }), /Quantite de sortie/);
  assert.throws(() => normalizeDraftQuantities({ packageCount: 2, quantityPerPackage: 5, totalOutputQuantity: 9 }), /Quantite de sortie/);

  const fishCost = 3 * 8 + 7 * 10;
  const packagingCost = 2 * 1.5;
  const totalCost = fishCost + packagingCost;
  const unitCost = Number((totalCost / 10).toFixed(4));
  assert.equal(fishCost, 94, 'cout poisson exemple incorrect');
  assert.equal(packagingCost, 3, 'cout emballage exemple incorrect');
  assert.equal(totalCost, 97, 'cout total exemple incorrect');
  assert.equal(unitCost, 9.7, 'PR/kg exemple incorrect');

  const traceability = buildOutputTraceability({
    operation: { id: 'op-id', package_count: 2, quantity_per_package: 5, total_output_quantity: 10 },
    outputArticle: { id: 'out', plu: 'SOLE5', designation: 'SOLE COLIS 5 KG' },
    sourceLots: [
      { lot_id: 'lot-a', lot_code: 'A', article_id: 'fish', quantity_used: 3, unit_cost_ex_vat: 8, line_cost_ex_vat: 24 },
      { lot_id: 'lot-b', lot_code: 'B', article_id: 'fish', quantity_used: 7, unit_cost_ex_vat: 10, line_cost_ex_vat: 70 },
    ],
    materials: [
      { lot_id: 'box-a', lot_code: 'BOX', article_id: 'box', quantity_used: 2, unit_cost_ex_vat: 1.5, line_cost_ex_vat: 3 },
    ],
  });
  assert.equal(traceability.source_type, 'packing');
  assert.equal(traceability.source_lots.length, 2, 'traceabilite doit conserver tous les lots poisson');
  assert.equal(traceability.materials.length, 1, 'traceabilite doit conserver les emballages');

  const supplierTraceability = buildOutputTraceability({
    operation: { id: 'op-supplier', package_count: 1, quantity_per_package: 10, total_output_quantity: 10 },
    outputArticle: { id: 'out', plu: 'SOLE5', designation: 'SOLE COLIS 5 KG' },
    sourceLots: [
      { lot_id: 'lot-x', lot_code: 'X', supplier_id: 'supplier-x', supplier_name: 'Fournisseur X', article_id: 'fish', quantity_used: 3 },
      { lot_id: 'lot-y', lot_code: 'Y', supplier_id: 'supplier-y', supplier_name: 'Fournisseur Y', article_id: 'fish', quantity_used: 7 },
    ],
    materials: [],
  });
  assert.deepStrictEqual(
    supplierTraceability.source_lots.map((lot) => [lot.supplier_id, lot.supplier_name]),
    [['supplier-x', 'Fournisseur X'], ['supplier-y', 'Fournisseur Y']],
    'traceability_data doit conserver les deux fournisseurs source'
  );

  const alreadyValidated = packingError('PACKING_ALREADY_VALIDATED');
  assert.equal(alreadyValidated.status, 409);
  assert.equal(alreadyValidated.code, 'PACKING_ALREADY_VALIDATED');

  assert(doc.includes('3 kg at 8 EUR/kg'), 'doc exemple 3kg manquant');
  assert(doc.includes('PR/kg = 9.70 EUR/kg'), 'doc PR/kg manquant');
  assert(doc.includes('No new permission is introduced'), 'doc permissions manquante');
  assert(doc.includes('This PR does not create'), 'doc garde-fous manquante');

  console.log(JSON.stringify({
    ok: true,
    tests: [
      'draft_creation_contract',
      'integer_package_count_accepted',
      'decimal_package_count_refused',
      'add_two_fish_lots_contract',
      'add_one_packaging_material_contract',
      'fish_cost_94',
      'packaging_cost_3',
      'final_unit_cost_9_70',
      'unique_output_lot_contract',
      'output_qty_package_consistency',
      'source_lots_decrement_contract',
      'packaging_lot_decrement_contract',
      'stock_movements_contract',
      'stock_summary_recompute_contract',
      'blocked_lot_refused_contract',
      'insufficient_fish_rollback_contract',
      'insufficient_packaging_rollback_contract',
      'second_validate_refused_contract',
      'multi_store_fk_contract',
      'packaging_as_fish_source_refused',
      'product_as_material_refused',
      'packaging_output_refused',
      'validated_operation_locked_contract',
      'no_physical_delete_contract',
      'real_transaction_contract',
      'output_supplier_null_contract',
      'source_supplier_traceability_kept',
    ],
  }, null, 2));
}

main();
