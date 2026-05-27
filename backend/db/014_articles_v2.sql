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

CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plu VARCHAR(50) NOT NULL,
    designation TEXT NOT NULL,
    ean VARCHAR(100),
    unit VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT true,
    source_origin VARCHAR(50),
    source_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_articles_plu UNIQUE (plu)
);

CREATE TABLE IF NOT EXISTS article_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    department_sector_id UUID REFERENCES department_sectors(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_article_departments_article_department UNIQUE (article_id, department_id)
);

CREATE TABLE IF NOT EXISTS article_department_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_department_id UUID NOT NULL REFERENCES article_departments(id) ON DELETE CASCADE,
    nom_latin TEXT,
    category TEXT,
    zone TEXT,
    sous_zone TEXT,
    engin TEXT,
    allergenes TEXT,
    raw_source JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_article_department_metadata_unique UNIQUE (article_department_id)
);

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