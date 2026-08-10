-- Module transversal Fournitures & materiels.
-- Additif et idempotent: aucune donnee production n est modifiee automatiquement.
-- Les documents restent portes par quality_master_documents et quality_document_references.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS supplies_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  category text NOT NULL,
  subcategory text,
  description text,
  brand text,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_reference text,
  order_url text,
  image_document_id uuid,
  unit text,
  packaging text,
  purchase_price numeric(12, 4),
  minimum_stock numeric(12, 3),
  current_stock numeric(12, 3),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT supplies_materials_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT supplies_materials_store_code_unique UNIQUE (store_id, code),
  CONSTRAINT supplies_materials_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT supplies_materials_price_check CHECK (purchase_price IS NULL OR purchase_price >= 0),
  CONSTRAINT supplies_materials_stock_check CHECK (
    (minimum_stock IS NULL OR minimum_stock >= 0)
    AND (current_stock IS NULL OR current_stock >= 0)
  )
);

CREATE TABLE IF NOT EXISTS supply_material_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supply_material_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  target_code text,
  relation_type text NOT NULL DEFAULT 'used_for',
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT supply_material_links_material_store_fk
    FOREIGN KEY (supply_material_id, store_id)
    REFERENCES supplies_materials(id, store_id)
    ON DELETE CASCADE,
  CONSTRAINT supply_material_links_target_type_check CHECK (
    target_type IN ('zone', 'equipment', 'cleaning_plan', 'quality_task', 'documentation_section', 'pms_chapter')
  )
);

CREATE TABLE IF NOT EXISTS supply_material_supplier_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supply_material_id uuid NOT NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_reference text,
  purchase_price numeric(12, 4),
  order_url text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT supply_material_supplier_history_material_store_fk
    FOREIGN KEY (supply_material_id, store_id)
    REFERENCES supplies_materials(id, store_id)
    ON DELETE CASCADE
);

ALTER TABLE quality_cleaning_plans
  ADD COLUMN IF NOT EXISTS supply_material_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_cleaning_plans_supply_material_fk'
  ) THEN
    ALTER TABLE quality_cleaning_plans
      ADD CONSTRAINT quality_cleaning_plans_supply_material_fk
      FOREIGN KEY (supply_material_id, store_id)
      REFERENCES supplies_materials(id, store_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplies_materials_store_category
  ON supplies_materials(store_id, category, active, archived_at);

CREATE INDEX IF NOT EXISTS idx_supplies_materials_supplier
  ON supplies_materials(store_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplies_materials_search
  ON supplies_materials USING gin (
    to_tsvector('simple', COALESCE(code, '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(brand, '') || ' ' || COALESCE(description, ''))
  );

CREATE INDEX IF NOT EXISTS idx_supply_material_links_material
  ON supply_material_links(store_id, supply_material_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_supply_material_links_target
  ON supply_material_links(store_id, target_type, target_id, archived_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_material_links_active
  ON supply_material_links(
    store_id,
    supply_material_id,
    target_type,
    COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(target_code, ''),
    relation_type
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_supply_material_supplier_history_material
  ON supply_material_supplier_history(store_id, supply_material_id, valid_until);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_supply_material
  ON quality_cleaning_plans(store_id, supply_material_id)
  WHERE supply_material_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_supplies_materials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplies_materials_updated_at ON supplies_materials;

CREATE TRIGGER trg_supplies_materials_updated_at
BEFORE UPDATE ON supplies_materials
FOR EACH ROW
EXECUTE FUNCTION set_supplies_materials_updated_at();

COMMIT;

-- Rollback manuel:
-- BEGIN;
-- ALTER TABLE quality_cleaning_plans DROP CONSTRAINT IF EXISTS quality_cleaning_plans_supply_material_fk;
-- ALTER TABLE quality_cleaning_plans DROP COLUMN IF EXISTS supply_material_id;
-- DROP TABLE IF EXISTS supply_material_supplier_history;
-- DROP TABLE IF EXISTS supply_material_links;
-- DROP TABLE IF EXISTS supplies_materials;
-- DROP FUNCTION IF EXISTS set_supplies_materials_updated_at();
-- COMMIT;
