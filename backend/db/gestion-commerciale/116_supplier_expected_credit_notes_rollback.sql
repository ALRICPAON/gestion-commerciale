BEGIN;

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
      'credit_note_linked',
      'pennylane_sync_error',
      'pennylane_retry',
      'legacy_backfill',
      'migration_issue'
    )
  );

DROP TRIGGER IF EXISTS trg_supplier_expected_credit_note_links_updated_at ON supplier_expected_credit_note_links;
DROP TRIGGER IF EXISTS trg_supplier_expected_credit_notes_updated_at ON supplier_expected_credit_notes;
DROP FUNCTION IF EXISTS set_supplier_expected_credit_notes_updated_at();

DROP TABLE IF EXISTS supplier_expected_credit_note_links;
DROP TABLE IF EXISTS supplier_expected_credit_notes;

COMMIT;
