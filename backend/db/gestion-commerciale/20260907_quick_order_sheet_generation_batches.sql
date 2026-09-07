ALTER TABLE quick_order_sheet_generations
  DROP CONSTRAINT IF EXISTS quick_order_sheet_generations_store_id_sheet_id_key;

CREATE INDEX IF NOT EXISTS idx_quick_order_sheet_generations_store_sheet_created
  ON quick_order_sheet_generations(store_id, sheet_id, created_at DESC);
