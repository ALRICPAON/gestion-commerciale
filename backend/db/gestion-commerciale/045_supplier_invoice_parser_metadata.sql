BEGIN;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS supplier_invoice_bl_number text,
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS parsed_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS parsed_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_bl_number
  ON supplier_invoices(store_id, supplier_id, supplier_invoice_bl_number)
  WHERE supplier_invoice_bl_number IS NOT NULL;

COMMIT;
