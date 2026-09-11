const assert = require('assert');

const {
  resolveSupplierInvoiceDisplayStatus,
} = require('../services/purchaseSupplierInvoiceStatusService');

function status(purchaseStatus, links = []) {
  return resolveSupplierInvoiceDisplayStatus({ id: 'purchase-1', status: purchaseStatus }, links)
    .supplier_invoice_display_status;
}

assert.strictEqual(status('received_pending_invoice', []), 'received_pending_invoice');
assert.strictEqual(status('received_pending_invoice', [{ match_status: 'matched' }]), 'invoice_matched');
assert.strictEqual(status('invoice_matched', [{ match_status: 'difference' }]), 'invoice_difference');
assert.strictEqual(status('received_pending_invoice', [{ payment_status: 'to_be_paid' }]), 'validee_a_payer');
assert.strictEqual(status('received_pending_invoice', [{ alta_business_status: 'validee_a_payer' }]), 'validee_a_payer');
assert.strictEqual(status('received_pending_invoice', [{ paid: true }]), 'payee');
assert.strictEqual(status('received_pending_invoice', [{ payment_status: 'paid_offline' }]), 'payee');
assert.strictEqual(status('received_pending_invoice', [{ supplier_control_status: 'litige' }]), 'litige');
assert.strictEqual(
  status('received_pending_invoice', [
    { payment_status: 'to_be_paid' },
    { supplier_control_status: 'litige' },
  ]),
  'litige'
);

const enriched = resolveSupplierInvoiceDisplayStatus(
  { id: 'purchase-1', status: 'received_pending_invoice' },
  [{ supplier_control_status: 'valide_a_payer', payment_status: 'to_be_paid' }]
);
assert.deepStrictEqual(
  {
    display: enriched.supplier_invoice_display_status,
    source: enriched.supplier_invoice_status_source,
    links: enriched.supplier_invoice_link_count,
  },
  { display: 'validee_a_payer', source: 'supplier_invoice', links: 1 }
);

console.log('OK purchase supplier invoice display status');
