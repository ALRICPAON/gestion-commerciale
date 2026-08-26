BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tariff_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  legacy_level integer,
  display_order integer NOT NULL DEFAULT 0,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tariff_levels_legacy_level CHECK (legacy_level IS NULL OR legacy_level > 0),
  CONSTRAINT uq_tariff_levels_store_code UNIQUE (store_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tariff_levels_store_legacy_level
  ON tariff_levels(store_id, legacy_level)
  WHERE legacy_level IS NOT NULL;

INSERT INTO tariff_levels (store_id, code, name, legacy_level, display_order, description)
SELECT s.id, level.code, level.name, level.legacy_level, level.display_order, level.description
FROM stores s
CROSS JOIN (
  VALUES
    ('T1', 'Tarif 1', 1, 10, 'Niveau tarifaire historique 1'),
    ('T2', 'Tarif 2', 2, 20, 'Niveau tarifaire historique 2'),
    ('T3', 'Tarif 3', 3, 30, 'Niveau tarifaire historique 3')
) AS level(code, name, legacy_level, display_order, description)
ON CONFLICT (store_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  legacy_level = EXCLUDED.legacy_level,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tariff_level_id uuid REFERENCES tariff_levels(id) ON DELETE SET NULL;

UPDATE clients c
SET tariff_level_id = tl.id
FROM tariff_levels tl
WHERE tl.store_id = c.store_id
  AND tl.legacy_level = c.tariff_level
  AND c.tariff_level_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_store_tariff_level_id
  ON clients(store_id, tariff_level_id);

CREATE TABLE IF NOT EXISTS pricing_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  pricing_date date NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'draft',
  version_number integer NOT NULL DEFAULT 1,
  is_active_publication boolean NOT NULL DEFAULT false,
  source_session_id uuid REFERENCES pricing_sessions(id) ON DELETE SET NULL,
  published_at timestamptz,
  superseded_at timestamptz,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pricing_sessions_status CHECK (status IN ('draft', 'published', 'superseded', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_sessions_active_publication
  ON pricing_sessions(store_id, pricing_date)
  WHERE is_active_publication = true;

CREATE INDEX IF NOT EXISTS idx_pricing_sessions_store_date
  ON pricing_sessions(store_id, pricing_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_sessions_store_status
  ON pricing_sessions(store_id, status, pricing_date DESC);

CREATE TABLE IF NOT EXISTS pricing_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  pricing_session_id uuid NOT NULL REFERENCES pricing_sessions(id) ON DELETE CASCADE,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_price_import_line_id uuid,
  plu_snapshot text,
  designation_snapshot text NOT NULL,
  family_code text,
  family_name text,
  sale_unit text,
  price_unit text DEFAULT 'kg',
  purchase_price_ht numeric(14,4),
  purchase_price_source text NOT NULL DEFAULT 'manual',
  supplier_designation_original text,
  transport_cost_ht numeric(14,4) NOT NULL DEFAULT 0,
  transport_cost_source text NOT NULL DEFAULT 'manual',
  transport_cost_forced boolean NOT NULL DEFAULT false,
  cost_rendered_ht numeric(14,4) GENERATED ALWAYS AS (COALESCE(purchase_price_ht, 0) + COALESCE(transport_cost_ht, 0)) STORED,
  display_order integer NOT NULL DEFAULT 0,
  exclude_from_mercuriale boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_lines_session_order
  ON pricing_lines(pricing_session_id, display_order, designation_snapshot);

CREATE INDEX IF NOT EXISTS idx_pricing_lines_store_article
  ON pricing_lines(store_id, article_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_lines_store_supplier
  ON pricing_lines(store_id, supplier_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_lines_session_article
  ON pricing_lines(pricing_session_id, article_id)
  WHERE article_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pricing_line_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  pricing_line_id uuid NOT NULL REFERENCES pricing_lines(id) ON DELETE CASCADE,
  tariff_level_id uuid NOT NULL REFERENCES tariff_levels(id) ON DELETE CASCADE,
  price_ht numeric(14,4),
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pricing_line_tariffs_line_level UNIQUE (pricing_line_id, tariff_level_id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_line_tariffs_store_level
  ON pricing_line_tariffs(store_id, tariff_level_id);

CREATE TABLE IF NOT EXISTS supplier_price_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  import_date date NOT NULL DEFAULT CURRENT_DATE,
  source_type text NOT NULL DEFAULT 'text',
  original_filename text,
  status text NOT NULL DEFAULT 'draft',
  raw_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_price_imports_status CHECK (status IN ('draft', 'parsed', 'applied', 'archived', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_price_imports_store_date
  ON supplier_price_imports(store_id, import_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_price_imports_supplier
  ON supplier_price_imports(store_id, supplier_id, import_date DESC);

CREATE TABLE IF NOT EXISTS supplier_price_import_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES supplier_price_imports(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  row_number integer NOT NULL DEFAULT 1,
  supplier_designation_original text NOT NULL,
  supplier_designation_normalized text NOT NULL,
  unit text,
  caliber text,
  availability text,
  purchase_price_ht numeric(14,4),
  price_unit text DEFAULT 'kg',
  matched_article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  mapping_id uuid REFERENCES supplier_article_mappings(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unrecognized',
  match_method text,
  confidence_score numeric(5,2),
  applied_pricing_line_id uuid REFERENCES pricing_lines(id) ON DELETE SET NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_price_import_lines_status CHECK (match_status IN ('certain', 'probable', 'unrecognized', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_price_import_lines_import
  ON supplier_price_import_lines(import_id, row_number);

CREATE INDEX IF NOT EXISTS idx_supplier_price_import_lines_matching
  ON supplier_price_import_lines(store_id, supplier_id, supplier_designation_normalized);

ALTER TABLE supplier_article_mappings
  ADD COLUMN IF NOT EXISTS supplier_designation_original text,
  ADD COLUMN IF NOT EXISTS supplier_designation_normalized text,
  ADD COLUMN IF NOT EXISTS mapping_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confidence_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'supplier_article_mappings'::regclass
      AND conname = 'supplier_article_mappings_supplier_id_supplier_ref_key'
  ) THEN
    ALTER TABLE supplier_article_mappings
      DROP CONSTRAINT supplier_article_mappings_supplier_id_supplier_ref_key;
  END IF;
END $$;

UPDATE supplier_article_mappings
SET supplier_designation_original = COALESCE(supplier_designation_original, supplier_label, supplier_ref),
    supplier_designation_normalized = COALESCE(
      supplier_designation_normalized,
      lower(regexp_replace(trim(COALESCE(supplier_ref, supplier_label, '')), '\s+', ' ', 'g'))
    )
WHERE supplier_designation_normalized IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_article_mappings_store_supplier_normalized_active
  ON supplier_article_mappings(store_id, supplier_id, supplier_designation_normalized)
  WHERE COALESCE(is_active, true) = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_article_mappings_store_supplier_ref_active
  ON supplier_article_mappings(store_id, supplier_id, supplier_ref)
  WHERE COALESCE(is_active, true) = true;

CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_normalized
  ON supplier_article_mappings(store_id, supplier_id, supplier_designation_normalized);

ALTER TABLE quick_order_sheet_products
  ADD COLUMN IF NOT EXISTS pricing_session_id uuid REFERENCES pricing_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pricing_line_id uuid REFERENCES pricing_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tariff_prices jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS transport_cost_ht numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_rendered_ht numeric(14,4);

CREATE INDEX IF NOT EXISTS idx_quick_order_sheet_products_pricing_line
  ON quick_order_sheet_products(store_id, pricing_line_id);

ALTER TABLE sales_lines
  ADD COLUMN IF NOT EXISTS pricing_session_id uuid REFERENCES pricing_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pricing_line_id uuid REFERENCES pricing_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tariff_level_id uuid REFERENCES tariff_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_tariff_price_ht numeric(14,4),
  ADD COLUMN IF NOT EXISTS royale_maree_commission_ht numeric(14,4),
  ADD COLUMN IF NOT EXISTS final_unit_price_ht numeric(14,4);

CREATE INDEX IF NOT EXISTS idx_sales_lines_pricing_trace
  ON sales_lines(store_id, pricing_session_id, pricing_line_id, tariff_level_id);

DROP TRIGGER IF EXISTS trg_tariff_levels_updated_at ON tariff_levels;
CREATE TRIGGER trg_tariff_levels_updated_at
BEFORE UPDATE ON tariff_levels
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_pricing_sessions_updated_at ON pricing_sessions;
CREATE TRIGGER trg_pricing_sessions_updated_at
BEFORE UPDATE ON pricing_sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_pricing_lines_updated_at ON pricing_lines;
CREATE TRIGGER trg_pricing_lines_updated_at
BEFORE UPDATE ON pricing_lines
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_pricing_line_tariffs_updated_at ON pricing_line_tariffs;
CREATE TRIGGER trg_pricing_line_tariffs_updated_at
BEFORE UPDATE ON pricing_line_tariffs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_supplier_price_imports_updated_at ON supplier_price_imports;
CREATE TRIGGER trg_supplier_price_imports_updated_at
BEFORE UPDATE ON supplier_price_imports
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_supplier_price_import_lines_updated_at ON supplier_price_import_lines;
CREATE TRIGGER trg_supplier_price_import_lines_updated_at
BEFORE UPDATE ON supplier_price_import_lines
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
