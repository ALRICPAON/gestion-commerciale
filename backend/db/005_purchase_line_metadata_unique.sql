-- 1) Sécuriser les quantités reçues
UPDATE purchase_lines
SET
  received_colis = COALESCE(received_colis, 0),
  received_pieces = COALESCE(received_pieces, 0),
  received_quantity = COALESCE(received_quantity, 0);

ALTER TABLE purchase_lines
  ALTER COLUMN received_quantity SET DEFAULT 0,
  ALTER COLUMN received_quantity SET NOT NULL;

ALTER TABLE purchase_lines
  ALTER COLUMN received_colis SET DEFAULT 0;

ALTER TABLE purchase_lines
  ALTER COLUMN received_pieces SET DEFAULT 0;

-- 2) Nettoyer les doublons éventuels avant contrainte
DELETE FROM purchase_line_metadata a
USING purchase_line_metadata b
WHERE a.id < b.id
  AND a.purchase_line_id = b.purchase_line_id
  AND a.meta_key = b.meta_key;

-- 3) Ajouter la vraie contrainte métier
ALTER TABLE purchase_line_metadata
ADD CONSTRAINT purchase_line_metadata_purchase_line_id_meta_key_key
UNIQUE (purchase_line_id, meta_key);