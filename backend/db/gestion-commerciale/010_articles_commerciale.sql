BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. Familles produits
-- Ancien équivalent Rayon V2 : department_sectors
-- Ici utilisé comme familles produits :
-- Poisson entier, Filet, Crustacé, Coquillage, etc.
-- =========================================================

CREATE TABLE IF NOT EXISTS department_sectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    color_hex VARCHAR(20),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_department_sectors_department_code UNIQUE (department_id, code)
);

-- =========================================================
-- 2. Articles de base
-- Reprise Rayon V2 : PLU, désignation, EAN, unité, actif
-- =========================================================

CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    plu VARCHAR(50) NOT NULL,
    designation TEXT NOT NULL,
    ean VARCHAR(100),
    unit VARCHAR(50) NOT NULL DEFAULT 'kg',
    is_active BOOLEAN NOT NULL DEFAULT true,
    source_origin VARCHAR(50) DEFAULT 'manual',
    source_id VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_articles_store_plu UNIQUE (store_id, plu)
);

-- =========================================================
-- 3. Rattachement article / service
-- Ici on ajoute la TVA et les prix commerciaux
-- =========================================================

CREATE TABLE IF NOT EXISTS article_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    department_sector_id UUID REFERENCES department_sectors(id) ON DELETE SET NULL,

    display_name TEXT,
    purchase_unit VARCHAR(50),
    stock_unit VARCHAR(50),
    sale_unit VARCHAR(50),

    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 5.50,
    purchase_price_ex_vat NUMERIC(12,4),
    sale_price_ex_vat NUMERIC(12,4),
    sale_price_inc_vat NUMERIC(12,4),

    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_article_departments_article_department UNIQUE (article_id, department_id)
);

-- =========================================================
-- 4. Métadonnées métier produit de la mer
-- =========================================================

CREATE TABLE IF NOT EXISTS article_department_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_department_id UUID NOT NULL REFERENCES article_departments(id) ON DELETE CASCADE,

    field_key VARCHAR(100) NOT NULL DEFAULT 'business_metadata',
    field_value TEXT,

    category TEXT,
    latin_name TEXT,
    fao_zone TEXT,
    sous_zone TEXT,
    engin TEXT,
    allergenes TEXT,

    raw_source JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_article_department_metadata_key UNIQUE (article_department_id, field_key)
);

-- =========================================================
-- 5. Index
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_department_sectors_department_id
ON department_sectors(department_id);

CREATE INDEX IF NOT EXISTS idx_department_sectors_code
ON department_sectors(code);

CREATE INDEX IF NOT EXISTS idx_articles_store_id
ON articles(store_id);

CREATE INDEX IF NOT EXISTS idx_articles_plu
ON articles(plu);

CREATE INDEX IF NOT EXISTS idx_articles_designation
ON articles(designation);

CREATE INDEX IF NOT EXISTS idx_article_departments_article_id
ON article_departments(article_id);

CREATE INDEX IF NOT EXISTS idx_article_departments_department_id
ON article_departments(department_id);

CREATE INDEX IF NOT EXISTS idx_article_departments_sector_id
ON article_departments(department_sector_id);

CREATE INDEX IF NOT EXISTS idx_article_department_metadata_article_department_id
ON article_department_metadata(article_department_id);

-- =========================================================
-- 6. Trigger updated_at
-- =========================================================

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

-- =========================================================
-- 7. Seed familles produit pour tous les services existants
-- =========================================================

INSERT INTO department_sectors (
    department_id,
    code,
    name,
    description,
    color_hex,
    display_order
)
SELECT
    d.id,
    family.code,
    family.name,
    family.description,
    family.color_hex,
    family.display_order
FROM departments d
CROSS JOIN (
    VALUES
        ('POISSON_ENTIER', 'Poisson entier', 'Poissons vendus entiers ou vidés', '#005BAA', 10),
        ('FILET_POISSON', 'Filet de poisson', 'Filets, dos, pavés et portions de poisson', '#0077CC', 20),
        ('CRUSTACE', 'Crustacé', 'Crevettes, langoustines, crabes, homards, araignées', '#FF7A00', 30),
        ('COQUILLAGE', 'Coquillage', 'Huîtres, moules, palourdes, coques, coquilles', '#00A676', 40),
        ('CEPHALOPODE', 'Céphalopode', 'Encornets, seiches, poulpes, calamars', '#7B61FF', 50),
        ('PRODUIT_ELABORE', 'Produit élaboré', 'Produits préparés, transformés ou prêts à vendre', '#D97706', 60),
        ('AUTRE', 'Autre', 'Autres produits de la mer', '#6B7280', 999)
) AS family(code, name, description, color_hex, display_order)
ON CONFLICT (department_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    color_hex = EXCLUDED.color_hex,
    display_order = EXCLUDED.display_order,
    is_active = true,
    updated_at = NOW();

COMMIT;