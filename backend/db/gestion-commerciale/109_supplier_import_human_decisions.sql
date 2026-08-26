ALTER TABLE supplier_price_import_lines
  ADD COLUMN IF NOT EXISTS user_decision text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_source text,
  ADD COLUMN IF NOT EXISTS raw_source_text text,
  ADD COLUMN IF NOT EXISTS source_page integer,
  ADD COLUMN IF NOT EXISTS source_filename text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE supplier_price_import_lines
SET user_decision = CASE
  WHEN match_status = 'certain' THEN 'confirmed'
  WHEN match_status = 'ignored' THEN 'ignored'
  ELSE COALESCE(NULLIF(user_decision, ''), 'pending')
END
WHERE user_decision IS NULL OR user_decision = 'pending';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'supplier_price_import_lines'::regclass
      AND conname = 'chk_supplier_price_import_lines_decision'
  ) THEN
    ALTER TABLE supplier_price_import_lines
      DROP CONSTRAINT chk_supplier_price_import_lines_decision;
  END IF;

  ALTER TABLE supplier_price_import_lines
    ADD CONSTRAINT chk_supplier_price_import_lines_decision
    CHECK (user_decision IN ('pending', 'confirmed', 'overridden', 'ignored'));
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_price_import_lines_decision
  ON supplier_price_import_lines(store_id, import_id, user_decision);
