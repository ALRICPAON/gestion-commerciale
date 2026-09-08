BEGIN;

DROP VIEW IF EXISTS supplier_control_document_summary;

DROP TRIGGER IF EXISTS trg_supplier_control_links_updated_at ON supplier_control_document_links;
DROP FUNCTION IF EXISTS set_supplier_control_links_updated_at();

DROP TABLE IF EXISTS supplier_control_migration_issues;
DROP TABLE IF EXISTS supplier_control_events;
DROP TABLE IF EXISTS supplier_control_document_links;

ALTER TABLE pennylane_supplier_invoices
  DROP CONSTRAINT IF EXISTS chk_pennylane_supplier_invoices_supplier_control_status,
  DROP COLUMN IF EXISTS supplier_control_status;

COMMIT;
