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
  price_level_1_ht numeric(14,4),
  price_level_2_ht numeric(14,4),
  price_level_3_ht numeric(14,4),
  price_source text NOT NULL DEFAULT 'manual',
  tariff_level integer,
  line_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_customer_price_list_lines_price_source
    CHECK (price_source IN ('target_tariff', 'client_tariff', 'manual', 'none')),
  CONSTRAINT chk_customer_price_list_lines_tariff_level
    CHECK (tariff_level IS NULL OR tariff_level IN (1, 2, 3))
);

ALTER TABLE customer_price_lists
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS price_list_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS tariff_level integer,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE customer_price_list_lines
  ADD COLUMN IF NOT EXISTS family_code text,
  ADD COLUMN IF NOT EXISTS family_name text,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS designation_snapshot text,
  ADD COLUMN IF NOT EXISTS caliber_info text,
  ADD COLUMN IF NOT EXISTS origin_label text,
  ADD COLUMN IF NOT EXISTS fao_zone text,
  ADD COLUMN IF NOT EXISTS sous_zone text,
  ADD COLUMN IF NOT EXISTS sale_unit text,
  ADD COLUMN IF NOT EXISTS stock_quantity_snapshot numeric(14,4),
  ADD COLUMN IF NOT EXISTS price_ht numeric(14,4),
  ADD COLUMN IF NOT EXISTS price_level_1_ht numeric(14,4),
  ADD COLUMN IF NOT EXISTS price_level_2_ht numeric(14,4),
  ADD COLUMN IF NOT EXISTS price_level_3_ht numeric(14,4),
  ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tariff_level integer,
  ADD COLUMN IF NOT EXISTS line_note text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE customer_price_list_lines
  ALTER COLUMN designation_snapshot SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'customer_price_lists'::regclass
      AND conname = 'chk_customer_price_lists_course_type'
  ) THEN
    ALTER TABLE customer_price_lists DROP CONSTRAINT chk_customer_price_lists_course_type;
  END IF;

  ALTER TABLE customer_price_lists
    ADD CONSTRAINT chk_customer_price_lists_course_type
    CHECK (course_type IN ('general', 'client', 'promotion', 'daily_arrival'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'customer_price_lists'::regclass
      AND conname = 'chk_customer_price_lists_status'
  ) THEN
    ALTER TABLE customer_price_lists DROP CONSTRAINT chk_customer_price_lists_status;
  END IF;

  ALTER TABLE customer_price_lists
    ADD CONSTRAINT chk_customer_price_lists_status
    CHECK (status IN ('draft', 'ready', 'archived'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'customer_price_lists'::regclass
      AND conname = 'chk_customer_price_lists_tariff_level'
  ) THEN
    ALTER TABLE customer_price_lists DROP CONSTRAINT chk_customer_price_lists_tariff_level;
  END IF;

  ALTER TABLE customer_price_lists
    ADD CONSTRAINT chk_customer_price_lists_tariff_level
    CHECK (tariff_level IS NULL OR tariff_level IN (1, 2, 3));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'customer_price_list_lines'::regclass
      AND conname = 'chk_customer_price_list_lines_price_source'
  ) THEN
    ALTER TABLE customer_price_list_lines DROP CONSTRAINT chk_customer_price_list_lines_price_source;
  END IF;

  ALTER TABLE customer_price_list_lines
    ADD CONSTRAINT chk_customer_price_list_lines_price_source
    CHECK (price_source IN ('target_tariff', 'client_tariff', 'manual', 'none'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'customer_price_list_lines'::regclass
      AND conname = 'chk_customer_price_list_lines_tariff_level'
  ) THEN
    ALTER TABLE customer_price_list_lines DROP CONSTRAINT chk_customer_price_list_lines_tariff_level;
  END IF;

  ALTER TABLE customer_price_list_lines
    ADD CONSTRAINT chk_customer_price_list_lines_tariff_level
    CHECK (tariff_level IS NULL OR tariff_level IN (1, 2, 3));
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_price_lists_store_date
  ON customer_price_lists(store_id, price_list_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_price_lists_store_client
  ON customer_price_lists(store_id, client_id);

CREATE INDEX IF NOT EXISTS idx_customer_price_lists_store_status
  ON customer_price_lists(store_id, status);

CREATE INDEX IF NOT EXISTS idx_customer_price_lists_store_tariff_level
  ON customer_price_lists(store_id, tariff_level);

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
