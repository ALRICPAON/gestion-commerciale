CREATE TABLE IF NOT EXISTS compta_daily_article_theoretical_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL,
  department_id UUID NOT NULL,
  closure_date DATE NOT NULL,

  article_id UUID,
  article_plu TEXT,
  article_label TEXT,

  qty_sold_theoretical NUMERIC(12,3) DEFAULT 0,
  sale_unit TEXT,

  unit_sale_price_ht NUMERIC(12,4) DEFAULT 0,
  unit_cost_ht NUMERIC(12,4) DEFAULT 0,

  theoretical_ca_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_cost_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_margin_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_margin_pct NUMERIC(12,2) DEFAULT 0,

  pricing_issue BOOLEAN DEFAULT false,
  cost_issue BOOLEAN DEFAULT false,
  negative_margin BOOLEAN DEFAULT false,
  anomaly_note TEXT,

  source_document_id UUID,
  source_line_id UUID,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compta_article_theoretical_day
ON compta_daily_article_theoretical_lines(store_id, department_id, closure_date);

CREATE INDEX IF NOT EXISTS idx_compta_article_theoretical_article
ON compta_daily_article_theoretical_lines(article_id);