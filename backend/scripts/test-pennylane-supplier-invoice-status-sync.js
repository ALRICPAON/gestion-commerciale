const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  normalizeAltaStatus,
  normalizeSupplierControlStatus,
} = require('../services/pennylane/supplierInvoiceImportSync');

const servicePath = path.join(__dirname, '../services/pennylane/supplierInvoiceImportSync.js');
const service = fs.readFileSync(servicePath, 'utf8');

function invoice(overrides = {}) {
  return {
    id: 'pl-si-1',
    payment_status: null,
    paid: false,
    ...overrides,
  };
}

assert.strictEqual(
  normalizeAltaStatus('conforme', invoice({ payment_status: 'to_be_paid' }), 'supplier-1'),
  'validee_a_payer'
);
assert.strictEqual(
  normalizeSupplierControlStatus('conforme', invoice({ payment_status: 'to_be_paid' }), 'validee_a_payer'),
  'valide_a_payer'
);

assert.strictEqual(
  normalizeAltaStatus('validee_a_payer', invoice({ payment_status: 'paid', paid: true }), 'supplier-1'),
  'payee'
);
assert.strictEqual(
  normalizeSupplierControlStatus('valide_a_payer', invoice({ payment_status: 'paid', paid: true }), 'payee'),
  'paye'
);

assert.strictEqual(
  normalizeAltaStatus('invoice_matched', invoice({ payment_status: 'paid_offline' }), 'supplier-1'),
  'payee'
);
assert.strictEqual(
  normalizeSupplierControlStatus('ecart', invoice({ payment_status: 'paid_offline' }), 'payee'),
  'paye'
);

assert.match(service, /payment_status = EXCLUDED\.payment_status/);
assert.match(service, /paid = EXCLUDED\.paid/);
assert.match(service, /supplier_control_status = CASE/);
assert.match(service, /EXCLUDED\.alta_business_status IN \('validee_a_payer', 'payee'\)/);
assert.match(service, /EXCLUDED\.supplier_control_status IN \('valide_a_payer', 'paye'\)/);

console.log('OK Pennylane supplier invoice status sync');
