BEGIN;

ALTER TABLE article_departments
    ADD COLUMN IF NOT EXISTS department_sector_id UUID REFERENCES department_sectors(id) ON DELETE SET NULL;

ALTER TABLE article_department_metadata
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS latin_name TEXT,
    ADD COLUMN IF NOT EXISTS fao_zone TEXT,
    ADD COLUMN IF NOT EXISTS sous_zone TEXT,
    ADD COLUMN IF NOT EXISTS engin TEXT,
    ADD COLUMN IF NOT EXISTS allergenes TEXT,
    ADD COLUMN IF NOT EXISTS raw_source JSONB;

CREATE INDEX IF NOT EXISTS idx_article_departments_sector_id
    ON article_departments(department_sector_id);

COMMIT;