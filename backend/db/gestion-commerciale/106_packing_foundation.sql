BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'lots'::regclass
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname::text ORDER BY keys.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum
      ) = ARRAY['id', 'store_id']::text[]
  ) THEN
    ALTER TABLE lots
      ADD CONSTRAINT packing_lots_id_store_id_unique UNIQUE (id, store_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS packing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  output_article_id uuid NOT NULL,
  total_output_quantity numeric(14,4) NOT NULL,
  package_count numeric(14,4) NOT NULL,
  quantity_per_package numeric(14,4) NOT NULL,
  fish_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  packaging_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  total_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  output_lot_id uuid,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  CONSTRAINT packing_operations_status_check
    CHECK (status IN ('draft', 'validated', 'cancelled')),
  CONSTRAINT packing_operations_package_count_check
    CHECK (package_count > 0),
  CONSTRAINT packing_operations_total_output_quantity_check
    CHECK (total_output_quantity > 0),
  CONSTRAINT packing_operations_quantity_per_package_check
    CHECK (quantity_per_package > 0),
  CONSTRAINT packing_operations_quantity_consistency_check
    CHECK (ABS(total_output_quantity - (package_count * quantity_per_package)) <= 0.001),
  CONSTRAINT packing_operations_output_article_store_fk
    FOREIGN KEY (output_article_id, store_id)
    REFERENCES articles(id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT packing_operations_output_lot_store_fk
    FOREIGN KEY (output_lot_id, store_id)
    REFERENCES lots(id, store_id)
    ON DELETE SET NULL (output_lot_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packing_operations_id_store_id_unique'
      AND conrelid = 'packing_operations'::regclass
  ) THEN
    ALTER TABLE packing_operations
      ADD CONSTRAINT packing_operations_id_store_id_unique UNIQUE (id, store_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS packing_source_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  packing_operation_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  article_id uuid NOT NULL,
  quantity_used numeric(14,4) NOT NULL,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  line_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packing_source_lots_quantity_check
    CHECK (quantity_used > 0),
  CONSTRAINT packing_source_lots_operation_store_fk
    FOREIGN KEY (packing_operation_id, store_id)
    REFERENCES packing_operations(id, store_id)
    ON DELETE CASCADE,
  CONSTRAINT packing_source_lots_lot_store_fk
    FOREIGN KEY (lot_id, store_id)
    REFERENCES lots(id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT packing_source_lots_article_store_fk
    FOREIGN KEY (article_id, store_id)
    REFERENCES articles(id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT packing_source_lots_unique_lot
    UNIQUE (store_id, packing_operation_id, lot_id)
);

CREATE TABLE IF NOT EXISTS packing_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  packing_operation_id uuid NOT NULL,
  article_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  quantity_used numeric(14,4) NOT NULL,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  line_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packing_materials_quantity_check
    CHECK (quantity_used > 0),
  CONSTRAINT packing_materials_operation_store_fk
    FOREIGN KEY (packing_operation_id, store_id)
    REFERENCES packing_operations(id, store_id)
    ON DELETE CASCADE,
  CONSTRAINT packing_materials_lot_store_fk
    FOREIGN KEY (lot_id, store_id)
    REFERENCES lots(id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT packing_materials_article_store_fk
    FOREIGN KEY (article_id, store_id)
    REFERENCES articles(id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT packing_materials_unique_lot
    UNIQUE (store_id, packing_operation_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_packing_operations_store_status
  ON packing_operations(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_packing_operations_output_lot
  ON packing_operations(store_id, output_lot_id);

CREATE INDEX IF NOT EXISTS idx_packing_source_lots_operation
  ON packing_source_lots(store_id, packing_operation_id);

CREATE INDEX IF NOT EXISTS idx_packing_source_lots_lot
  ON packing_source_lots(store_id, lot_id);

CREATE INDEX IF NOT EXISTS idx_packing_materials_operation
  ON packing_materials(store_id, packing_operation_id);

CREATE INDEX IF NOT EXISTS idx_packing_materials_lot
  ON packing_materials(store_id, lot_id);

COMMIT;
