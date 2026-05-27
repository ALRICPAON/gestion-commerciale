BEGIN;

-- =========================================================
-- 1) TABLE STOCK_MOVEMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  lot_id UUID REFERENCES lots(id) ON DELETE SET NULL,

  movement_type VARCHAR(40) NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  unit_cost_ex_vat NUMERIC(12,4),

  source_table VARCHAR(60),
  source_id UUID,

  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- =========================================================
-- 2) CONTRAINTES
-- =========================================================

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (
    movement_type IN (
      'purchase_in',
      'sale_out',
      'inventory_adjustment',
      'loss',
      'transformation_in',
      'transformation_out',
      'plateau_out',
      'manual_in',
      'manual_out',
      'correction'
    )
  );

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_unit_cost_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_unit_cost_check
  CHECK (unit_cost_ex_vat IS NULL OR unit_cost_ex_vat >= 0);

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_quantity_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_quantity_check
  CHECK (quantity <> 0);

-- =========================================================
-- 3) INDEX
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_stock_movements_store_department
  ON stock_movements(store_id, department_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_article
  ON stock_movements(article_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_lot
  ON stock_movements(lot_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_type
  ON stock_movements(movement_type);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at
  ON stock_movements(created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_source
  ON stock_movements(source_table, source_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created_by
  ON stock_movements(created_by);

-- =========================================================
-- 4) COMMENTAIRES METIER
-- =========================================================

COMMENT ON TABLE stock_movements IS 'Journal complet des entrées, sorties et corrections de stock';
COMMENT ON COLUMN stock_movements.quantity IS 'Quantité signée métier: positive ou négative selon le type de mouvement';
COMMENT ON COLUMN stock_movements.source_table IS 'Table source métier à l’origine du mouvement';
COMMENT ON COLUMN stock_movements.source_id IS 'Identifiant de l’objet source métier';

COMMIT;