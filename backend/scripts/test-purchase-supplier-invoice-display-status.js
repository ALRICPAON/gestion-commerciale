const assert = require('assert');

const {
  loadSupplierInvoiceLinksForPurchases,
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

assert.deepStrictEqual(
  resolveSupplierInvoiceDisplayStatus(
    { id: 'purchase-1', status: 'received_pending_invoice' },
    [
      { logical_invoice_key: 'pennylane:invoice-a', payment_status: 'paid' },
      { logical_invoice_key: 'pennylane:invoice-b', supplier_control_status: 'litige' },
    ]
  ),
  {
    supplier_invoice_display_status: 'litige',
    supplier_invoice_display_label: 'Litige',
    supplier_invoice_status_source: 'supplier_invoice',
    supplier_invoice_link_count: 2,
  }
);

async function testMultiBlBulkLoadingAndDeduplication() {
  const ids = {
    store: '00000000-0000-4000-8000-000000000001',
    p1: '00000000-0000-4000-8000-000000000101',
    p2: '00000000-0000-4000-8000-000000000102',
    p3: '00000000-0000-4000-8000-000000000103',
  };

  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      assert.deepStrictEqual(params, [ids.store, [ids.p1, ids.p2, ids.p3]]);

      if (/FROM supplier_control_document_links scl/i.test(sql)) {
        assert.match(sql, /COALESCE\(scl\.purchase_id, pl\.purchase_id\)/);
        return {
          rows: [
            {
              purchase_id: ids.p1,
              logical_invoice_key: 'pennylane:invoice-a',
              supplier_invoice_id: 'invoice-a',
              supplier_control_status: 'valide_a_payer',
              payment_status: 'to_be_paid',
              link_match_status: 'matched',
            },
            {
              purchase_id: ids.p2,
              logical_invoice_key: 'pennylane:invoice-a',
              supplier_invoice_id: 'invoice-a',
              supplier_control_status: 'valide_a_payer',
              payment_status: 'to_be_paid',
              link_match_status: 'matched',
            },
          ],
        };
      }

      if (/FROM pennylane_supplier_invoice_match_results mr/i.test(sql)) {
        assert.match(sql, /COALESCE\(mr\.purchase_id, pl\.purchase_id\)/);
        return {
          rows: [
            {
              purchase_id: ids.p2,
              logical_invoice_key: 'pennylane:invoice-a',
              supplier_invoice_id: 'invoice-a',
              supplier_control_status: 'valide_a_payer',
              payment_status: 'to_be_paid',
              link_match_status: 'conforme',
            },
            {
              purchase_id: ids.p3,
              logical_invoice_key: 'pennylane:invoice-b',
              supplier_invoice_id: 'invoice-b',
              payment_status: 'paid',
              paid: true,
              link_match_status: 'conforme',
            },
          ],
        };
      }

      if (/FROM supplier_invoice_matches sim/i.test(sql)) {
        assert.match(sql, /COALESCE\(sim\.purchase_id, pl\.purchase_id\)/);
        return {
          rows: [
            {
              purchase_id: ids.p3,
              logical_invoice_key: 'legacy:invoice-legacy',
              supplier_invoice_id: 'invoice-legacy',
              alta_business_status: 'invoice_difference',
              link_match_status: 'difference',
            },
          ],
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const links = await loadSupplierInvoiceLinksForPurchases(db, {
    storeId: ids.store,
    purchaseIds: [ids.p1, ids.p2, ids.p3],
  });

  assert.strictEqual(calls.length, 3, 'bulk loader must keep one query per source, not one per purchase');
  assert.strictEqual(links.get(ids.p1).length, 1);
  assert.strictEqual(links.get(ids.p2).length, 1, 'same invoice from control + automatic links is deduplicated');
  assert.strictEqual(links.get(ids.p3).length, 2);

  assert.strictEqual(status('received_pending_invoice', links.get(ids.p1)), 'validee_a_payer');
  assert.strictEqual(status('received_pending_invoice', links.get(ids.p2)), 'validee_a_payer');
  assert.strictEqual(status('received_pending_invoice', links.get(ids.p3)), 'payee');
}

testMultiBlBulkLoadingAndDeduplication()
  .then(() => {
    console.log('OK purchase supplier invoice display status');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
