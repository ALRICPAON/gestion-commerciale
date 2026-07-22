BEGIN;

CREATE TABLE IF NOT EXISTS stock_cost_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  component_type text NOT NULL CHECK (component_type IN ('PURCHASE', 'PACKAGING', 'TRANSPORT', 'OTHER')),
  quantity_reference numeric(14,3) NOT NULL DEFAULT 0,
  amount_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost_delta_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_cost_components_source
  ON stock_cost_components(store_id, source_table, source_id, component_type);

CREATE INDEX IF NOT EXISTS idx_stock_cost_components_article
  ON stock_cost_components(store_id, article_id, status, component_type);

CREATE INDEX IF NOT EXISTS idx_stock_cost_components_lot
  ON stock_cost_components(store_id, lot_id, status);

COMMIT;
