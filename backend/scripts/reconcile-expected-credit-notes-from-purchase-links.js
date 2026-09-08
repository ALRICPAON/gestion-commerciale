const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const { recalculateSourceInvoiceAfterCreditNote } = require('../services/supplierExpectedCreditNoteService');

const USAGE = 'Usage: node backend/scripts/reconcile-expected-credit-notes-from-purchase-links.js --store-id=<uuid> [--apply]';

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const storeId = argValue('store-id') || process.env.ALTA_STORE_ID || process.env.STORE_ID;
  const apply = hasFlag('apply') || process.env.APPLY === '1' || process.env.APPLY === 'true';
  if (!storeId) throw new Error(`${USAGE}\n--store-id ou ALTA_STORE_ID requis`);

  const db = getDefaultPool();
  const candidates = await db.query(
    `
    WITH linked_documents AS (
      SELECT
        ecn.id AS expected_credit_note_id,
        ecn.source_purchase_id,
        ecn.source_pennylane_supplier_invoice_id AS existing_document_id,
        ARRAY_AGG(DISTINCT psi.id) FILTER (WHERE psi.id IS NOT NULL) AS document_ids,
        COUNT(DISTINCT psi.id)::int AS document_count
      FROM supplier_expected_credit_notes ecn
      LEFT JOIN supplier_control_document_links scl
        ON scl.store_id = ecn.store_id
       AND scl.purchase_id = ecn.source_purchase_id
       AND scl.match_status <> 'removed'
      LEFT JOIN pennylane_supplier_invoices psi
        ON psi.id = scl.pennylane_supplier_invoice_id
       AND psi.store_id = scl.store_id
       AND psi.document_type = 'invoice'
       AND psi.pennylane_deleted_at IS NULL
      WHERE ecn.store_id = $1
        AND ecn.source_purchase_id IS NOT NULL
        AND ecn.status NOT IN ('cancelled', 'disputed')
      GROUP BY ecn.id, ecn.source_purchase_id, ecn.source_pennylane_supplier_invoice_id
    )
    SELECT *
    FROM linked_documents
    WHERE existing_document_id IS NOT NULL OR document_count > 0
    ORDER BY expected_credit_note_id
    `,
    [storeId]
  );

  const summary = {
    dry_run: !apply,
    store_id: storeId,
    linked: [],
    ambiguous: [],
  };

  for (const row of candidates.rows) {
    const documentIds = row.existing_document_id ? [row.existing_document_id] : (row.document_ids || []);
    if (!row.existing_document_id && Number(row.document_count) !== 1) {
      summary.ambiguous.push({
        expected_credit_note_id: row.expected_credit_note_id,
        source_purchase_id: row.source_purchase_id,
        document_ids: documentIds,
      });
      continue;
    }

    const documentId = documentIds[0];
    summary.linked.push({
      expected_credit_note_id: row.expected_credit_note_id,
      source_purchase_id: row.source_purchase_id,
      source_pennylane_supplier_invoice_id: documentId,
    });

    if (!apply) continue;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
        UPDATE supplier_expected_credit_notes
        SET source_pennylane_supplier_invoice_id = $1,
            updated_at = now()
        WHERE id = $2
          AND store_id = $3
          AND source_pennylane_supplier_invoice_id IS NULL
        `,
        [documentId, row.expected_credit_note_id, storeId]
      );
      await recalculateSourceInvoiceAfterCreditNote(client, { storeId, documentId });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
