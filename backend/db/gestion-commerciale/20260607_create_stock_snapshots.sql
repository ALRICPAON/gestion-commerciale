CREATE TABLE IF NOT EXISTS stock_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  snapshot_date timestamptz NOT NULL DEFAULT NOW(),
  snapshot_type text NOT NULL DEFAULT 'manual' CHECK (snapshot_type IN ('manual', 'automatic')),
  total_value_ht numeric(14, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid
);

CREATE TABLE IF NOT EXISTS stock_snapshot_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES stock_snapshots(id) ON DELETE CASCADE,
  article_id uuid,
  lot_id uuid,
  quantity numeric(14, 4) NOT NULL DEFAULT 0,
  unit_cost_ht numeric(14, 4) NOT NULL DEFAULT 0,
  total_value_ht numeric(14, 4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stock_snapshots_store_date
  ON stock_snapshots(store_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_snapshots_store_type_date
  ON stock_snapshots(store_id, snapshot_type, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_snapshot_lines_snapshot
  ON stock_snapshot_lines(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_stock_snapshot_lines_article_lot
  ON stock_snapshot_lines(article_id, lot_id);
