BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS supplier_expected_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  source_purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  source_purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  source_pennylane_supplier_invoice_id uuid REFERENCES pennylane_supplier_invoices(id) ON DELETE SET NULL,
  expected_amount_ex_vat numeric(14,4) NOT NULL,
  reason_type text NOT NULL,
  reason_comment text NOT NULL,
  affected_quantity numeric(14,4),
  affected_unit text,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancellation_comment text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_supplier_expected_credit_notes_amount CHECK (expected_amount_ex_vat > 0),
  CONSTRAINT chk_supplier_expected_credit_notes_reason CHECK (
    reason_type IN ('price_error', 'quality_issue', 'quantity_issue', 'missing_goods', 'supplier_return', 'other')
  ),
  CONSTRAINT chk_supplier_expected_credit_notes_status CHECK (
    status IN ('pending', 'matched', 'resolved', 'cancelled', 'disputed')
  ),
  CONSTRAINT chk_supplier_expected_credit_notes_quantity CHECK (
    affected_quantity IS NULL OR affected_quantity > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_expected_credit_notes_idempotency
  ON supplier_expected_credit_notes(store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_expected_credit_notes_supplier
  ON supplier_expected_credit_notes(store_id, supplier_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_expected_credit_notes_purchase
  ON supplier_expected_credit_notes(store_id, source_purchase_id, status);

CREATE INDEX IF NOT EXISTS idx_supplier_expected_credit_notes_source_invoice
  ON supplier_expected_credit_notes(store_id, source_pennylane_supplier_invoice_id, status);

CREATE TABLE IF NOT EXISTS supplier_expected_credit_note_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  expected_credit_note_id uuid NOT NULL REFERENCES supplier_expected_credit_notes(id) ON DELETE CASCADE,
  pennylane_credit_note_id uuid NOT NULL REFERENCES pennylane_supplier_invoices(id) ON DELETE CASCADE,
  applied_amount_ex_vat numeric(14,4) NOT NULL,
  status text NOT NULL DEFAULT 'matched',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  unlink_comment text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_supplier_expected_credit_note_links_amount CHECK (applied_amount_ex_vat > 0),
  CONSTRAINT chk_supplier_expected_credit_note_links_status CHECK (
    status IN ('matched', 'resolved', 'unlinked')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_expected_credit_note_links_active
  ON supplier_expected_credit_note_links(store_id, expected_credit_note_id, pennylane_credit_note_id)
  WHERE status <> 'unlinked';

CREATE INDEX IF NOT EXISTS idx_supplier_expected_credit_note_links_expected
  ON supplier_expected_credit_note_links(store_id, expected_credit_note_id, status);

CREATE INDEX IF NOT EXISTS idx_supplier_expected_credit_note_links_credit
  ON supplier_expected_credit_note_links(store_id, pennylane_credit_note_id, status);

CREATE OR REPLACE FUNCTION set_supplier_expected_credit_notes_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_expected_credit_notes_updated_at ON supplier_expected_credit_notes;
CREATE TRIGGER trg_supplier_expected_credit_notes_updated_at
BEFORE UPDATE ON supplier_expected_credit_notes
FOR EACH ROW
EXECUTE FUNCTION set_supplier_expected_credit_notes_updated_at();

DROP TRIGGER IF EXISTS trg_supplier_expected_credit_note_links_updated_at ON supplier_expected_credit_note_links;
CREATE TRIGGER trg_supplier_expected_credit_note_links_updated_at
BEFORE UPDATE ON supplier_expected_credit_note_links
FOR EACH ROW
EXECUTE FUNCTION set_supplier_expected_credit_notes_updated_at();

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
