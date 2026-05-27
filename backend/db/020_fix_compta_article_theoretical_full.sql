ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS article_label TEXT;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS article_plu TEXT;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS qty_sold_theoretical NUMERIC(12,3) DEFAULT 0;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS sale_unit TEXT;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS unit_sale_price_ht NUMERIC(12,4) DEFAULT 0;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS unit_cost_ht NUMERIC(12,4) DEFAULT 0;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS theoretical_ca_ht NUMERIC(12,2) DEFAULT 0;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS theoretical_cost_ht NUMERIC(12,2) DEFAULT 0;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS theoretical_margin_ht NUMERIC(12,2) DEFAULT 0;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS theoretical_margin_pct NUMERIC(12,2) DEFAULT 0;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS pricing_issue BOOLEAN DEFAULT false;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS cost_issue BOOLEAN DEFAULT false;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS negative_margin BOOLEAN DEFAULT false;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS anomaly_note TEXT;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS source_document_id UUID;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS source_line_id UUID;