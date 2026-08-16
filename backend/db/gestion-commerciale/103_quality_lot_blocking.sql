BEGIN;

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS quality_block_reason text,
  ADD COLUMN IF NOT EXISTS quality_block_reason_type text,
  ADD COLUMN IF NOT EXISTS quality_block_comment text,
  ADD COLUMN IF NOT EXISTS quality_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_blocked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quality_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_released_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quality_release_reason text,
  ADD COLUMN IF NOT EXISTS quality_release_comment text,
  ADD COLUMN IF NOT EXISTS quality_non_conformity_id uuid REFERENCES quality_non_conformities(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lots_id_store_id_unique'
      AND conrelid = 'lots'::regclass
  ) THEN
    ALTER TABLE lots
      ADD CONSTRAINT lots_id_store_id_unique UNIQUE (id, store_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_non_conformities_id_store_id_unique'
      AND conrelid = 'quality_non_conformities'::regclass
  ) THEN
    ALTER TABLE quality_non_conformities
      ADD CONSTRAINT quality_non_conformities_id_store_id_unique UNIQUE (id, store_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lots_quality_status_check'
      AND conrelid = 'lots'::regclass
  ) THEN
    ALTER TABLE lots
      ADD CONSTRAINT lots_quality_status_check CHECK (quality_status IN ('available', 'blocked'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS quality_lot_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  reason_type text,
  reason text,
  comment text,
  source_type text,
  source_id uuid,
  quality_non_conformity_id uuid REFERENCES quality_non_conformities(id) ON DELETE SET NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lots_quality_nc_store_fk'
      AND conrelid = 'lots'::regclass
  ) THEN
    ALTER TABLE lots
      ADD CONSTRAINT lots_quality_nc_store_fk
      FOREIGN KEY (quality_non_conformity_id, store_id)
      REFERENCES quality_non_conformities(id, store_id)
      ON DELETE SET NULL (quality_non_conformity_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_lot_history_lot_store_fk'
      AND conrelid = 'quality_lot_status_history'::regclass
  ) THEN
    ALTER TABLE quality_lot_status_history
      ADD CONSTRAINT quality_lot_history_lot_store_fk
      FOREIGN KEY (lot_id, store_id)
      REFERENCES lots(id, store_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_lot_history_nc_store_fk'
      AND conrelid = 'quality_lot_status_history'::regclass
  ) THEN
    ALTER TABLE quality_lot_status_history
      ADD CONSTRAINT quality_lot_history_nc_store_fk
      FOREIGN KEY (quality_non_conformity_id, store_id)
      REFERENCES quality_non_conformities(id, store_id)
      ON DELETE SET NULL (quality_non_conformity_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lots_quality_status
  ON lots(store_id, quality_status, article_id, qty_remaining);

CREATE INDEX IF NOT EXISTS idx_quality_lot_status_history_lot
  ON quality_lot_status_history(store_id, lot_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_lot_status_history_nc
  ON quality_lot_status_history(store_id, quality_non_conformity_id);

COMMIT;
