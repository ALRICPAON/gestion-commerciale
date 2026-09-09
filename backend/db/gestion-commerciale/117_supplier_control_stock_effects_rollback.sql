BEGIN;

DROP INDEX IF EXISTS idx_stock_movements_pennylane_credit_note;
DROP INDEX IF EXISTS idx_stock_movements_supplier_expected_credit_note;
DROP INDEX IF EXISTS ux_stock_movements_supplier_control_idempotency;

ALTER TABLE stock_movements
  DROP COLUMN IF EXISTS raw_payload,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS occurred_at,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS pennylane_credit_note_id,
  DROP COLUMN IF EXISTS supplier_expected_credit_note_id,
  DROP COLUMN IF EXISTS supplier_id,
  DROP COLUMN IF EXISTS purchase_line_id,
  DROP COLUMN IF EXISTS purchase_id;

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
      'pennylane_sync_error',
      'pennylane_retry',
      'legacy_backfill',
      'migration_issue'
    )
  );

COMMIT;
