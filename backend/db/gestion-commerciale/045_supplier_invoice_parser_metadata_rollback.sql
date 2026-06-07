BEGIN;

DROP INDEX IF EXISTS idx_supplier_invoices_bl_number;

ALTER TABLE supplier_invoice_lines
  DROP COLUMN IF EXISTS parsed_payload;

ALTER TABLE supplier_invoices
  DROP COLUMN IF EXISTS parsed_payload,
  DROP COLUMN IF EXISTS customer_code,
  DROP COLUMN IF EXISTS supplier_invoice_bl_number;

COMMIT;
