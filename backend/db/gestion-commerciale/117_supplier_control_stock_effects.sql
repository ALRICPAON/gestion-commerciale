BEGIN;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_expected_credit_note_id uuid REFERENCES supplier_expected_credit_notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pennylane_credit_note_id uuid REFERENCES pennylane_supplier_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_movements_supplier_control_idempotency
  ON stock_movements(store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_supplier_expected_credit_note
  ON stock_movements(store_id, supplier_expected_credit_note_id, created_at DESC)
  WHERE supplier_expected_credit_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_pennylane_credit_note
  ON stock_movements(store_id, pennylane_credit_note_id, created_at DESC)
  WHERE pennylane_credit_note_id IS NOT NULL;

ALTER TABLE supplier_control_events
  DROP CONSTRAINT IF EXISTS chk_supplier_control_events_type,
  ADD CONSTRAINT chk_supplier_control_events_type CHECK (
    event_type IN (
      'pennylane_sync',
      'automatic_analysis',
      'match_applied',
      'match_added',
      'match_removed',
      'validation',
      'validation_requested',
      'validation_succeeded',
      'validation_failed',
      'validation_already_applied',
      'validation_reconciliation_required',
      'difference',
      'difference_detected',
      'difference_accepted',
      'litigation',
      'dispute_opened',
      'expected_credit_note',
      'expected_credit_note_created',
      'expected_credit_note_updated',
      'expected_credit_note_cancelled',
      'credit_note_match_proposed',
      'credit_note_linked',
      'credit_note_unlinked',
      'expected_credit_note_partially_resolved',
      'expected_credit_note_resolved',
      'supplier_stock_destruction_created',
      'supplier_stock_return_created',
      'pennylane_sync_error',
      'pennylane_retry',
      'legacy_backfill',
      'migration_issue'
    )
  );

COMMIT;
