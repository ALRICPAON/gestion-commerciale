CREATE TABLE IF NOT EXISTS fabrications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

  recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  output_article_id UUID REFERENCES articles(id) ON DELETE SET NULL,

  fabrication_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft',

  reference_number TEXT,
  name TEXT NOT NULL,

  planned_quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  produced_quantity NUMERIC(12,3),
  output_unit TEXT NOT NULL DEFAULT 'kg',

  dlc_date DATE,
  notes TEXT,

  transformation_id UUID,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fabrications_status_check
    CHECK (status IN ('draft', 'in_progress', 'validated', 'cancelled')),

  CONSTRAINT fabrications_output_unit_check
    CHECK (output_unit IN ('kg', 'piece', 'colis'))
);

CREATE TABLE IF NOT EXISTS fabrication_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  fabrication_id UUID NOT NULL REFERENCES fabrications(id) ON DELETE CASCADE,

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,

  line_number INTEGER NOT NULL,
  planned_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  used_quantity NUMERIC(12,3),
  unit TEXT NOT NULL DEFAULT 'kg',

  line_status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fabrication_lines_unit_check
    CHECK (unit IN ('kg', 'piece', 'colis')),

  CONSTRAINT fabrication_lines_status_check
    CHECK (line_status IN ('pending', 'validated', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS fabrication_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  fabrication_id UUID NOT NULL REFERENCES fabrications(id) ON DELETE CASCADE,
  meta_key TEXT NOT NULL,
  meta_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (fabrication_id, meta_key)
);

CREATE INDEX IF NOT EXISTS idx_fabrications_store_department
  ON fabrications(store_id, department_id);

CREATE INDEX IF NOT EXISTS idx_fabrications_recipe
  ON fabrications(recipe_id);

CREATE INDEX IF NOT EXISTS idx_fabrications_status
  ON fabrications(status);

CREATE INDEX IF NOT EXISTS idx_fabrication_lines_fabrication
  ON fabrication_lines(fabrication_id);

CREATE INDEX IF NOT EXISTS idx_fabrication_lines_article
  ON fabrication_lines(article_id);