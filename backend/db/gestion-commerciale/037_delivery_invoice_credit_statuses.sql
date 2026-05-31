BEGIN;

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS source_delivery_note_id uuid REFERENCES sales_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_invoice_id uuid REFERENCES sales_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoiced_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_note_reason text,
  ADD COLUMN IF NOT EXISTS returns_to_stock boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sales_documents_source_delivery_note
  ON sales_documents(store_id, source_delivery_note_id);

CREATE INDEX IF NOT EXISTS idx_sales_documents_source_invoice
  ON sales_documents(store_id, source_invoice_id);

ALTER TABLE sales_lines
  DROP CONSTRAINT IF EXISTS sales_lines_line_status_check;

ALTER TABLE sales_lines
  ADD CONSTRAINT sales_lines_line_status_check
  CHECK (
    line_status IN (
      'pending',
      'draft',
      'ordered',
      'validated',
      'delivered',
      'invoiced',
      'cancelled',
      'credited'
    )
  );

ALTER TABLE sales_documents
  DROP CONSTRAINT IF EXISTS sales_documents_status_check;

ALTER TABLE sales_documents
  ADD CONSTRAINT sales_documents_status_check
  CHECK (
    status IN (
      'draft',
      'pending',
      'validated',
      'delivered',
      'invoiced',
      'cancelled',
      'credited'
    )
  );

ALTER TABLE sales_documents
  DROP CONSTRAINT IF EXISTS sales_documents_document_type_check;

ALTER TABLE sales_documents
  ADD CONSTRAINT sales_documents_document_type_check
  CHECK (
    document_type IN (
      'ORDER',
      'DELIVERY_NOTE',
      'INVOICE',
      'CREDIT_NOTE',
      'manual_sale',
      'inventory_sale',
      'transfer_out',
      'waste'
    )
  );

COMMIT;
