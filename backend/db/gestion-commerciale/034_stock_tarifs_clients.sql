BEGIN;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS sale_price_level_1_ht numeric(12,4),
  ADD COLUMN IF NOT EXISTS sale_price_level_2_ht numeric(12,4),
  ADD COLUMN IF NOT EXISTS sale_price_level_3_ht numeric(12,4);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tariff_level integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_clients_tariff_level'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT chk_clients_tariff_level
      CHECK (tariff_level IN (1, 2, 3));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_articles_store_tariff_levels
  ON articles(store_id, sale_price_level_1_ht, sale_price_level_2_ht, sale_price_level_3_ht);

CREATE INDEX IF NOT EXISTS idx_clients_store_tariff_level
  ON clients(store_id, tariff_level);

COMMIT;
