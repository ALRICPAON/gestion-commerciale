ALTER TABLE stores
ADD COLUMN IF NOT EXISTS client_key text;

WITH scorpa_store AS (
  SELECT id
  FROM stores
  WHERE lower(name) LIKE '%scorpa%'
    OR code = 'LEC001'
    OR client_key IS NULL
  ORDER BY
    CASE
      WHEN lower(name) LIKE '%scorpa%' THEN 0
      WHEN code = 'LEC001' THEN 1
      ELSE 2
    END,
    created_at ASC NULLS LAST
  LIMIT 1
)
UPDATE stores
SET client_key = 'scorpa'
FROM scorpa_store
WHERE stores.id = scorpa_store.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_client_key
ON stores(client_key)
WHERE client_key IS NOT NULL;
