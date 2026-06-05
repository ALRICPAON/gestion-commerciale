BEGIN;

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS source_invoice_id uuid REFERENCES sales_documents(id);

ALTER TABLE sales_lines
  ADD COLUMN IF NOT EXISTS source_invoice_line_id uuid REFERENCES sales_lines(id);

CREATE INDEX IF NOT EXISTS idx_sales_documents_credit_note_source_invoice
  ON sales_documents(store_id, source_invoice_id, document_date DESC)
  WHERE document_type = 'CREDIT_NOTE';

CREATE INDEX IF NOT EXISTS idx_sales_lines_credit_note_source_invoice_line
  ON sales_lines(store_id, source_invoice_line_id)
  WHERE source_invoice_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_documents_credit_note_reference_unique
  ON sales_documents(store_id, reference_number)
  WHERE document_type = 'CREDIT_NOTE'
    AND reference_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_documents_credit_note_pennylane_status
  ON sales_documents(store_id, pennylane_status, document_date DESC)
  WHERE document_type = 'CREDIT_NOTE';

COMMIT;
