BEGIN;

-- =========================================================
-- 1) AJOUT DES CHAMPS METIER COMMANDE / RECEPTION
-- =========================================================

ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS ordered_colis NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS ordered_pieces NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS received_colis NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS received_pieces NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS price_unit VARCHAR(20) NOT NULL DEFAULT 'kg';

-- =========================================================
-- 2) CONTRAINTES
-- =========================================================

ALTER TABLE purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_price_unit_check;

ALTER TABLE purchase_lines
  ADD CONSTRAINT purchase_lines_price_unit_check
  CHECK (price_unit IN ('kg', 'piece', 'colis'));

ALTER TABLE purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_ordered_colis_check;

ALTER TABLE purchase_lines
  ADD CONSTRAINT purchase_lines_ordered_colis_check
  CHECK (ordered_colis IS NULL OR ordered_colis >= 0);

ALTER TABLE purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_ordered_pieces_check;

ALTER TABLE purchase_lines
  ADD CONSTRAINT purchase_lines_ordered_pieces_check
  CHECK (ordered_pieces IS NULL OR ordered_pieces >= 0);

ALTER TABLE purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_received_colis_check;

ALTER TABLE purchase_lines
  ADD CONSTRAINT purchase_lines_received_colis_check
  CHECK (received_colis IS NULL OR received_colis >= 0);

ALTER TABLE purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_received_pieces_check;

ALTER TABLE purchase_lines
  ADD CONSTRAINT purchase_lines_received_pieces_check
  CHECK (received_pieces IS NULL OR received_pieces >= 0);

-- =========================================================
-- 3) INDEX
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_purchase_lines_price_unit
  ON purchase_lines(price_unit);

-- =========================================================
-- 4) COMMENTAIRES
-- =========================================================

COMMENT ON COLUMN purchase_lines.ordered_colis IS 'Nombre de colis commandés';
COMMENT ON COLUMN purchase_lines.ordered_pieces IS 'Nombre de pièces commandées';
COMMENT ON COLUMN purchase_lines.received_colis IS 'Nombre de colis reçus';
COMMENT ON COLUMN purchase_lines.received_pieces IS 'Nombre de pièces reçues';
COMMENT ON COLUMN purchase_lines.price_unit IS 'Unité du prix d achat: kg, piece ou colis';

COMMIT;