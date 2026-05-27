-- =========================================================
-- 013_stock_article_pricing.sql
-- Prix de vente réel saisi pour le stock par article / rayon
-- =========================================================

CREATE TABLE IF NOT EXISTS stock_article_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  pv_ttc_real NUMERIC(12,2),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_stock_article_pricing_store_dept_article
    UNIQUE (store_id, department_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_article_pricing_store_department
  ON stock_article_pricing(store_id, department_id);

CREATE INDEX IF NOT EXISTS idx_stock_article_pricing_article
  ON stock_article_pricing(article_id);

CREATE OR REPLACE FUNCTION set_stock_article_pricing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_article_pricing_updated_at ON stock_article_pricing;

CREATE TRIGGER trg_stock_article_pricing_updated_at
BEFORE UPDATE ON stock_article_pricing
FOR EACH ROW
EXECUTE FUNCTION set_stock_article_pricing_updated_at();