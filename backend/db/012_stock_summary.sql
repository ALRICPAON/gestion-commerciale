-- =========================================================
-- 012_stock_summary.sql
-- Table de synthèse stock rapide par article / rayon
-- Vérité détaillée = lots + stock_movements
-- Vérité opérationnelle d'affichage = stock_summary
-- =========================================================

CREATE TABLE IF NOT EXISTS stock_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_value_ex_vat NUMERIC(14,4) NOT NULL DEFAULT 0,
  pma NUMERIC(12,4) NOT NULL DEFAULT 0,

  next_dlc DATE NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_stock_summary_store_dept_article
    UNIQUE (store_id, department_id, article_id)
);

-- Index de lecture principal pour la page stock
CREATE INDEX IF NOT EXISTS idx_stock_summary_store_department
  ON stock_summary(store_id, department_id);

-- Index utile pour jointures / lookup article
CREATE INDEX IF NOT EXISTS idx_stock_summary_article
  ON stock_summary(article_id);

-- Index utile pour tris / filtres DLC
CREATE INDEX IF NOT EXISTS idx_stock_summary_next_dlc
  ON stock_summary(next_dlc);

-- updated_at auto
CREATE OR REPLACE FUNCTION set_stock_summary_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_summary_updated_at ON stock_summary;

CREATE TRIGGER trg_stock_summary_updated_at
BEFORE UPDATE ON stock_summary
FOR EACH ROW
EXECUTE FUNCTION set_stock_summary_updated_at();