const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  ACCOUNTING_LOCKED_PURCHASE_STATUSES,
  isAccountingLockedPurchaseStatus,
  isEditablePurchaseStatus,
  isStockBackedPurchaseStatus,
} = require('../services/purchaseReceiptStockSync');

const editableStatuses = ['ordered', 'received', 'received_pending_invoice'];
for (const status of editableStatuses) {
  assert.strictEqual(isEditablePurchaseStatus(status), true, `${status} doit rester modifiable`);
}

assert.strictEqual(isStockBackedPurchaseStatus('received'), true, 'received doit reconstruire le stock');
assert.strictEqual(isStockBackedPurchaseStatus('received_pending_invoice'), true, 'received_pending_invoice doit reconstruire le stock');

const lockedStatuses = [
  'invoice_matched',
  'invoice_difference',
  'invoice_validated',
  'cost_adjusted',
  'sent_pennylane',
  'closed',
];
assert.deepStrictEqual([...ACCOUNTING_LOCKED_PURCHASE_STATUSES], lockedStatuses);

for (const status of lockedStatuses) {
  assert.strictEqual(isAccountingLockedPurchaseStatus(status), true, `${status} doit etre verrouille comptablement`);
  assert.strictEqual(isEditablePurchaseStatus(status), false, `${status} ne doit pas etre modifiable`);
}
assert.strictEqual(isEditablePurchaseStatus('cancelled'), false, 'cancelled ne doit pas etre modifiable');

const purchasesRoute = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'purchases.js'), 'utf8');
assert(purchasesRoute.includes('purchaseReceiptStockSync.isAccountingLockedPurchaseStatus'), 'La route achat doit utiliser le verrou comptable canonique');
assert(purchasesRoute.includes('purchaseHasInvoiceLinks'), 'La route achat doit bloquer les BL lies a une facture');
assert(purchasesRoute.includes('has_supplier_invoice_link'), 'Le detail achat doit exposer les liens facture Alta');
assert(purchasesRoute.includes('has_pennylane_supplier_invoice_link'), 'Le detail achat doit exposer les liens facture Pennylane');
assert(purchasesRoute.includes('rebuildStockForPurchaseIfNeeded(client, purchase'), 'Les corrections de lignes recues doivent reconstruire le stock');

const frontend = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'js', 'purchase-detail.js'), 'utf8');
assert(frontend.includes('const SYSTEM_STATUSES = ["received", "received_pending_invoice", "closed"]'), 'Le front doit connaitre received_pending_invoice');
assert(frontend.includes('purchase?.has_supplier_invoice_link || purchase?.has_pennylane_supplier_invoice_link'), 'Le front doit verrouiller les BL deja lies a une facture');
assert(frontend.includes('function isPurchaseEditable()'), 'Le front doit centraliser la decision editable');

console.log('OK purchase edit lock statuses PR2b');
