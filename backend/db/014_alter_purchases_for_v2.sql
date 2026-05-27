BEGIN;

-- =========================================================
-- 1) PURCHASES : remise au propre pour le workflow V2
-- =========================================================

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS purchase_type VARCHAR(30) NOT NULL DEFAULT 'order',
  ADD COLUMN IF NOT EXISTS order_date DATE,
  ADD COLUMN IF NOT EXISTS delivery_date DATE,
  ADD COLUMN IF NOT EXISTS receipt_date DATE,
  ADD COLUMN IF NOT EXISTS bl_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

-- Harmonisation du statut achat
ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_status_check;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN ('draft', 'ordered', 'receiving', 'received', 'closed', 'cancelled'));

-- Harmonisation du type d'achat
ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_purchase_type_check;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_purchase_type_check
  CHECK (purchase_type IN ('order', 'direct_bl', 'invoice_only'));

-- Valeur de secours
UPDATE purchases
SET purchase_type = 'order'
WHERE purchase_type IS NULL OR purchase_type = '';

-- Si order_date est vide, on le remplit depuis created_at
UPDATE purchases
SET order_date = created_at::date
WHERE order_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_store_department
  ON purchases(store_id, department_id);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier
  ON purchases(supplier_id);

CREATE INDEX IF NOT EXISTS idx_purchases_status
  ON purchases(status);

CREATE INDEX IF NOT EXISTS idx_purchases_order_date
  ON purchases(order_date);

CREATE INDEX IF NOT EXISTS idx_purchases_receipt_date
  ON purchases(receipt_date);

CREATE INDEX IF NOT EXISTS idx_purchases_bl_number
  ON purchases(bl_number);


-- =========================================================
-- 2) PURCHASE_LINES : enrichissement pour réception / lots
-- =========================================================

ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS ordered_quantity NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS line_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS lot_mode VARCHAR(30) NOT NULL DEFAULT 'auto';

-- Repli : si ordered_quantity est vide mais received_quantity existe déjà
UPDATE purchase_lines
SET ordered_quantity = received_quantity
WHERE ordered_quantity IS NULL
  AND received_quantity IS NOT NULL;

-- Repli : stock_quantity = received_quantity si vide
UPDATE purchase_lines
SET stock_quantity = received_quantity
WHERE stock_quantity IS NULL
  AND received_quantity IS NOT NULL;

-- Recalcul montant si possible
UPDATE purchase_lines
SET line_amount_ex_vat = ROUND(COALESCE(received_quantity, 0) * COALESCE(unit_price_ex_vat, 0), 2)
WHERE line_amount_ex_vat IS NULL;

ALTER TABLE purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_line_status_check;

ALTER TABLE purchase_lines
  ADD CONSTRAINT purchase_lines_line_status_check
  CHECK (line_status IN ('pending', 'partially_received', 'received', 'cancelled'));

ALTER TABLE purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_lot_mode_check;

ALTER TABLE purchase_lines
  ADD CONSTRAINT purchase_lines_lot_mode_check
  CHECK (lot_mode IN ('auto', 'manual', 'none'));

CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase
  ON purchase_lines(purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_article
  ON purchase_lines(article_id);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_supplier_mapping
  ON purchase_lines(supplier_article_mapping_id);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_line_status
  ON purchase_lines(line_status);


-- =========================================================
-- 3) PURCHASE_LINE_METADATA : données de réception / sanitaire
-- =========================================================

ALTER TABLE purchase_line_metadata
  ADD COLUMN IF NOT EXISTS dlc DATE,
  ADD COLUMN IF NOT EXISTS latin_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS fao_zone VARCHAR(120),
  ADD COLUMN IF NOT EXISTS sous_zone VARCHAR(120),
  ADD COLUMN IF NOT EXISTS fishing_gear VARCHAR(120),
  ADD COLUMN IF NOT EXISTS production_method VARCHAR(120),
  ADD COLUMN IF NOT EXISTS allergens TEXT,
  ADD COLUMN IF NOT EXISTS origin_label VARCHAR(255),
  ADD COLUMN IF NOT EXISTS supplier_lot_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS sanitary_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS sanitary_photo_taken_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_line_metadata_line
  ON purchase_line_metadata(purchase_line_id);

CREATE INDEX IF NOT EXISTS idx_purchase_line_metadata_dlc
  ON purchase_line_metadata(dlc);

CREATE INDEX IF NOT EXISTS idx_purchase_line_metadata_supplier_lot
  ON purchase_line_metadata(supplier_lot_number);

COMMIT;