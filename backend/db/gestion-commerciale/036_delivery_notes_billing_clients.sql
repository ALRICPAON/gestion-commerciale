BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billed_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS store_identifier text;

UPDATE clients
SET billed_client_id = id
WHERE billed_client_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_store_billed_client
  ON clients(store_id, billed_client_id);

CREATE INDEX IF NOT EXISTS idx_clients_store_identifier
  ON clients(store_id, store_identifier);

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS source_order_id uuid REFERENCES sales_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billed_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivered_client_name_snapshot text,
  ADD COLUMN IF NOT EXISTS delivered_client_code_snapshot text,
  ADD COLUMN IF NOT EXISTS delivered_client_store_identifier text,
  ADD COLUMN IF NOT EXISTS billed_client_name_snapshot text,
  ADD COLUMN IF NOT EXISTS billed_client_code_snapshot text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS printed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_documents_source_order
  ON sales_documents(store_id, source_order_id);

CREATE INDEX IF NOT EXISTS idx_sales_documents_billed_client
  ON sales_documents(store_id, billed_client_id, document_date DESC);

COMMIT;
