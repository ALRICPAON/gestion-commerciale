const { processPennylaneSupplierInvoiceImportSync } = require('../pennylane');
const { processPennylaneCustomerInvoiceSyncQueue } = require('../pennylane/customerInvoiceSync');

const PENNYLANE_CASHFLOW_CAPABILITIES = {
  endpoints_used: [
    'GET /customer_invoices?limit=1&filter=...',
    'GET /customer_invoices/:id',
    'POST /customer_invoices',
    'GET /changelogs/supplier_invoices',
    'GET /supplier_invoices/:id',
    'PUT /supplier_invoices/:id/payment_status',
  ],
  data_available: [
    'Factures clients ALTA synchronisees avec identifiants Pennylane, statut de paiement, montant paye, montant restant et date de paiement reelle quand Pennylane la retourne.',
    'Factures fournisseurs Pennylane synchronisees localement avec fournisseur, echeance, statut, paid, montant restant et payload brut.',
    'Identifiants tiers Pennylane pour clients et fournisseurs quand les mappings existent.',
  ],
  unavailable_data: [
    'Comptes bancaires Pennylane non utilises par le projet a ce stade.',
    'Solde bancaire direct non valide dans le client Pennylane existant.',
    'Transactions bancaires et rapprochements bancaires non valides dans le depot existant.',
  ],
  required_scopes: [
    'Lecture factures clients',
    'Lecture/creation factures clients deja utilisee par le projet',
    'Lecture factures fournisseurs',
    'Lecture changelogs factures fournisseurs',
  ],
  limitations: [
    'Aucun endpoint bancaire n est appele tant qu il n est pas documente et valide dans le projet.',
    'La tresorerie de depart provient du dernier snapshot bancaire ALTA ou du parametre manuel.',
    'La synchronisation bancaire est preparee en base mais non activee dans cette premiere version.',
  ],
};

async function syncCashflowData(db, { storeId, userId }) {
  const result = {
    supplier_invoices: null,
    customer_invoice_queue: null,
    bank: { skipped: true, reason: 'BANK_ENDPOINT_NOT_VALIDATED' },
  };

  try {
    result.supplier_invoices = await processPennylaneSupplierInvoiceImportSync(db, {
      storeId,
      workerId: `manual-cashflow-supplier-sync-${userId || 'system'}`,
    });
  } catch (err) {
    result.supplier_invoices = { failed: true, error: err.message };
  }

  try {
    result.customer_invoice_queue = await processPennylaneCustomerInvoiceSyncQueue(db, {
      workerId: `manual-cashflow-customer-sync-${userId || 'system'}`,
    });
  } catch (err) {
    result.customer_invoice_queue = { failed: true, error: err.message };
  }

  await db.query(
    `
    INSERT INTO cashflow_sync_logs(store_id, sync_type, status, read_count, created_count, updated_count, skipped_count, error_message, details, completed_at)
    VALUES($1, 'manual', $2, 0, 0, 0, 0, $3, $4::jsonb, now())
    `,
    [
      storeId,
      result.supplier_invoices?.failed || result.customer_invoice_queue?.failed ? 'partial' : 'success',
      [result.supplier_invoices?.error, result.customer_invoice_queue?.error].filter(Boolean).join(' ; ') || null,
      JSON.stringify(result),
    ]
  ).catch(() => {});

  return result;
}

module.exports = {
  PENNYLANE_CASHFLOW_CAPABILITIES,
  syncCashflowData,
};
