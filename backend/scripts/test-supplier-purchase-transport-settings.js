const assert = require('assert');
const suppliersRoute = require('../routes/suppliers');

const { mapSupplierPayload, getSupplierDetail } = suppliersRoute._private;

const atOurCharge = mapSupplierPayload({
  name: 'Copromer',
  purchase_transport_mode: 'carrier_paid_by_us',
  purchase_transport_chain_id: 'chain-a',
  transport_admin_fee_ht: '5.92',
});
assert.strictEqual(atOurCharge.purchase_transport_mode, 'carrier_paid_by_us');
assert.strictEqual(atOurCharge.purchase_transport_chain_id, 'chain-a');

const franco = mapSupplierPayload({
  name: 'Copromer',
  purchase_transport_mode: 'franco',
  purchase_transport_chain_id: 'chain-a',
});
assert.strictEqual(franco.purchase_transport_mode, 'franco');
assert.strictEqual(franco.purchase_transport_chain_id, null);

const manual = mapSupplierPayload({
  name: 'Copromer',
  purchase_transport_mode: 'manual',
  purchase_transport_chain_id: 'chain-a',
});
assert.strictEqual(manual.purchase_transport_mode, 'manual');
assert.strictEqual(manual.purchase_transport_chain_id, null);

const changedCircuit = mapSupplierPayload({
  name: 'Copromer',
  purchase_transport_mode: 'carrier_paid_by_us',
  purchase_transport_chain_id: 'chain-b',
});
assert.strictEqual(changedCircuit.purchase_transport_chain_id, 'chain-b');

let lastQuery = null;
const db = {
  async query(sql, params) {
    lastQuery = { sql, params };
    return {
      rows: [{
        id: params[0],
        name: 'Copromer',
        purchase_transport_mode: 'carrier_paid_by_us',
        purchase_transport_chain_id: 'chain-b',
        transport_admin_fee_ht: 5.92,
        transport_notes: 'ok',
      }],
    };
  },
};

(async () => {
  const supplier = await getSupplierDetail(db, 'store-1', 'supplier-1');
  assert.strictEqual(supplier.purchase_transport_mode, 'carrier_paid_by_us');
  assert.strictEqual(supplier.purchase_transport_chain_id, 'chain-b');
  assert.deepStrictEqual(lastQuery.params, ['supplier-1', 'store-1']);
  assert(lastQuery.sql.includes('supplier_transport_settings'), 'supplier detail must reload transport settings');
  console.log('supplier purchase transport settings tests ok');
})();
