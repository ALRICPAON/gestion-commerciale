-- Copie le referentiel articles depuis gestion_commerciale vers la base cliente courante.
-- A executer uniquement sur une base cliente dediee, jamais sur la base source gestion_commerciale.
--
-- Copie uniquement :
--   - department_sectors
--   - articles
--   - article_departments
--   - article_department_metadata (field_key = 'v2_import')
--
-- Ne copie pas les achats, stock, lots, mouvements, ventes, inventaires.
-- Les liens departments sont reconstruits par code rayon, pas par UUID source.

\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
DECLARE
  missing_tables text[];
  missing_columns text[];
BEGIN
  IF current_database() = 'gestion_commerciale' THEN
    RAISE EXCEPTION 'Script refuse sur la base source gestion_commerciale';
  END IF;

  SELECT array_agg(required.table_name)
  INTO missing_tables
  FROM (
    VALUES
      ('stores'),
      ('departments'),
      ('department_sectors'),
      ('articles'),
      ('article_departments'),
      ('article_department_metadata')
  ) AS required(table_name)
  WHERE to_regclass('public.' || required.table_name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Tables manquantes dans la base courante : %', missing_tables;
  END IF;

  SELECT array_agg(required.table_name || '.' || required.column_name)
  INTO missing_columns
  FROM (
    VALUES
      ('stores', 'id'),
      ('stores', 'code'),
      ('stores', 'client_key'),
      ('departments', 'id'),
      ('departments', 'store_id'),
      ('departments', 'code'),
      ('department_sectors', 'id'),
      ('department_sectors', 'department_id'),
      ('department_sectors', 'code'),
      ('department_sectors', 'name'),
      ('department_sectors', 'description'),
      ('department_sectors', 'color_hex'),
      ('department_sectors', 'display_order'),
      ('department_sectors', 'is_active'),
      ('articles', 'id'),
      ('articles', 'store_id'),
      ('articles', 'plu'),
      ('articles', 'designation'),
      ('articles', 'ean'),
      ('articles', 'unit'),
      ('articles', 'is_active'),
      ('articles', 'source_origin'),
      ('articles', 'source_id'),
      ('article_departments', 'id'),
      ('article_departments', 'article_id'),
      ('article_departments', 'department_id'),
      ('article_departments', 'display_name'),
      ('article_departments', 'purchase_unit'),
      ('article_departments', 'stock_unit'),
      ('article_departments', 'sale_unit'),
      ('article_departments', 'is_active'),
      ('article_departments', 'department_sector_id'),
      ('article_department_metadata', 'id'),
      ('article_department_metadata', 'article_department_id'),
      ('article_department_metadata', 'field_key'),
      ('article_department_metadata', 'field_value'),
      ('article_department_metadata', 'category'),
      ('article_department_metadata', 'latin_name'),
      ('article_department_metadata', 'fao_zone'),
      ('article_department_metadata', 'sous_zone'),
      ('article_department_metadata', 'engin'),
      ('article_department_metadata', 'allergenes'),
      ('article_department_metadata', 'raw_source')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Colonnes manquantes dans la base courante : %', missing_columns;
  END IF;
END $$;

CREATE TEMP TABLE _target_store ON COMMIT DROP AS
SELECT id, code, client_key
FROM stores
WHERE client_key IS NOT NULL
  AND client_key <> ''
  AND client_key <> 'default';

DO $$
DECLARE
  target_store_count integer;
BEGIN
  SELECT COUNT(*) INTO target_store_count FROM _target_store;

  IF target_store_count <> 1 THEN
    RAISE EXCEPTION 'La base cliente doit contenir exactement un magasin client_key non-default, trouve : %',
      target_store_count;
  END IF;
END $$;

CREATE TEMP TABLE _target_departments ON COMMIT DROP AS
SELECT d.id, d.code
FROM departments d
JOIN _target_store s ON s.id = d.store_id
WHERE d.code <> 'PRINC';

CREATE TEMP TABLE _src_department_sectors (
  department_code text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  color_hex text,
  display_order integer,
  is_active boolean
) ON COMMIT DROP;

INSERT INTO _src_department_sectors
SELECT *
FROM dblink(
  'dbname=gestion_commerciale user=admin',
  $SQL$
    SELECT
      d.code AS department_code,
      ds.code,
      ds.name,
      ds.description,
      ds.color_hex,
      ds.display_order,
      ds.is_active
    FROM department_sectors ds
    JOIN departments d ON d.id = ds.department_id
    WHERE d.code <> 'PRINC'
      AND ds.code IS NOT NULL
  $SQL$
) AS src(
  department_code text,
  code text,
  name text,
  description text,
  color_hex text,
  display_order integer,
  is_active boolean
);

CREATE TEMP TABLE _src_article_departments (
  plu text NOT NULL,
  department_code text NOT NULL,
  display_name text,
  purchase_unit text,
  stock_unit text,
  sale_unit text,
  is_active boolean,
  sector_code text
) ON COMMIT DROP;

INSERT INTO _src_article_departments
SELECT *
FROM dblink(
  'dbname=gestion_commerciale user=admin',
  $SQL$
    SELECT DISTINCT ON (a.plu, d.code)
      a.plu,
      d.code AS department_code,
      ad.display_name,
      ad.purchase_unit,
      ad.stock_unit,
      ad.sale_unit,
      ad.is_active,
      ds.code AS sector_code
    FROM article_departments ad
    JOIN articles a ON a.id = ad.article_id
    JOIN departments d ON d.id = ad.department_id
    LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE a.plu IS NOT NULL
      AND btrim(a.plu) <> ''
      AND d.code <> 'PRINC'
    ORDER BY a.plu, d.code, ad.updated_at DESC NULLS LAST, ad.created_at DESC NULLS LAST
  $SQL$
) AS src(
  plu text,
  department_code text,
  display_name text,
  purchase_unit text,
  stock_unit text,
  sale_unit text,
  is_active boolean,
  sector_code text
);

CREATE TEMP TABLE _src_articles (
  plu text NOT NULL,
  designation text NOT NULL,
  ean text,
  unit text,
  is_active boolean,
  source_origin text,
  source_id text
) ON COMMIT DROP;

INSERT INTO _src_articles
SELECT *
FROM dblink(
  'dbname=gestion_commerciale user=admin',
  $SQL$
    SELECT DISTINCT ON (a.plu)
      a.plu,
      a.designation,
      a.ean,
      a.unit,
      a.is_active,
      a.source_origin,
      a.source_id
    FROM articles a
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN departments d ON d.id = ad.department_id
    WHERE a.plu IS NOT NULL
      AND btrim(a.plu) <> ''
      AND d.code <> 'PRINC'
    ORDER BY a.plu, a.updated_at DESC NULLS LAST, a.created_at DESC NULLS LAST
  $SQL$
) AS src(
  plu text,
  designation text,
  ean text,
  unit text,
  is_active boolean,
  source_origin text,
  source_id text
);

CREATE TEMP TABLE _src_metadata (
  plu text NOT NULL,
  department_code text NOT NULL,
  field_key text NOT NULL,
  field_value text,
  category text,
  latin_name text,
  fao_zone text,
  sous_zone text,
  engin text,
  allergenes text,
  raw_source jsonb
) ON COMMIT DROP;

INSERT INTO _src_metadata
SELECT *
FROM dblink(
  'dbname=gestion_commerciale user=admin',
  $SQL$
    SELECT DISTINCT ON (a.plu, d.code, adm.field_key)
      a.plu,
      d.code AS department_code,
      adm.field_key,
      adm.field_value,
      adm.category,
      adm.latin_name,
      adm.fao_zone,
      adm.sous_zone,
      adm.engin,
      adm.allergenes,
      adm.raw_source
    FROM article_department_metadata adm
    JOIN article_departments ad ON ad.id = adm.article_department_id
    JOIN articles a ON a.id = ad.article_id
    JOIN departments d ON d.id = ad.department_id
    WHERE a.plu IS NOT NULL
      AND btrim(a.plu) <> ''
      AND d.code <> 'PRINC'
      AND adm.field_key = 'v2_import'
    ORDER BY a.plu, d.code, adm.field_key, adm.updated_at DESC NULLS LAST, adm.created_at DESC NULLS LAST
  $SQL$
) AS src(
  plu text,
  department_code text,
  field_key text,
  field_value text,
  category text,
  latin_name text,
  fao_zone text,
  sous_zone text,
  engin text,
  allergenes text,
  raw_source jsonb
);

UPDATE department_sectors ds
SET
  name = CASE WHEN btrim(ds.name) = '' THEN src.name ELSE ds.name END,
  description = COALESCE(ds.description, src.description),
  color_hex = COALESCE(ds.color_hex, src.color_hex)
FROM _src_department_sectors src
JOIN _target_departments td ON td.code = src.department_code
WHERE ds.department_id = td.id
  AND ds.code = src.code;

INSERT INTO department_sectors (
  id,
  department_id,
  code,
  name,
  description,
  color_hex,
  display_order,
  is_active
)
SELECT
  gen_random_uuid(),
  td.id,
  src.code,
  src.name,
  src.description,
  src.color_hex,
  COALESCE(src.display_order, 0),
  COALESCE(src.is_active, true)
FROM _src_department_sectors src
JOIN _target_departments td ON td.code = src.department_code
WHERE NOT EXISTS (
  SELECT 1
  FROM department_sectors ds
  WHERE ds.department_id = td.id
    AND ds.code = src.code
);

UPDATE articles a
SET
  designation = COALESCE(NULLIF(a.designation, ''), src.designation),
  ean = COALESCE(NULLIF(a.ean, ''), src.ean),
  unit = COALESCE(NULLIF(a.unit, ''), src.unit, 'kg'),
  source_origin = COALESCE(a.source_origin, src.source_origin, 'historical_copy'),
  source_id = COALESCE(a.source_id, src.source_id)
FROM _src_articles src
CROSS JOIN _target_store ts
WHERE a.store_id = ts.id
  AND a.plu = src.plu
  AND EXISTS (
    SELECT 1
    FROM _src_article_departments sad
    JOIN _target_departments td ON td.code = sad.department_code
    WHERE sad.plu = src.plu
  );

INSERT INTO articles (
  id,
  store_id,
  plu,
  designation,
  ean,
  unit,
  is_active,
  source_origin,
  source_id
)
SELECT
  gen_random_uuid(),
  ts.id,
  src.plu,
  src.designation,
  src.ean,
  COALESCE(src.unit, 'kg'),
  COALESCE(src.is_active, true),
  COALESCE(src.source_origin, 'historical_copy'),
  src.source_id
FROM _src_articles src
CROSS JOIN _target_store ts
WHERE EXISTS (
    SELECT 1
    FROM _src_article_departments sad
    JOIN _target_departments td ON td.code = sad.department_code
    WHERE sad.plu = src.plu
  )
  AND NOT EXISTS (
    SELECT 1
    FROM articles a
    WHERE a.store_id = ts.id
      AND a.plu = src.plu
  );

UPDATE article_departments ad
SET
  display_name = COALESCE(NULLIF(ad.display_name, ''), src.display_name),
  purchase_unit = COALESCE(NULLIF(ad.purchase_unit, ''), src.purchase_unit),
  stock_unit = COALESCE(NULLIF(ad.stock_unit, ''), src.stock_unit),
  sale_unit = COALESCE(NULLIF(ad.sale_unit, ''), src.sale_unit),
  department_sector_id = COALESCE(ad.department_sector_id, ds.id)
FROM _src_article_departments src
JOIN _target_departments td ON td.code = src.department_code
CROSS JOIN _target_store ts
JOIN articles a ON a.store_id = ts.id AND a.plu = src.plu
LEFT JOIN department_sectors ds ON ds.department_id = td.id AND ds.code = src.sector_code
WHERE ad.article_id = a.id
  AND ad.department_id = td.id;

INSERT INTO article_departments (
  id,
  article_id,
  department_id,
  display_name,
  purchase_unit,
  stock_unit,
  sale_unit,
  is_active,
  department_sector_id
)
SELECT
  gen_random_uuid(),
  a.id,
  td.id,
  src.display_name,
  src.purchase_unit,
  src.stock_unit,
  src.sale_unit,
  COALESCE(src.is_active, true),
  ds.id
FROM _src_article_departments src
JOIN _target_departments td ON td.code = src.department_code
CROSS JOIN _target_store ts
JOIN articles a ON a.store_id = ts.id AND a.plu = src.plu
LEFT JOIN department_sectors ds ON ds.department_id = td.id AND ds.code = src.sector_code
WHERE NOT EXISTS (
  SELECT 1
  FROM article_departments ad
  WHERE ad.article_id = a.id
    AND ad.department_id = td.id
);

WITH mapped_metadata AS (
  SELECT
    ad.id AS article_department_id,
    src.field_key,
    src.field_value,
    src.category,
    src.latin_name,
    src.fao_zone,
    src.sous_zone,
    src.engin,
    src.allergenes,
    COALESCE(src.raw_source, '{}'::jsonb) AS raw_source
  FROM _src_metadata src
  JOIN _target_departments td ON td.code = src.department_code
  CROSS JOIN _target_store ts
  JOIN articles a ON a.store_id = ts.id AND a.plu = src.plu
  JOIN article_departments ad ON ad.article_id = a.id AND ad.department_id = td.id
)
UPDATE article_department_metadata adm
SET
  field_value = COALESCE(adm.field_value, mapped.field_value),
  category = COALESCE(NULLIF(adm.category, ''), mapped.category),
  latin_name = COALESCE(NULLIF(adm.latin_name, ''), mapped.latin_name),
  fao_zone = COALESCE(NULLIF(adm.fao_zone, ''), mapped.fao_zone),
  sous_zone = COALESCE(NULLIF(adm.sous_zone, ''), mapped.sous_zone),
  engin = COALESCE(NULLIF(adm.engin, ''), mapped.engin),
  allergenes = COALESCE(NULLIF(adm.allergenes, ''), mapped.allergenes),
  raw_source = CASE
    WHEN adm.raw_source IS NULL OR adm.raw_source = '{}'::jsonb THEN mapped.raw_source
    ELSE adm.raw_source
  END
FROM mapped_metadata mapped
WHERE adm.article_department_id = mapped.article_department_id
  AND adm.field_key = mapped.field_key;

WITH mapped_metadata AS (
  SELECT
    ad.id AS article_department_id,
    src.field_key,
    src.field_value,
    src.category,
    src.latin_name,
    src.fao_zone,
    src.sous_zone,
    src.engin,
    src.allergenes,
    COALESCE(src.raw_source, '{}'::jsonb) AS raw_source
  FROM _src_metadata src
  JOIN _target_departments td ON td.code = src.department_code
  CROSS JOIN _target_store ts
  JOIN articles a ON a.store_id = ts.id AND a.plu = src.plu
  JOIN article_departments ad ON ad.article_id = a.id AND ad.department_id = td.id
)
INSERT INTO article_department_metadata (
  id,
  article_department_id,
  field_key,
  field_value,
  category,
  latin_name,
  fao_zone,
  sous_zone,
  engin,
  allergenes,
  raw_source
)
SELECT
  gen_random_uuid(),
  mapped.article_department_id,
  mapped.field_key,
  mapped.field_value,
  mapped.category,
  mapped.latin_name,
  mapped.fao_zone,
  mapped.sous_zone,
  mapped.engin,
  mapped.allergenes,
  mapped.raw_source
FROM mapped_metadata mapped
WHERE NOT EXISTS (
  SELECT 1
  FROM article_department_metadata adm
  WHERE adm.article_department_id = mapped.article_department_id
);

DO $$
DECLARE
  mapped_articles integer;
  mapped_links integer;
  skipped_links integer;
BEGIN
  SELECT COUNT(DISTINCT sad.plu)
  INTO mapped_articles
  FROM _src_article_departments sad
  JOIN _target_departments td ON td.code = sad.department_code;

  SELECT COUNT(*)
  INTO mapped_links
  FROM _src_article_departments sad
  JOIN _target_departments td ON td.code = sad.department_code;

  SELECT COUNT(*)
  INTO skipped_links
  FROM _src_article_departments sad
  WHERE NOT EXISTS (
    SELECT 1
    FROM _target_departments td
    WHERE td.code = sad.department_code
  );

  RAISE NOTICE 'Copie referentiel articles terminee : articles source mappables=%, liens rayon mappables=%, liens ignores sans rayon cible=%',
    mapped_articles,
    mapped_links,
    skipped_links;
END $$;

COMMIT;
