BEGIN;

CREATE TABLE IF NOT EXISTS department_sectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    color_hex VARCHAR(20),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_department_sectors_department_code UNIQUE (department_id, code)
);

ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS ean VARCHAR(100),
    ADD COLUMN IF NOT EXISTS unit VARCHAR(50),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS source_origin VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE article_departments
    ADD COLUMN IF NOT EXISTS department_sector_id UUID REFERENCES department_sectors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE article_department_metadata
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS raw_source JSONB,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_articles_plu ON articles(plu);
CREATE INDEX IF NOT EXISTS idx_articles_designation ON articles(designation);
CREATE INDEX IF NOT EXISTS idx_article_departments_article_id ON article_departments(article_id);
CREATE INDEX IF NOT EXISTS idx_article_departments_department_id ON article_departments(department_id);
CREATE INDEX IF NOT EXISTS idx_article_departments_sector_id ON article_departments(department_sector_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_department_sectors_updated_at ON department_sectors;
CREATE TRIGGER trg_department_sectors_updated_at
BEFORE UPDATE ON department_sectors
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_articles_updated_at ON articles;
CREATE TRIGGER trg_articles_updated_at
BEFORE UPDATE ON articles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_article_departments_updated_at ON article_departments;
CREATE TRIGGER trg_article_departments_updated_at
BEFORE UPDATE ON article_departments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_article_department_metadata_updated_at ON article_department_metadata;
CREATE TRIGGER trg_article_department_metadata_updated_at
BEFORE UPDATE ON article_department_metadata
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;