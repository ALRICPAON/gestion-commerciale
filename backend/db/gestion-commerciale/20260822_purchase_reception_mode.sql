BEGIN;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS reception_mode text NOT NULL DEFAULT 'physical';

DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'purchases'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reception_mode%'
  LOOP
    EXECUTE format('ALTER TABLE purchases DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;
END $$;

ALTER TABLE purchases
  ADD CONSTRAINT chk_purchases_reception_mode
  CHECK (reception_mode IN ('physical', 'direct_trade'));

CREATE INDEX IF NOT EXISTS idx_purchases_reception_mode
  ON purchases(store_id, reception_mode, receipt_date DESC);

COMMIT;
