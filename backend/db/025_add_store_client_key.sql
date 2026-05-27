ALTER TABLE stores
ADD COLUMN IF NOT EXISTS client_key text;

UPDATE stores
SET client_key = 'challans'
WHERE code = 'LEC001'
  AND client_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_client_key
ON stores(client_key)
WHERE client_key IS NOT NULL;