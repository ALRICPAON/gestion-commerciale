ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS pricing_issue BOOLEAN DEFAULT false;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS cost_issue BOOLEAN DEFAULT false;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS negative_margin BOOLEAN DEFAULT false;

ALTER TABLE compta_daily_article_theoretical_lines
ADD COLUMN IF NOT EXISTS anomaly_note TEXT;