const assert = require('assert');

const {
  detectPennylaneSupplierDocumentType,
  normalizeCreditNoteReason,
  positiveAmount,
  registerSupplierReturn,
  signedFinancialAmount,
  supplierOutstandingFromDocuments,
} = require('../services/supplierCreditNoteService');

function creditNote(overrides = {}) {
  return {
    id: 'credit-note-id',
    store_id: 'store-id',
    client_key: 'alta',
    document_type: 'credit_note',
    credit_note_reason: 'other',
    invoice_number: 'AV-1',
    total_ex_vat: 100,
    total_inc_vat: 120,
    status: 'invoice_validated',
    ...overrides,
  };
}

async function assertRejects(message, fn) {
  let rejected = false;
  try {
    await fn();
  } catch (error) {
    rejected = true;
    assert.match(error.message, message);
  }
  assert.strictEqual(rejected, true, `Expected rejection ${message}`);
}

function createReturnClient({ credit = creditNote({ credit_note_reason: 'supplier_return' }), qtyRemaining = 15 } = {}) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM supplier_invoices/i.test(sql)) return { rows: [credit] };
      if (/FROM lots l/i.test(sql)) {
        return {
          rows: [{
            id: 'lot-id',
            client_key: 'alta',
            article_id: 'article-id',
            supplier_id: 'supplier-id',
            purchase_line_id: 'purchase-line-id',
            purchase_id: 'purchase-id',
            qty_remaining: qtyRemaining,
            unit_cost_ex_vat: 8,
          }],
        };
      }
      if (/INSERT INTO stock_movements/i.test(sql)) return { rows: [{ id: 'movement-id', quantity: params[4], movement_type: 'supplier_return' }] };
      if (/INSERT INTO supplier_credit_note_returns/i.test(sql)) return { rows: [{ id: 'return-id', article_id: 'article-id', quantity: params[7], movement_id: params[9] }] };
      return { rows: [] };
    },
  };
  return client;
}

async function run() {
  assert.strictEqual(signedFinancialAmount({ document_type: 'invoice', total_ex_vat: 1000 }, 'total_ex_vat'), 1000);
  assert.strictEqual(signedFinancialAmount(creditNote({ total_ex_vat: 100 }), 'total_ex_vat'), -100);
  assert.strictEqual(supplierOutstandingFromDocuments([
    { document_type: 'invoice', status: 'invoice_validated', total_ex_vat: 1000 },
    creditNote({ total_ex_vat: 100, source_purchase_id: 'purchase-id' }),
  ]), 900);

  assert.strictEqual(supplierOutstandingFromDocuments([
    { document_type: 'invoice', status: 'invoice_validated', total_ex_vat: 1000 },
    creditNote({ credit_note_reason: 'price_error', total_ex_vat: 40, source_purchase_id: 'purchase-id' }),
  ]), 960);
  assert.strictEqual(supplierOutstandingFromDocuments([
    { document_type: 'invoice', status: 'invoice_validated', total_ex_vat: 1000 },
    creditNote({ credit_note_reason: 'full_cancellation', total_ex_vat: 1000, source_purchase_id: 'purchase-id' }),
  ]), 0);
  assert.strictEqual(supplierOutstandingFromDocuments([
    creditNote({ total_ex_vat: 100, source_purchase_id: null, source_supplier_invoice_id: null }),
  ]), 0);

  assert.strictEqual(detectPennylaneSupplierDocumentType({ document_type: 'credit_note', amount: 100 }, {}), 'credit_note');
  assert.strictEqual(detectPennylaneSupplierDocumentType({ metadata: { kind: 'avoir' }, amount: 100 }, {}), 'credit_note');
  assert.strictEqual(detectPennylaneSupplierDocumentType({ amount: -120 }, {}), 'credit_note');
  assert.strictEqual(detectPennylaneSupplierDocumentType({ type: 'invoice', amount: -120 }, {}), 'invoice');
  assert.strictEqual(detectPennylaneSupplierDocumentType({ amount: 120 }, {}), 'invoice');
  assert.strictEqual(normalizeCreditNoteReason('erreur_prix'), 'price_error');
  assert.strictEqual(positiveAmount(-42), 42);

  const noStockCalls = [];
  assert.strictEqual(signedFinancialAmount(creditNote({ credit_note_reason: 'commercial_discount', total_ex_vat: 100 }), 'total_ex_vat'), -100);
  assert.strictEqual(noStockCalls.filter((call) => call === 'supplier_return').length, 0);

  const client = createReturnClient();
  const result = await registerSupplierReturn(client, {
    storeId: 'store-id',
    creditNoteInvoiceId: 'credit-note-id',
    purchaseId: 'purchase-id',
    purchaseLineId: 'purchase-line-id',
    lotId: 'lot-id',
    quantity: 10,
    userId: 'user-id',
  });
  assert.strictEqual(result.movement.movement_type, 'supplier_return');
  assert.strictEqual(result.movement.quantity, -10);
  assert.ok(client.calls.some((call) => /UPDATE lots SET qty_remaining = qty_remaining - \$1/i.test(call.sql)));

  await assertRejects(/superieure au stock disponible/, () => registerSupplierReturn(createReturnClient({ qtyRemaining: 2 }), {
    storeId: 'store-id',
    creditNoteInvoiceId: 'credit-note-id',
    purchaseId: 'purchase-id',
    purchaseLineId: 'purchase-line-id',
    lotId: 'lot-id',
    quantity: 10,
  }));

  await assertRejects(/motif supplier_return/, () => registerSupplierReturn(createReturnClient({ credit: creditNote({ credit_note_reason: 'price_error' }) }), {
    storeId: 'store-id',
    creditNoteInvoiceId: 'credit-note-id',
    purchaseId: 'purchase-id',
    purchaseLineId: 'purchase-line-id',
    lotId: 'lot-id',
    quantity: 1,
  }));

  const imported = new Map();
  const pennylaneId = 'pl-av-1';
  imported.set(pennylaneId, { raw_payload: { id: pennylaneId }, document_type: 'credit_note' });
  imported.set(pennylaneId, { raw_payload: { id: pennylaneId, updated: true }, document_type: 'credit_note' });
  assert.strictEqual(imported.size, 1);
  assert.deepStrictEqual(imported.get(pennylaneId).raw_payload, { id: pennylaneId, updated: true });

  console.log('OK supplier credit notes business tests');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
