BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS transformations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  client_key text,
  transformation_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft',
  transformation_type text NOT NULL DEFAULT 'simple',
  source_type text NOT NULL DEFAULT 'transformation',
  reference_number text,
  notes text,
  validated_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transformations_status
    CHECK (status IN ('draft', 'validated', 'cancelled')),
  CONSTRAINT chk_transformations_type
    CHECK (transformation_type IN ('simple'))
);

CREATE TABLE IF NOT EXISTS transformation_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_id uuid NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  client_key text,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  source_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  line_number integer NOT NULL DEFAULT 1,
  article_plu text,
  article_label text,
  input_quantity numeric(14,3) NOT NULL DEFAULT 0,
  input_unit text NOT NULL DEFAULT 'kg',
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  total_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  line_status text NOT NULL DEFAULT 'pending',
  traceability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transformation_inputs_unit
    CHECK (input_unit IN ('kg', 'piece', 'colis')),
  CONSTRAINT chk_transformation_inputs_status
    CHECK (line_status IN ('pending', 'validated', 'cancelled')),
  CONSTRAINT chk_transformation_inputs_quantity
    CHECK (input_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS transformation_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_id uuid NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  client_key text,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  created_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  line_number integer NOT NULL DEFAULT 1,
  article_plu text,
  article_label text,
  output_quantity numeric(14,3) NOT NULL DEFAULT 0,
  output_unit text NOT NULL DEFAULT 'kg',
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  total_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  line_status text NOT NULL DEFAULT 'pending',
  traceability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transformation_outputs_unit
    CHECK (output_unit IN ('kg', 'piece', 'colis')),
  CONSTRAINT chk_transformation_outputs_status
    CHECK (line_status IN ('pending', 'validated', 'cancelled')),
  CONSTRAINT chk_transformation_outputs_quantity
    CHECK (output_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS transformation_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_id uuid NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  client_key text,
  meta_key text NOT NULL DEFAULT 'creation',
  meta_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transformation_id, meta_key)
);

CREATE INDEX IF NOT EXISTS idx_transformations_store_date
  ON transformations(store_id, transformation_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transformations_store_status
  ON transformations(store_id, status, transformation_date DESC);

CREATE INDEX IF NOT EXISTS idx_transformations_store_reference
  ON transformations(store_id, reference_number);

CREATE INDEX IF NOT EXISTS idx_transformation_inputs_transformation
  ON transformation_inputs(transformation_id, line_number);

CREATE INDEX IF NOT EXISTS idx_transformation_inputs_store_article
  ON transformation_inputs(store_id, article_id);

CREATE INDEX IF NOT EXISTS idx_transformation_inputs_source_lot
  ON transformation_inputs(store_id, source_lot_id);

CREATE INDEX IF NOT EXISTS idx_transformation_outputs_transformation
  ON transformation_outputs(transformation_id, line_number);

CREATE INDEX IF NOT EXISTS idx_transformation_outputs_store_article
  ON transformation_outputs(store_id, article_id);

CREATE INDEX IF NOT EXISTS idx_transformation_outputs_created_lot
  ON transformation_outputs(store_id, created_lot_id);

CREATE INDEX IF NOT EXISTS idx_transformation_metadata_transformation
  ON transformation_metadata(transformation_id);

CREATE INDEX IF NOT EXISTS idx_transformation_metadata_store_key
  ON transformation_metadata(store_id, meta_key);

DROP TRIGGER IF EXISTS trg_transformations_updated_at ON transformations;
CREATE TRIGGER trg_transformations_updated_at
BEFORE UPDATE ON transformations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transformation_inputs_updated_at ON transformation_inputs;
CREATE TRIGGER trg_transformation_inputs_updated_at
BEFORE UPDATE ON transformation_inputs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transformation_outputs_updated_at ON transformation_outputs;
CREATE TRIGGER trg_transformation_outputs_updated_at
BEFORE UPDATE ON transformation_outputs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transformation_metadata_updated_at ON transformation_metadata;
CREATE TRIGGER trg_transformation_metadata_updated_at
BEFORE UPDATE ON transformation_metadata
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
