/*
  030_enrich_articles_from_rayon_v2.sql

  Enrichissement des articles TRAD Gestion Commerciale depuis Rayon V2.

  Source : gestion_rayons
  Cible  : gestion_commerciale

  A lancer connecte a la base cible gestion_commerciale.

  Objectif :
  - enrichir les articles TRAD deja migres avec les infos metier Rayon V2 ;
  - matcher uniquement par store cible + PLU ;
  - ne pas modifier gestion_rayons ;
  - ne pas toucher fournisseurs / AF_MAP / achats / ventes ;
  - aucune suppression.

  Donnees reprises depuis Rayon V2 :
  - articles.latin_name
  - articles.fao_zone
  - articles.fao_subzone
  - articles.fishing_gear
  - articles.category
  - article_departments.display_name
  - article_departments.purchase_unit
  - article_departments.stock_unit
  - article_departments.sale_unit

  Filtre TRAD source :
    articles a
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
*/

BEGIN;

CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stores) THEN
    RAISE EXCEPTION 'Enrichissement impossible : aucun store cible dans gestion_commerciale.';
  END IF;
END;
$$;

-- =========================================================
-- 1. Ajouter les colonnes de detail si elles n'existent pas
-- =========================================================
-- Ces ALTER sont non destructifs.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS latin_name text,
  ADD COLUMN IF NOT EXISTS fao_zone text,
  ADD COLUMN IF NOT EXISTS sous_zone text,
  ADD COLUMN IF NOT EXISTS fishing_gear text,
  ADD COLUMN IF NOT EXISTS allergens text,
  ADD COLUMN IF NOT EXISTS production_method text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS purchase_unit text,
  ADD COLUMN IF NOT EXISTS stock_unit text,
  ADD COLUMN IF NOT EXISTS sale_unit text;

-- =========================================================
-- 2. Enrichir les articles TRAD deja presents en cible
-- =========================================================
-- On ne cree pas de nouveaux articles ici : la migration principale l'a deja fait.
-- On met a jour uniquement les articles dont le PLU existe en cible.

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
),
source_trad_articles AS (
  SELECT *
  FROM dblink(
    'host=localhost port=5432 dbname=gestion_rayons user=admin password=ChangeMoi_RayonV2_2026!',
    $$
      SELECT DISTINCT ON (a.plu)
        a.plu::text AS plu,
        a.latin_name::text AS latin_name,
        a.fao_zone::text AS fao_zone,
        a.fao_subzone::text AS sous_zone,
        a.fishing_gear::text AS fishing_gear,
        a.category::text AS production_method,
        ad.display_name::text AS display_name,
        ad.purchase_unit::text AS purchase_unit,
        ad.stock_unit::text AS stock_unit,
        ad.sale_unit::text AS sale_unit,
        a.updated_at,
        a.created_at
      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      JOIN department_sectors ds ON ds.id = ad.department_sector_id
      WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
        AND a.plu IS NOT NULL
        AND BTRIM(a.plu) <> ''
      ORDER BY
        a.plu,
        ad.updated_at DESC NULLS LAST,
        a.updated_at DESC NULLS LAST,
        a.created_at DESC NULLS LAST
    $$
  ) AS src (
    plu text,
    latin_name text,
    fao_zone text,
    sous_zone text,
    fishing_gear text,
    production_method text,
    display_name text,
    purchase_unit text,
    stock_unit text,
    sale_unit text,
    updated_at timestamptz,
    created_at timestamptz
  )
)
UPDATE articles target
SET
  latin_name = COALESCE(NULLIF(BTRIM(source_trad_articles.latin_name), ''), target.latin_name),
  fao_zone = COALESCE(NULLIF(BTRIM(source_trad_articles.fao_zone), ''), target.fao_zone),
  sous_zone = COALESCE(NULLIF(BTRIM(source_trad_articles.sous_zone), ''), target.sous_zone),
  fishing_gear = COALESCE(NULLIF(BTRIM(source_trad_articles.fishing_gear), ''), target.fishing_gear),
  production_method = COALESCE(NULLIF(BTRIM(source_trad_articles.production_method), ''), target.production_method),
  display_name = COALESCE(NULLIF(BTRIM(source_trad_articles.display_name), ''), target.display_name),
  purchase_unit = COALESCE(NULLIF(BTRIM(source_trad_articles.purchase_unit), ''), target.purchase_unit, target.unit),
  stock_unit = COALESCE(NULLIF(BTRIM(source_trad_articles.stock_unit), ''), target.stock_unit, target.unit),
  sale_unit = COALESCE(NULLIF(BTRIM(source_trad_articles.sale_unit), ''), target.sale_unit, target.unit),
  updated_at = now()
FROM source_trad_articles
JOIN target_store ON true
WHERE target.store_id = target_store.store_id
  AND target.plu = source_trad_articles.plu;

-- =========================================================
-- 3. Comptages de controle
-- =========================================================

SELECT 'articles_trad_source' AS controle, COUNT(*) AS total
FROM dblink(
  'host=localhost port=5432 dbname=gestion_rayons user=admin password=ChangeMoi_RayonV2_2026!',
  $$
    SELECT DISTINCT a.plu
    FROM articles a
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
      AND a.plu IS NOT NULL
      AND BTRIM(a.plu) <> ''
  $$
) AS src (plu text);

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
SELECT 'articles_cible_total' AS controle, COUNT(*) AS total
FROM articles a
JOIN target_store ts ON ts.store_id = a.store_id;

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
SELECT 'articles_cible_avec_latin' AS controle, COUNT(*) AS total
FROM articles a
JOIN target_store ts ON ts.store_id = a.store_id
WHERE NULLIF(BTRIM(COALESCE(a.latin_name, '')), '') IS NOT NULL;

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
SELECT 'articles_cible_avec_fao' AS controle, COUNT(*) AS total
FROM articles a
JOIN target_store ts ON ts.store_id = a.store_id
WHERE NULLIF(BTRIM(COALESCE(a.fao_zone, '')), '') IS NOT NULL;

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
SELECT
  'echantillon_articles_enrichis' AS controle,
  plu,
  designation,
  latin_name,
  fao_zone,
  sous_zone,
  fishing_gear,
  purchase_unit,
  stock_unit,
  sale_unit
FROM articles a
JOIN target_store ts ON ts.store_id = a.store_id
WHERE
  NULLIF(BTRIM(COALESCE(a.latin_name, '')), '') IS NOT NULL
  OR NULLIF(BTRIM(COALESCE(a.fao_zone, '')), '') IS NOT NULL
ORDER BY designation
LIMIT 20;

COMMIT;