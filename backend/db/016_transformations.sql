-- =========================================================
-- 016_transformations.sql
-- Module Transformation V2 (simple 1 -> 1)
-- =========================================================

BEGIN;

-- =========================================================
-- 1) TABLE transformations
-- =========================================================

CREATE TABLE IF NOT EXISTS transformations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

  transformation_date date NOT NULL DEFAULT CURRENT_DATE,
  status varchar(30) NOT NULL DEFAULT 'draft',
  transformation_type varchar(30) NOT NULL DEFAULT 'simple',

  reference_number varchar(120),
  notes text,

  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT transformations_status_check
    CHECK (status IN ('draft', 'validated', 'cancelled')),

  CONSTRAINT transformations_type_check
    CHECK (transformation_type IN ('simple'))
);

CREATE INDEX IF NOT EXISTS idx_transformations_store_department_date
  ON transformations(store_id, department_id, transformation_date DESC);

CREATE INDEX IF NOT EXISTS idx_transformations_status
  ON transformations(status);

-- =========================================================
-- 2) TABLE transformation_inputs
--    1 ligne source par transformation pour cette V1
-- =========================================================

CREATE TABLE IF NOT EXISTS transformation_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_id uuid NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,

  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  line_number integer NOT NULL DEFAULT 1,

  input_quantity numeric(12,3) NOT NULL DEFAULT 0,
  input_unit varchar(20) NOT NULL DEFAULT 'kg',

  line_status varchar(30) NOT NULL DEFAULT 'pending',

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT transformation_inputs_unit_check
    CHECK (input_unit IN ('kg', 'piece', 'colis')),

  CONSTRAINT transformation_inputs_status_check
    CHECK (line_status IN ('pending', 'validated', 'cancelled')),

  CONSTRAINT transformation_inputs_quantity_check
    CHECK (input_quantity >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transformation_inputs_line
  ON transformation_inputs(transformation_id, line_number);

CREATE INDEX IF NOT EXISTS idx_transformation_inputs_transformation
  ON transformation_inputs(transformation_id);

CREATE INDEX IF NOT EXISTS idx_transformation_inputs_article
  ON transformation_inputs(article_id);

-- =========================================================
-- 3) TABLE transformation_outputs
--    1 ligne cible par transformation pour cette V1
-- =========================================================

CREATE TABLE IF NOT EXISTS transformation_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_id uuid NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,

  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  line_number integer NOT NULL DEFAULT 1,

  output_quantity numeric(12,3) NOT NULL DEFAULT 0,
  output_unit varchar(20) NOT NULL DEFAULT 'kg',

  unit_cost_ex_vat numeric(12,4) NOT NULL DEFAULT 0,
  total_cost_ex_vat numeric(12,4) NOT NULL DEFAULT 0,

  created_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,

  line_status varchar(30) NOT NULL DEFAULT 'pending',

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT transformation_outputs_unit_check
    CHECK (output_unit IN ('kg', 'piece', 'colis')),

  CONSTRAINT transformation_outputs_status_check
    CHECK (line_status IN ('pending', 'validated', 'cancelled')),

  CONSTRAINT transformation_outputs_quantity_check
    CHECK (output_quantity >= 0),

  CONSTRAINT transformation_outputs_cost_check
    CHECK (unit_cost_ex_vat >= 0 AND total_cost_ex_vat >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transformation_outputs_line
  ON transformation_outputs(transformation_id, line_number);

CREATE INDEX IF NOT EXISTS idx_transformation_outputs_transformation
  ON transformation_outputs(transformation_id);

CREATE INDEX IF NOT EXISTS idx_transformation_outputs_article
  ON transformation_outputs(article_id);

CREATE INDEX IF NOT EXISTS idx_transformation_outputs_created_lot
  ON transformation_outputs(created_lot_id);

-- =========================================================
-- 4) TABLE transformation_input_lots
--    détail réel des lots consommés
-- =========================================================

CREATE TABLE IF NOT EXISTS transformation_input_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_input_id uuid NOT NULL REFERENCES transformation_inputs(id) ON DELETE CASCADE,

  lot_id uuid NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,

  quantity_taken numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost_ex_vat numeric(12,4) NOT NULL DEFAULT 0,

  selection_mode varchar(20) NOT NULL DEFAULT 'fifo',
  sort_order integer NOT NULL DEFAULT 1,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT transformation_input_lots_quantity_check
    CHECK (quantity_taken > 0),

  CONSTRAINT transformation_input_lots_cost_check
    CHECK (unit_cost_ex_vat >= 0),

  CONSTRAINT transformation_input_lots_selection_mode_check
    CHECK (selection_mode IN ('fifo', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_transformation_input_lots_input
  ON transformation_input_lots(transformation_input_id);

CREATE INDEX IF NOT EXISTS idx_transformation_input_lots_lot
  ON transformation_input_lots(lot_id);

-- =========================================================
-- 5) TABLE transformation_metadata
--    souple pour notes / traçabilité étendue / futur
-- =========================================================

CREATE TABLE IF NOT EXISTS transformation_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_id uuid NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,

  meta_key varchar(100) NOT NULL,
  meta_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_transformation_metadata_key
    UNIQUE (transformation_id, meta_key)
);

CREATE INDEX IF NOT EXISTS idx_transformation_metadata_transformation
  ON transformation_metadata(transformation_id);

-- =========================================================
-- 6) TRIGGERS updated_at
-- =========================================================

CREATE OR REPLACE FUNCTION set_updated_at_transformations()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transformations_updated_at ON transformations;
CREATE TRIGGER trg_transformations_updated_at
BEFORE UPDATE ON transformations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_transformations();

DROP TRIGGER IF EXISTS trg_transformation_inputs_updated_at ON transformation_inputs;
CREATE TRIGGER trg_transformation_inputs_updated_at
BEFORE UPDATE ON transformation_inputs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_transformations();

DROP TRIGGER IF EXISTS trg_transformation_outputs_updated_at ON transformation_outputs;
CREATE TRIGGER trg_transformation_outputs_updated_at
BEFORE UPDATE ON transformation_outputs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_transformations();

DROP TRIGGER IF EXISTS trg_transformation_input_lots_updated_at ON transformation_input_lots;
CREATE TRIGGER trg_transformation_input_lots_updated_at
BEFORE UPDATE ON transformation_input_lots
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_transformations();

DROP TRIGGER IF EXISTS trg_transformation_metadata_updated_at ON transformation_metadata;
CREATE TRIGGER trg_transformation_metadata_updated_at
BEFORE UPDATE ON transformation_metadata
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_transformations();

COMMIT;