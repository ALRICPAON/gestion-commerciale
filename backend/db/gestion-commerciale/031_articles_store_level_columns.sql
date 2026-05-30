BEGIN;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS latin_name text,
  ADD COLUMN IF NOT EXISTS fao_zone text,
  ADD COLUMN IF NOT EXISTS sous_zone text,
  ADD COLUMN IF NOT EXISTS fishing_gear text,
  ADD COLUMN IF NOT EXISTS allergens text,
  ADD COLUMN IF NOT EXISTS production_method text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS purchase_unit text,
  ADD COLUMN IF NOT EXISTS stock_unit text,
  ADD COLUMN IF NOT EXISTS sale_unit text,
  ADD COLUMN IF NOT EXISTS family_code text,
  ADD COLUMN IF NOT EXISTS family_name text,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 5.50,
  ADD COLUMN IF NOT EXISTS purchase_price_ex_vat numeric(12,4),
  ADD COLUMN IF NOT EXISTS sale_price_ex_vat numeric(12,4),
  ADD COLUMN IF NOT EXISTS sale_price_inc_vat numeric(12,4);

CREATE INDEX IF NOT EXISTS idx_articles_store_designation
  ON articles(store_id, designation);

CREATE INDEX IF NOT EXISTS idx_articles_store_active
  ON articles(store_id, is_active);

CREATE INDEX IF NOT EXISTS idx_articles_store_ean
  ON articles(store_id, ean);

CREATE INDEX IF NOT EXISTS idx_articles_store_latin_name
  ON articles(store_id, latin_name);

CREATE INDEX IF NOT EXISTS idx_articles_store_family
  ON articles(store_id, family_code);

COMMIT;
