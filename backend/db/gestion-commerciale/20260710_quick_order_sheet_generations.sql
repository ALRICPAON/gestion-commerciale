CREATE TABLE IF NOT EXISTS quick_order_sheet_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  client_key text,
  title text,
  sheet_date date,
  notes text,
  generated_order_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, sheet_id)
);

CREATE INDEX IF NOT EXISTS idx_quick_order_sheet_generations_store_created
  ON quick_order_sheet_generations(store_id, created_at DESC);
