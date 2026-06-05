BEGIN;

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS pennylane_status text NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS pennylane_invoice_id text,
  ADD COLUMN IF NOT EXISTS pennylane_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS pennylane_error text;

ALTER TABLE sales_documents
  DROP CONSTRAINT IF EXISTS sales_documents_pennylane_status_check;

ALTER TABLE sales_documents
  ADD CONSTRAINT sales_documents_pennylane_status_check
  CHECK (
    pennylane_status IN (
      'not_sent',
      'pending',
      'sent',
      'error'
    )
  );

CREATE INDEX IF NOT EXISTS idx_sales_documents_invoice_pennylane_status
  ON sales_documents(store_id, pennylane_status, document_date DESC)
  WHERE document_type = 'INVOICE';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_documents_invoice_reference_unique
  ON sales_documents(store_id, reference_number)
  WHERE document_type = 'INVOICE'
    AND reference_number IS NOT NULL;

COMMIT;
