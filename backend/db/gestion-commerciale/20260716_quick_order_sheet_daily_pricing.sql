BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quick_order_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sheet_date date NOT NULL,
  title text,
  notes text,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  default_margin_level_1 numeric(8,4) NOT NULL DEFAULT 0.1000,
  default_margin_level_2 numeric(8,4) NOT NULL DEFAULT 0.1500,
  default_margin_level_3 numeric(8,4) NOT NULL DEFAULT 0.2000,
  selected_client_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_entries jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, sheet_date)
);

CREATE TABLE IF NOT EXISTS quick_order_sheet_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sheet_id uuid NOT NULL REFERENCES quick_order_sheets(id) ON DELETE CASCADE,
  column_uid text NOT NULL,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  plu text,
  designation_snapshot text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  purchase_price_ht numeric(14,4),
  price_unit text,
  supplier_available_quantity numeric(14,4),
  sale_price_level_1_ht numeric(14,4),
  sale_price_level_2_ht numeric(14,4),
  sale_price_level_3_ht numeric(14,4),
  real_margin_level_1 numeric(8,4),
  real_margin_level_2 numeric(8,4),
  real_margin_level_3 numeric(8,4),
  manual_price_level_1 boolean NOT NULL DEFAULT false,
  manual_price_level_2 boolean NOT NULL DEFAULT false,
  manual_price_level_3 boolean NOT NULL DEFAULT false,
  family_code text,
  family_name text,
  sale_unit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, column_uid)
);

CREATE INDEX IF NOT EXISTS idx_quick_order_sheets_store_date
  ON quick_order_sheets(store_id, sheet_date DESC);

CREATE INDEX IF NOT EXISTS idx_quick_order_sheet_products_sheet_order
  ON quick_order_sheet_products(sheet_id, display_order);

CREATE INDEX IF NOT EXISTS idx_quick_order_sheet_products_store_article
  ON quick_order_sheet_products(store_id, article_id);

DROP TRIGGER IF EXISTS trg_quick_order_sheets_updated_at ON quick_order_sheets;
CREATE TRIGGER trg_quick_order_sheets_updated_at
BEFORE UPDATE ON quick_order_sheets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_quick_order_sheet_products_updated_at ON quick_order_sheet_products;
CREATE TRIGGER trg_quick_order_sheet_products_updated_at
BEFORE UPDATE ON quick_order_sheet_products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
