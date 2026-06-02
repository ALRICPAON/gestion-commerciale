BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customer_price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  course_type text NOT NULL DEFAULT 'general',
  title text,
  price_list_date date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  status text NOT NULL DEFAULT 'draft',
  tariff_level integer,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_customer_price_lists_course_type
    CHECK (course_type IN ('general', 'client', 'promotion', 'daily_arrival')),
  CONSTRAINT chk_customer_price_lists_status
    CHECK (status IN ('draft', 'ready', 'archived')),
  CONSTRAINT chk_customer_price_lists_tariff_level
    CHECK (tariff_level IS NULL OR tariff_level IN (1, 2, 3))
);

CREATE TABLE IF NOT EXISTS customer_price_list_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES customer_price_lists(id) ON DELETE CASCADE,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  family_code text,
  family_name text,
  display_order integer NOT NULL DEFAULT 0,
  is_featured boolean NOT NULL DEFAULT false,
  designation_snapshot text NOT NULL,
  caliber_info text,
  origin_label text,
  fao_zone text,
  sous_zone text,
  sale_unit text,
  stock_quantity_snapshot numeric(14,4),
  price_ht numeric(14,4),
  price_source text NOT NULL DEFAULT 'manual',
  tariff_level integer,
  line_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_customer_price_list_lines_price_source
    CHECK (price_source IN ('client_tariff', 'manual', 'none')),
  CONSTRAINT chk_customer_price_list_lines_tariff_level
    CHECK (tariff_level IS NULL OR tariff_level IN (1, 2, 3))
);

CREATE INDEX IF NOT EXISTS idx_customer_price_lists_store_date
  ON customer_price_lists(store_id, price_list_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_price_lists_store_client
  ON customer_price_lists(store_id, client_id);

CREATE INDEX IF NOT EXISTS idx_customer_price_lists_store_status
  ON customer_price_lists(store_id, status);

CREATE INDEX IF NOT EXISTS idx_customer_price_list_lines_list_order
  ON customer_price_list_lines(price_list_id, is_featured DESC, family_name, display_order, designation_snapshot);

CREATE INDEX IF NOT EXISTS idx_customer_price_list_lines_store_article
  ON customer_price_list_lines(store_id, article_id);

DROP TRIGGER IF EXISTS trg_customer_price_lists_updated_at ON customer_price_lists;
CREATE TRIGGER trg_customer_price_lists_updated_at
BEFORE UPDATE ON customer_price_lists
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_price_list_lines_updated_at ON customer_price_list_lines;
CREATE TRIGGER trg_customer_price_list_lines_updated_at
BEFORE UPDATE ON customer_price_list_lines
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
