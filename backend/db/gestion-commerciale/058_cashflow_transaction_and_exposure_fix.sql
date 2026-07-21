ALTER TABLE cashflow_bank_transactions
  ALTER COLUMN transaction_date DROP NOT NULL,
  ALTER COLUMN label DROP NOT NULL,
  ALTER COLUMN amount DROP NOT NULL;

ALTER TABLE cashflow_sync_resource_logs
  ADD COLUMN IF NOT EXISTS error_details jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE pennylane_supplier_invoices
  ADD COLUMN IF NOT EXISTS cashflow_open_state text NOT NULL DEFAULT 'needs_review',
  ADD COLUMN IF NOT EXISTS cashflow_remaining_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS cashflow_paid_amount numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashflow_state_reason text,
  ADD COLUMN IF NOT EXISTS cashflow_supplier_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pennylane_supplier_invoices_cashflow_open_state_check'
  ) THEN
    ALTER TABLE pennylane_supplier_invoices
      ADD CONSTRAINT pennylane_supplier_invoices_cashflow_open_state_check
      CHECK (cashflow_open_state IN ('open', 'paid', 'needs_review'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoices_cashflow_state
  ON pennylane_supplier_invoices(store_id, cashflow_open_state, due_date);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoices_cashflow_supplier
  ON pennylane_supplier_invoices(store_id, pennylane_supplier_id, cashflow_open_state);
