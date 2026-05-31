BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  article_id uuid NOT NULL REFERENCES articles(id),
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  lot_code text NOT NULL,
  supplier_lot_number text,
  source_type text NOT NULL DEFAULT 'purchase',
  qty_initial numeric(14,3) NOT NULL DEFAULT 0,
  qty_remaining numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  dlc date,
  traceability_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS client_key text,
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_lot_number text,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS qty_initial numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_remaining numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dlc date,
  ADD COLUMN IF NOT EXISTS traceability_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  article_id uuid NOT NULL REFERENCES articles(id),
  lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  source_table text,
  source_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS client_key text,
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS stock_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  article_id uuid NOT NULL REFERENCES articles(id),
  stock_quantity numeric(14,3) NOT NULL DEFAULT 0,
  stock_value_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  pma numeric(14,4) NOT NULL DEFAULT 0,
  next_dlc date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_summary
  ADD COLUMN IF NOT EXISTS stock_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_value_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pma numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_dlc date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ux_lots_store_lot_code
  ON lots(store_id, lot_code);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_summary_store_article
  ON stock_summary(store_id, article_id);

CREATE INDEX IF NOT EXISTS idx_lots_store_article_fifo
  ON lots(store_id, article_id, qty_remaining, dlc, created_at);

CREATE INDEX IF NOT EXISTS idx_lots_store_available
  ON lots(store_id, qty_remaining)
  WHERE qty_remaining > 0;

CREATE INDEX IF NOT EXISTS idx_stock_movements_store_article_created
  ON stock_movements(store_id, article_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_lot
  ON stock_movements(lot_id);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_lot
  ON purchase_lines(lot_id);

COMMIT;
