BEGIN;

-- =========================================================
-- SALES / STOCK OUT DOCUMENTS V2
-- =========================================================

-- 1) Documents de vente / sortie
CREATE TABLE IF NOT EXISTS sales_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,

  document_date date NOT NULL DEFAULT CURRENT_DATE,

  status varchar(30) NOT NULL DEFAULT 'draft',
  document_type varchar(50) NOT NULL,
  origin varchar(50) NOT NULL DEFAULT 'manual',

  reference_number varchar(120),
  source_inventory_date date,

  notes text,

  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT sales_documents_status_check CHECK (
    status IN ('draft', 'validated', 'cancelled')
  ),

  CONSTRAINT sales_documents_type_check CHECK (
    document_type IN (
      'inventory_sale',
      'manual_sale',
      'transfer_out',
      'waste'
    )
  ),

  CONSTRAINT sales_documents_origin_check CHECK (
    origin IN (
      'inventory_import',
      'manual',
      'interdepartment',
      'adjustment'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_sales_documents_store_department
  ON sales_documents(store_id, department_id);

CREATE INDEX IF NOT EXISTS idx_sales_documents_status
  ON sales_documents(status);

CREATE INDEX IF NOT EXISTS idx_sales_documents_type
  ON sales_documents(document_type);

CREATE INDEX IF NOT EXISTS idx_sales_documents_date
  ON sales_documents(document_date DESC);


-- 2) Lignes de vente / sortie
CREATE TABLE IF NOT EXISTS sales_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sales_document_id uuid NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,

  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,

  line_number integer NOT NULL,
  ean varchar(30),
  article_label varchar(255),

  sold_quantity numeric(12,3) NOT NULL DEFAULT 0,
  sale_unit varchar(20) NOT NULL DEFAULT 'kg',

  unit_sale_price_ttc numeric(12,4) NOT NULL DEFAULT 0,
  unit_sale_price_ht numeric(12,4) NOT NULL DEFAULT 0,

  line_total_ttc numeric(12,4) NOT NULL DEFAULT 0,
  line_total_ht numeric(12,4) NOT NULL DEFAULT 0,

  unit_cost_ex_vat numeric(12,4) NOT NULL DEFAULT 0,
  line_cost_ex_vat numeric(12,4) NOT NULL DEFAULT 0,
  line_margin_ex_vat numeric(12,4) NOT NULL DEFAULT 0,

  line_reason varchar(50),
  line_status varchar(30) NOT NULL DEFAULT 'pending',

  source_inventory_line jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT sales_lines_sale_unit_check CHECK (
    sale_unit IN ('kg', 'piece', 'colis')
  ),

  CONSTRAINT sales_lines_status_check CHECK (
    line_status IN ('pending', 'validated', 'cancelled')
  ),

  CONSTRAINT sales_lines_quantity_positive_check CHECK (
    sold_quantity >= 0
  ),

  CONSTRAINT sales_lines_prices_positive_check CHECK (
    unit_sale_price_ttc >= 0
    AND unit_sale_price_ht >= 0
    AND line_total_ttc >= 0
    AND line_total_ht >= 0
    AND unit_cost_ex_vat >= 0
    AND line_cost_ex_vat >= 0
  ),

  CONSTRAINT sales_lines_unique_line_number UNIQUE (sales_document_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_lines_document
  ON sales_lines(sales_document_id);

CREATE INDEX IF NOT EXISTS idx_sales_lines_article
  ON sales_lines(article_id);

CREATE INDEX IF NOT EXISTS idx_sales_lines_store_department
  ON sales_lines(store_id, department_id);


-- 3) Métadonnées de lignes de vente
CREATE TABLE IF NOT EXISTS sales_line_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sales_line_id uuid NOT NULL REFERENCES sales_lines(id) ON DELETE CASCADE,
  meta_key varchar(100) NOT NULL,
  meta_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT sales_line_metadata_unique_key UNIQUE (sales_line_id, meta_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_line_metadata_line
  ON sales_line_metadata(sales_line_id);


-- 4) Trigger updated_at
DROP TRIGGER IF EXISTS trg_sales_documents_updated_at ON sales_documents;
CREATE TRIGGER trg_sales_documents_updated_at
BEFORE UPDATE ON sales_documents
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sales_lines_updated_at ON sales_lines;
CREATE TRIGGER trg_sales_lines_updated_at
BEFORE UPDATE ON sales_lines
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sales_line_metadata_updated_at ON sales_line_metadata;
CREATE TRIGGER trg_sales_line_metadata_updated_at
BEFORE UPDATE ON sales_line_metadata
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


-- 5) Recalculs automatiques ligne vente
CREATE OR REPLACE FUNCTION compute_sales_line_amounts()
RETURNS trigger AS $$
BEGIN
  NEW.line_total_ttc :=
    ROUND(COALESCE(NEW.sold_quantity, 0) * COALESCE(NEW.unit_sale_price_ttc, 0), 4);

  NEW.line_total_ht :=
    ROUND(COALESCE(NEW.sold_quantity, 0) * COALESCE(NEW.unit_sale_price_ht, 0), 4);

  NEW.line_cost_ex_vat :=
    ROUND(COALESCE(NEW.sold_quantity, 0) * COALESCE(NEW.unit_cost_ex_vat, 0), 4);

  NEW.line_margin_ex_vat :=
    ROUND(COALESCE(NEW.line_total_ht, 0) - COALESCE(NEW.line_cost_ex_vat, 0), 4);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_sales_line_amounts ON sales_lines;
CREATE TRIGGER trg_compute_sales_line_amounts
BEFORE INSERT OR UPDATE ON sales_lines
FOR EACH ROW
EXECUTE FUNCTION compute_sales_line_amounts();

COMMIT;