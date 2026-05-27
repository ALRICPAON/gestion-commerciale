BEGIN;

-- =========================================================
-- A. Sécuriser les champs de réception dans purchase_lines
-- =========================================================

UPDATE purchase_lines
SET
  received_colis = COALESCE(received_colis, 0),
  received_pieces = COALESCE(received_pieces, 0),
  received_quantity = COALESCE(received_quantity, 0);

ALTER TABLE purchase_lines
  ALTER COLUMN received_colis SET DEFAULT 0;

ALTER TABLE purchase_lines
  ALTER COLUMN received_pieces SET DEFAULT 0;

ALTER TABLE purchase_lines
  ALTER COLUMN received_quantity SET DEFAULT 0;

ALTER TABLE purchase_lines
  ALTER COLUMN received_quantity SET NOT NULL;

-- =========================================================
-- B. Garantir 1 seule metadata métier "v2_line" par ligne achat
-- =========================================================

-- Si certaines lignes n'ont pas de meta_key, on force v2_line
UPDATE purchase_line_metadata
SET meta_key = 'v2_line'
WHERE meta_key IS NULL;

-- Si certaines lignes n'ont pas de meta_value, on force {}
UPDATE purchase_line_metadata
SET meta_value = '{}'::jsonb
WHERE meta_value IS NULL;

-- Nettoyage des doublons sur (purchase_line_id, meta_key)
DELETE FROM purchase_line_metadata a
USING purchase_line_metadata b
WHERE a.id < b.id
  AND a.purchase_line_id = b.purchase_line_id
  AND a.meta_key = b.meta_key;

-- Contrainte unique propre pour ON CONFLICT
ALTER TABLE purchase_line_metadata
ADD CONSTRAINT purchase_line_metadata_purchase_line_id_meta_key_key
UNIQUE (purchase_line_id, meta_key);

COMMIT;