BEGIN;

ALTER TABLE pennylane_supplier_invoices
  DROP CONSTRAINT IF EXISTS chk_pennylane_supplier_invoices_supplier_control_status,
  ADD CONSTRAINT chk_pennylane_supplier_invoices_supplier_control_status
    CHECK (supplier_control_status IN (
      'a_rapprocher',
      'a_controler',
      'ecart',
      'avoir_attendu',
      'conforme',
      'valide_a_payer',
      'paye',
      'litige',
      'reconciliation_required'
    ));

COMMIT;
