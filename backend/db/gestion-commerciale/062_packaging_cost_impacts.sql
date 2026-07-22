BEGIN;

CREATE TABLE IF NOT EXISTS packaging_cost_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  packaging_operation_id uuid NOT NULL REFERENCES packaging_operations(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  stock_quantity_at_validation numeric(14,3) NOT NULL DEFAULT 0,
  product_cost_before_packaging numeric(14,4) NOT NULL DEFAULT 0,
  packaging_cost_total_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  packaging_cost_added_per_kg numeric(14,4) NOT NULL DEFAULT 0,
  cost_after_packaging_per_kg numeric(14,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancellation_reason text,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, packaging_operation_id)
);

CREATE INDEX IF NOT EXISTS idx_packaging_cost_impacts_article
  ON packaging_cost_impacts(store_id, article_id, status, created_at DESC);

COMMIT;
