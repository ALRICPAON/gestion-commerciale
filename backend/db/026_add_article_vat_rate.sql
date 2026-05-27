ALTER TABLE article_departments
ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 5.50;
