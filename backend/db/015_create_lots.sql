BEGIN;

-- =========================================================
-- 1) TABLE LOTS
-- =========================================================

CREATE TABLE IF NOT EXISTS lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  purchase_line_id UUID REFERENCES purchase_lines(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,

  lot_code VARCHAR(80) NOT NULL,
  supplier_lot_number VARCHAR(120),

  source_type VARCHAR(30) NOT NULL DEFAULT 'purchase',
  scan_id VARCHAR(120),

  qty_initial NUMERIC(12,3) NOT NULL DEFAULT 0,
  qty_remaining NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_cost_ex_vat NUMERIC(12,4) NOT NULL DEFAULT 0,

  dlc DATE,
  sanitary_photo_url TEXT,
  traceability_data JSONB,

  status VARCHAR(30) NOT NULL DEFAULT 'open',

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP
);

-- =========================================================
-- 2) CONTRAINTES
-- =========================================================

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_status_check;

ALTER TABLE lots
  ADD CONSTRAINT lots_status_check
  CHECK (status IN ('open', 'partially_used', 'closed', 'blocked', 'discarded'));

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_source_type_check;

ALTER TABLE lots
  ADD CONSTRAINT lots_source_type_check
  CHECK (source_type IN ('purchase', 'inventory_adjustment', 'transformation', 'manual'));

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_qty_check;

ALTER TABLE lots
  ADD CONSTRAINT lots_qty_check
  CHECK (
    qty_initial >= 0
    AND qty_remaining >= 0
    AND qty_remaining <= qty_initial
  );

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_unit_cost_check;

ALTER TABLE lots
  ADD CONSTRAINT lots_unit_cost_check
  CHECK (unit_cost_ex_vat >= 0);

-- Un code lot doit être unique par magasin
ALTER TABLE lots
  ADD CONSTRAINT lots_store_lot_code_unique
  UNIQUE (store_id, lot_code);

-- =========================================================
-- 3) INDEX
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_lots_store_department
  ON lots(store_id, department_id);

CREATE INDEX IF NOT EXISTS idx_lots_article
  ON lots(article_id);

CREATE INDEX IF NOT EXISTS idx_lots_purchase
  ON lots(purchase_id);

CREATE INDEX IF NOT EXISTS idx_lots_purchase_line
  ON lots(purchase_line_id);

CREATE INDEX IF NOT EXISTS idx_lots_supplier
  ON lots(supplier_id);

CREATE INDEX IF NOT EXISTS idx_lots_status
  ON lots(status);

CREATE INDEX IF NOT EXISTS idx_lots_dlc
  ON lots(dlc);

CREATE INDEX IF NOT EXISTS idx_lots_created_at
  ON lots(created_at);

-- =========================================================
-- 4) COMMENTAIRES METIER
-- =========================================================

COMMENT ON TABLE lots IS 'Lots réels de stock créés après validation de mise en stock';
COMMENT ON COLUMN lots.lot_code IS 'Code lot métier court affichable';
COMMENT ON COLUMN lots.traceability_data IS 'Snapshot JSONB des données de traçabilité au moment de la création du lot';

COMMIT;