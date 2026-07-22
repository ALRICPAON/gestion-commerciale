const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  normalizePackagingItemInput,
  signedQuantityForStockMovement,
  computeProfileConsumption,
  computePackagingCosts,
  assertSufficientStock,
  assertOperationCanBeValidated,
  signedQuantityForReturnableMovement,
  reverseStockMovementType,
  assertCancellationReason,
  assertStockMovementCanBeCancelled,
  assertStockMovementCanBeDeleted,
  assertNoDuplicatePackagingComponents,
  estimateProfileCostPerPackage,
  summarizeReturnableMovements,
  filterRowsByStore,
} = require('../services/packaging/packagingService');

function expectThrowsStatus(fn, status) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert(thrown, 'Expected an error');
  assert.strictEqual(thrown.status, status);
}

function run() {
  const packagingJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/packaging.js'), 'utf8');
  const packagingHtml = fs.readFileSync(path.join(__dirname, '../../frontend/packaging.html'), 'utf8');
  const packagingService = fs.readFileSync(path.join(__dirname, '../services/packaging/packagingService.js'), 'utf8');
  const packagingRoutes = fs.readFileSync(path.join(__dirname, '../routes/packaging.js'), 'utf8');
  const stockService = fs.readFileSync(path.join(__dirname, '../services/stockService.js'), 'utf8');
  const costImpactMigration = fs.readFileSync(path.join(__dirname, '../db/gestion-commerciale/062_packaging_cost_impacts.sql'), 'utf8');
  const articleAlignmentMigration = fs.readFileSync(path.join(__dirname, '../db/gestion-commerciale/063_packaging_articles_alignment.sql'), 'utf8');
  const stockComponentsMigration = fs.readFileSync(path.join(__dirname, '../db/gestion-commerciale/064_stock_cost_components.sql'), 'utf8');

  assert(packagingHtml.includes('PLU ou designation'));
  assert(packagingHtml.includes('operation-article-f9-btn'));
  assert(packagingHtml.includes('packaging.js?v=3'));
  assert(packagingHtml.includes('packaging.css?v=3'));
  assert(packagingHtml.includes('Nouveau modele de conditionnement'));
  assert(packagingHtml.includes('Realiser un conditionnement'));
  assert(packagingHtml.includes('Quantite de produit concernee en kg'));
  assert(packagingHtml.includes('movement-cancel-modal'));
  assert(!packagingHtml.includes('>Profil<'));
  assert(!packagingHtml.includes('>profil<'));
  assert(!packagingHtml.includes('placeholder="ID article"'));
  assert(packagingJs.includes("item.current_unit_cost_ex_vat"));
  assert(packagingJs.includes("item.deposit_unit_value"));
  assert(packagingJs.includes('/api/articles/search'));
  assert(packagingJs.includes('operationArticleId.value'));
  assert(packagingJs.includes('isUuid(articleId)'));
  assert(packagingJs.includes('loadProfilesForArticle(els.operationArticleId.value'));
  assert(!packagingJs.includes('loadProfilesForArticle(els.operationArticle.value'));
  assert(packagingJs.includes('canOpenArticlePickerFromKeydown'));
  assert(packagingJs.includes('openOperationArticlePicker'));
  assert(packagingJs.includes("retryButton('stock-movements')"));
  assert(packagingJs.includes('Annuler / corriger'));
  assert(packagingJs.includes('A corriger depuis l operation de conditionnement'));
  assert(packagingJs.includes('movementCancelReason'));
  assert(packagingJs.includes('Aucun article trouve pour ce PLU'));
  assert(packagingJs.includes('/api/articles/search-in-stock'));
  assert(packagingJs.includes('Stock produit <strong>Inchange</strong>'));
  assert(packagingJs.includes('operation-lot'));
  assert(packagingJs.includes('loadLotsForOperationArticle'));
  assert(packagingJs.includes('/api/stock/lots?article_id='));
  assert(packagingService.includes('packaging_cost_impacts'));
  assert(packagingService.includes("a.article_type IN ('PACKAGING_CONSUMABLE', 'PACKAGING_RETURNABLE')"));
  assert(packagingService.includes('consumePackagingArticleStock'));
  assert(packagingService.includes("'packaging_consumption'"));
  assert(packagingService.includes("'packaging_consumption_reversal'"));
  assert(packagingService.includes('INSERT INTO stock_cost_components'));
  assert(packagingService.includes('UPDATE stock_cost_components'));
  assert(packagingService.includes('UPDATE lots SET qty_remaining = qty_remaining - $1'));
  assert(packagingService.includes('UPDATE lots SET qty_remaining = qty_remaining + $1'));
  assert(packagingService.includes('INSERT INTO stock_movements'));
  assert(packagingService.includes('await assertProductLotTraceability(client, storeId, operation.article_id, operation.lot_id)'));
  assert(!packagingService.includes('UPDATE packaging_items'));
  assert(packagingRoutes.includes("/operations/:id/cancel"));
  assert(packagingJs.includes('data-cancel-operation'));
  assert(stockService.includes('FROM stock_cost_components'));
  assert(costImpactMigration.includes('CREATE TABLE IF NOT EXISTS packaging_cost_impacts'));
  assert(articleAlignmentMigration.includes("PACKAGING_CONSUMABLE"));
  assert(articleAlignmentMigration.includes("packaging_article_id"));
  assert(stockComponentsMigration.includes('CREATE TABLE IF NOT EXISTS stock_cost_components'));

  const item = normalizePackagingItemInput({
    code: 'CAISSE30',
    designation: 'Caisse polystyrene 30 L',
    category: 'consumable',
    current_unit_cost_ex_vat: '1.20',
    alert_threshold: 10,
  });
  assert.strictEqual(item.code, 'CAISSE30');
  assert.strictEqual(item.category, 'consumable');

  assert.strictEqual(signedQuantityForStockMovement('purchase_in', 100), 100);
  assert.strictEqual(signedQuantityForStockMovement('conditioning_out', 20), -20);
  assert.strictEqual(signedQuantityForStockMovement('loss', 3), -3);
  assert.strictEqual(signedQuantityForStockMovement('manual_correction', -2), -2);
  assert.strictEqual(reverseStockMovementType('purchase_in'), 'manual_correction');
  assert.strictEqual(estimateProfileCostPerPackage([
    { quantity: 1, current_unit_cost_ex_vat: 1 },
    { quantity: 0.5, current_unit_cost_ex_vat: 0.2 },
    { quantity: 1, current_unit_cost_ex_vat: 0.1 },
  ]), 1.2);
  assert.doesNotThrow(() => assertNoDuplicatePackagingComponents([
    { packaging_item_id: 'box' },
    { packaging_item_id: 'ice' },
  ]));
  expectThrowsStatus(() => assertNoDuplicatePackagingComponents([
    { packaging_item_id: 'box' },
    { packaging_item_id: 'box' },
  ]), 400);

  const components = [
    {
      packaging_item_id: 'box',
      designation: 'Caisse',
      category: 'consumable',
      quantity: 1,
      consumption_rule: 'per_package',
      current_unit_cost_ex_vat: 1.2,
    },
    {
      packaging_item_id: 'label',
      designation: 'Etiquette',
      category: 'consumable',
      quantity: 0.02,
      consumption_rule: 'per_kg',
      current_unit_cost_ex_vat: 0.1,
    },
    {
      packaging_item_id: 'seal',
      designation: 'Scelle',
      category: 'consumable',
      quantity: 2,
      consumption_rule: 'fixed_per_operation',
      current_unit_cost_ex_vat: 0.05,
    },
  ];

  const consumed = computeProfileConsumption({
    components,
    productQuantityKg: 100,
    packageCount: 20,
  });
  assert.strictEqual(consumed[0].quantity, 20);
  assert.strictEqual(consumed[1].quantity, 2);
  assert.strictEqual(consumed[2].quantity, 2);

  const costs = computePackagingCosts({
    lines: consumed,
    productQuantityKg: 100,
    packageCount: 20,
    productCostBeforePackaging: 7,
  });
  assert.strictEqual(costs.packaging_cost_total_ex_vat, 24.3);
  assert.strictEqual(costs.packaging_cost_per_package, 1.215);
  assert.strictEqual(costs.packaging_cost_per_kg, 0.243);
  assert.strictEqual(costs.cost_after_packaging_per_kg, 7.243);

  const stockAfterOperation =
    100 + signedQuantityForStockMovement('conditioning_out', consumed[0].quantity);
  assert.strictEqual(stockAfterOperation, 80);
  const stockAfterCancellation =
    stockAfterOperation + -signedQuantityForStockMovement('conditioning_out', consumed[0].quantity);
  assert.strictEqual(stockAfterCancellation, 100);

  assert.doesNotThrow(() => {
    assertSufficientStock([{ packaging_item_id: 'box', quantity: 20, category: 'consumable' }], new Map([['box', 80]]));
  });
  expectThrowsStatus(() => {
    assertSufficientStock([{ packaging_item_id: 'box', quantity: 81, category: 'consumable' }], new Map([['box', 80]]));
  }, 409);

  assert.doesNotThrow(() => assertOperationCanBeValidated({ status: 'draft' }));
  expectThrowsStatus(() => assertOperationCanBeValidated({ status: 'validated' }), 409);
  assert.strictEqual(assertCancellationReason('Erreur de saisie'), 'Erreur de saisie');
  expectThrowsStatus(() => assertCancellationReason(''), 400);
  assert.doesNotThrow(() => assertStockMovementCanBeCancelled({
    id: 'movement-1',
    source_table: null,
    cancelled_at: null,
    reversal_movement_id: null,
  }));
  expectThrowsStatus(() => assertStockMovementCanBeCancelled({
    id: 'movement-2',
    source_table: null,
    cancelled_at: new Date(),
    reversal_movement_id: 'movement-3',
  }), 409);
  expectThrowsStatus(() => assertStockMovementCanBeCancelled({
    id: 'movement-4',
    source_table: 'packaging_operations',
    cancelled_at: null,
    reversal_movement_id: null,
  }), 409);
  expectThrowsStatus(() => assertStockMovementCanBeDeleted({
    id: 'movement-5',
    source_table: 'packaging_operations',
  }), 409);
  expectThrowsStatus(() => assertStockMovementCanBeDeleted({
    id: 'movement-6',
    source_table: null,
  }), 409);

  assert.strictEqual(signedQuantityForReturnableMovement('deposit_receipt', 10), 10);
  assert.strictEqual(signedQuantityForReturnableMovement('return', 6), -6);
  assert.strictEqual(signedQuantityForReturnableMovement('supplier_credit_note', 1), -1);

  const balances = summarizeReturnableMovements([
    {
      packaging_item_id: 'bac',
      supplier_id: 'supplier-1',
      designation: 'Bac consigne',
      movement_type: 'deposit_receipt',
      quantity: 10,
      deposit_unit_value: 8,
    },
    {
      packaging_item_id: 'bac',
      supplier_id: 'supplier-1',
      designation: 'Bac consigne',
      movement_type: 'return',
      quantity: 6,
      deposit_unit_value: 8,
    },
  ]);
  assert.strictEqual(balances.length, 1);
  assert.strictEqual(balances[0].balance_quantity, 4);
  assert.strictEqual(balances[0].deposit_balance_value, 32);

  const costsWithReturnable = computePackagingCosts({
    lines: [
      { packaging_item_id: 'box', quantity: 20, category: 'consumable', unit_cost_ex_vat: 1.2 },
      { packaging_item_id: 'bac', quantity: 4, category: 'returnable', unit_cost_ex_vat: 8 },
      { packaging_item_id: 'fee', quantity: 1, category: 'consumable', unit_cost_ex_vat: 2, is_deposit_line: true },
    ],
    productQuantityKg: 100,
    packageCount: 20,
  });
  assert.strictEqual(costsWithReturnable.packaging_cost_total_ex_vat, 24);

  const scopedRows = filterRowsByStore(
    [
      { id: 1, store_id: 'store-a' },
      { id: 2, store_id: 'store-b' },
    ],
    'store-a'
  );
  assert.deepStrictEqual(scopedRows, [{ id: 1, store_id: 'store-a' }]);

  console.log('Packaging V1 tests passed');
}

run();
