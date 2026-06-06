BEGIN;

DROP TABLE IF EXISTS supplier_invoice_cost_adjustments;
DROP TABLE IF EXISTS supplier_invoice_exports;
DROP TABLE IF EXISTS supplier_invoice_documents;
DROP TABLE IF EXISTS supplier_invoice_matches;
DROP TABLE IF EXISTS supplier_invoice_lines;
DROP TABLE IF EXISTS supplier_invoices;

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS chk_purchases_status_supplier_invoice_flow;

ALTER TABLE purchases
  DROP COLUMN IF EXISTS source_document_url,
  DROP COLUMN IF EXISTS source_document_storage_path,
  DROP COLUMN IF EXISTS source_document_original_name,
  DROP COLUMN IF EXISTS source_document_mime_type,
  DROP COLUMN IF EXISTS source_document_uploaded_at,
  DROP COLUMN IF EXISTS source_document_uploaded_by;

COMMIT;
