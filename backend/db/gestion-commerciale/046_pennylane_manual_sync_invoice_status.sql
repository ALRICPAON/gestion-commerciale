BEGIN;

ALTER TABLE sales_documents
DROP CONSTRAINT IF EXISTS sales_documents_pennylane_status_check;

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS pennylane_invoice_number text,
  ADD COLUMN IF NOT EXISTS pennylane_payment_status text,
  ADD COLUMN IF NOT EXISTS pennylane_paid_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS pennylane_remaining_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS pennylane_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS pennylane_status text,
  ADD COLUMN IF NOT EXISTS pennylane_last_status_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_documents_pennylane_payment_status
  ON sales_documents(store_id, pennylane_payment_status, document_date DESC)
  WHERE document_type = 'INVOICE';

CREATE INDEX IF NOT EXISTS idx_sales_documents_pennylane_sync_status
  ON sales_documents(store_id, pennylane_sync_status, document_date DESC)
  WHERE document_type = 'INVOICE';

CREATE INDEX IF NOT EXISTS idx_sales_documents_pennylane_remaining
  ON sales_documents(store_id, pennylane_remaining_amount, document_date DESC)
  WHERE document_type = 'INVOICE'
    AND pennylane_remaining_amount IS NOT NULL;

COMMIT;
