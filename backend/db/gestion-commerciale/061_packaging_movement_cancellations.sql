BEGIN;

ALTER TABLE packaging_stock_movements
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS reversal_movement_id uuid REFERENCES packaging_stock_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_packaging_stock_movements_cancelled
  ON packaging_stock_movements(store_id, cancelled_at)
  WHERE cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_packaging_stock_movements_source
  ON packaging_stock_movements(store_id, source_table, source_id)
  WHERE source_table IS NOT NULL;

COMMIT;
