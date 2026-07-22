BEGIN;

CREATE TABLE IF NOT EXISTS packaging_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  designation text NOT NULL,
  category text NOT NULL CHECK (category IN ('consumable', 'returnable', 'reusable_internal')),
  management_unit text NOT NULL DEFAULT 'unit',
  format_label text,
  primary_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  current_unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0 CHECK (current_unit_cost_ex_vat >= 0),
  deposit_unit_value numeric(14,4) NOT NULL DEFAULT 0 CHECK (deposit_unit_value >= 0),
  alert_threshold numeric(14,3) NOT NULL DEFAULT 0 CHECK (alert_threshold >= 0),
  current_stock numeric(14,3) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_packaging_items_store_active
  ON packaging_items(store_id, active, category);

CREATE TABLE IF NOT EXISTS packaging_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  packaging_item_id uuid NOT NULL REFERENCES packaging_items(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (
    movement_type IN (
      'purchase_in',
      'conditioning_out',
      'inventory_adjustment',
      'loss',
      'destruction',
      'manual_correction'
    )
  ),
  quantity numeric(14,3) NOT NULL CHECK (quantity <> 0),
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost_ex_vat >= 0),
  source_table text,
  source_id uuid,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packaging_stock_movements_store_item_date
  ON packaging_stock_movements(store_id, packaging_item_id, movement_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS article_packaging_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_net_weight_kg numeric(14,3) CHECK (target_net_weight_kg IS NULL OR target_net_weight_kg > 0),
  target_package_count numeric(14,3) CHECK (target_package_count IS NULL OR target_package_count > 0),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_packaging_profiles_article
  ON article_packaging_profiles(store_id, article_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS ux_article_packaging_profiles_default
  ON article_packaging_profiles(store_id, article_id)
  WHERE is_default = true AND active = true;

CREATE TABLE IF NOT EXISTS article_packaging_profile_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES article_packaging_profiles(id) ON DELETE CASCADE,
  packaging_item_id uuid NOT NULL REFERENCES packaging_items(id) ON DELETE RESTRICT,
  quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  consumption_rule text NOT NULL DEFAULT 'per_package' CHECK (
    consumption_rule IN ('per_package', 'per_kg', 'fixed_per_operation')
  ),
  is_primary_packaging boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_packaging_profile_components_profile
  ON article_packaging_profile_components(store_id, profile_id);

CREATE TABLE IF NOT EXISTS packaging_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES article_packaging_profiles(id) ON DELETE SET NULL,
  operation_date date NOT NULL DEFAULT CURRENT_DATE,
  product_quantity_kg numeric(14,3) NOT NULL CHECK (product_quantity_kg > 0),
  package_count numeric(14,3) NOT NULL CHECK (package_count > 0),
  average_net_weight_kg numeric(14,4) NOT NULL DEFAULT 0 CHECK (average_net_weight_kg >= 0),
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'cancelled')),
  notes text,
  packaging_cost_total_ex_vat numeric(14,4) NOT NULL DEFAULT 0 CHECK (packaging_cost_total_ex_vat >= 0),
  packaging_cost_per_package numeric(14,4) NOT NULL DEFAULT 0 CHECK (packaging_cost_per_package >= 0),
  packaging_cost_per_kg numeric(14,4) NOT NULL DEFAULT 0 CHECK (packaging_cost_per_kg >= 0),
  product_cost_before_packaging numeric(14,4) NOT NULL DEFAULT 0 CHECK (product_cost_before_packaging >= 0),
  cost_after_packaging_per_kg numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_after_packaging_per_kg >= 0),
  validated_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packaging_operations_store_date
  ON packaging_operations(store_id, operation_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS packaging_operation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES packaging_operations(id) ON DELETE CASCADE,
  packaging_item_id uuid NOT NULL REFERENCES packaging_items(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity >= 0),
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost_ex_vat >= 0),
  total_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0 CHECK (total_cost_ex_vat >= 0),
  consumption_rule text NOT NULL CHECK (
    consumption_rule IN ('per_package', 'per_kg', 'fixed_per_operation')
  ),
  stock_movement_id uuid REFERENCES packaging_stock_movements(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packaging_operation_lines_operation
  ON packaging_operation_lines(store_id, operation_id);

CREATE TABLE IF NOT EXISTS returnable_packaging_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  packaging_item_id uuid NOT NULL REFERENCES packaging_items(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (
    movement_type IN (
      'deposit_receipt',
      'return',
      'supplier_credit_note',
      'adjustment',
      'loss',
      'breakage'
    )
  ),
  quantity numeric(14,3) NOT NULL CHECK (quantity <> 0),
  deposit_unit_value numeric(14,4) NOT NULL DEFAULT 0 CHECK (deposit_unit_value >= 0),
  source_table text,
  source_id uuid,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_returnable_packaging_movements_balance
  ON returnable_packaging_movements(store_id, packaging_item_id, supplier_id, movement_date DESC);

ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS line_business_type text DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS packaging_item_id uuid REFERENCES packaging_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_deposit_line boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_lines_line_business_type_check'
  ) THEN
    ALTER TABLE purchase_lines
      ADD CONSTRAINT purchase_lines_line_business_type_check
      CHECK (
        line_business_type IS NULL
        OR line_business_type IN ('product', 'consumable_packaging', 'returnable_packaging', 'fee_service')
      );
  END IF;
END $$;

COMMIT;
