const assert = require('assert');

const {
  normalizePackagingItemInput,
  signedQuantityForStockMovement,
  computeProfileConsumption,
  computePackagingCosts,
  assertSufficientStock,
  assertOperationCanBeValidated,
  signedQuantityForReturnableMovement,
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

  assert.doesNotThrow(() => {
    assertSufficientStock([{ packaging_item_id: 'box', quantity: 20, category: 'consumable' }], new Map([['box', 80]]));
  });
  expectThrowsStatus(() => {
    assertSufficientStock([{ packaging_item_id: 'box', quantity: 81, category: 'consumable' }], new Map([['box', 80]]));
  }, 409);

  assert.doesNotThrow(() => assertOperationCanBeValidated({ status: 'draft' }));
  expectThrowsStatus(() => assertOperationCanBeValidated({ status: 'validated' }), 409);

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
