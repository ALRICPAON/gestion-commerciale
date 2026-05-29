/*
  Migration Rayon V2 -> Gestion Commerciale, referentiel TRAD uniquement

  Source : gestion_rayons
  Cible  : gestion_commerciale

  A RELIRE AVANT EXECUTION.
  Ce script doit etre lance connecte a la base cible gestion_commerciale.
  Il ne modifie jamais gestion_rayons : toutes les lectures source passent par dblink.

  Objectif strict :
  - migrer les fournisseurs vers le store cible Gestion Commerciale ;
  - migrer uniquement les articles TRAD ;
  - migrer uniquement les AF_MAP dont l'article source est TRAD ;
  - ne jamais reprendre les UUID store_id, department_id ou department_sector_id Rayon V2.

  Filtre TRAD Rayon V2 :
    articles a
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'

  Principe de rapprochement cible :
  - fournisseurs : store cible + code fournisseur ;
  - articles : store cible + PLU ;
  - AF_MAP : code fournisseur + PLU article + supplier_ref.

  Securite :
  - aucune suppression de donnees ni destruction de structure ;
  - aucune insertion dans article_departments ni department_sectors ;
  - INSERT ... SELECT uniquement ;
  - ON CONFLICT DO UPDATE controle ;
  - les PLU et supplier_ref restent en texte, aucune conversion numerique.

  Si dblink('dbname=gestion_rayons') ne suffit pas sur le VPS, remplacer cette
  chaine par une connexion complete, par exemple :
  'host=localhost port=5432 dbname=gestion_rayons user=admin password=password'
*/

BEGIN;

CREATE EXTENSION IF NOT EXISTS dblink;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Le store cible est le premier store Gestion Commerciale cree.
-- Adapter l'ORDER BY ou ajouter un WHERE code/client_key si plusieurs stores existent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stores) THEN
    RAISE EXCEPTION 'Migration Rayon V2 impossible : aucun store cible dans gestion_commerciale.';
  END IF;
END;
$$;

-- =========================================================
-- 1. Fournisseurs
-- =========================================================
-- Tous les fournisseurs source sont copies dans le store cible Gestion Commerciale.
-- Le store_id Rayon V2 n'est jamais reutilise.

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
INSERT INTO suppliers (
  store_id,
  code,
  name,
  supplier_type,
  status,
  contact_name,
  phone,
  email,
  address_line1,
  created_at,
  updated_at
)
SELECT
  target_store.store_id,
  src.code,
  src.name,
  'standard',
  CASE WHEN COALESCE(src.is_active, true) THEN 'active' ELSE 'inactive' END,
  src.contact_name,
  src.phone,
  src.email,
  src.address,
  COALESCE(src.created_at, now()),
  now()
FROM target_store
CROSS JOIN dblink(
  'dbname=gestion_rayons',
  $$
    SELECT code, name, contact_name, phone, email, address, is_active, created_at
    FROM suppliers
    WHERE code IS NOT NULL
      AND BTRIM(code) <> ''
  $$
) AS src (
  code varchar(50),
  name varchar(255),
  contact_name varchar(255),
  phone varchar(50),
  email varchar(255),
  address text,
  is_active boolean,
  created_at timestamptz
)
ON CONFLICT (store_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  contact_name = EXCLUDED.contact_name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  address_line1 = EXCLUDED.address_line1,
  status = EXCLUDED.status,
  updated_at = now();

-- =========================================================
-- 2. Articles TRAD uniquement
-- =========================================================
-- Le store_id Rayon V2 n'est jamais reutilise.
-- La trace de l'article source est conservee dans source_origin/source_id.

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
INSERT INTO articles (
  store_id,
  plu,
  designation,
  ean,
  unit,
  is_active,
  source_origin,
  source_id,
  created_at,
  updated_at
)
SELECT DISTINCT ON (target_store.store_id, src.plu)
  target_store.store_id,
  src.plu,
  src.designation,
  src.ean,
  COALESCE(src.unit, 'kg'),
  COALESCE(src.is_active, true),
  COALESCE(src.source_origin, 'rayon_v2'),
  COALESCE(src.source_id, src.source_article_id::text),
  COALESCE(src.created_at, now()),
  COALESCE(src.updated_at, src.created_at, now())
FROM target_store
CROSS JOIN dblink(
  'dbname=gestion_rayons',
  $$
    SELECT DISTINCT ON (a.plu)
      a.id AS source_article_id,
      a.plu,
      a.designation,
      a.ean,
      a.unit,
      a.is_active,
      a.source_origin,
      a.source_id,
      a.created_at,
      a.updated_at
    FROM articles a
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
      AND a.plu IS NOT NULL
      AND BTRIM(a.plu) <> ''
    ORDER BY a.plu, a.updated_at DESC NULLS LAST, a.created_at DESC NULLS LAST
  $$
) AS src (
  source_article_id uuid,
  plu varchar(50),
  designation text,
  ean varchar(100),
  unit varchar(50),
  is_active boolean,
  source_origin varchar(50),
  source_id varchar(100),
  created_at timestamptz,
  updated_at timestamptz
)
ORDER BY target_store.store_id, src.plu, src.updated_at DESC NULLS LAST, src.created_at DESC NULLS LAST
ON CONFLICT (store_id, plu) DO UPDATE SET
  designation = EXCLUDED.designation,
  ean = EXCLUDED.ean,
  unit = EXCLUDED.unit,
  is_active = EXCLUDED.is_active,
  source_origin = EXCLUDED.source_origin,
  source_id = EXCLUDED.source_id,
  updated_at = now();

-- =========================================================
-- 3. AF_MAP TRAD uniquement
-- =========================================================
-- Le mapping est reconstruit avec les IDs cible :
-- suppliers.code + articles.plu dans le store Gestion Commerciale.
-- supplier_ref est conserve tel quel, sans cast numerique.

WITH target_store AS (
  SELECT id AS store_id, client_key
  FROM stores
  ORDER BY created_at
  LIMIT 1
),
source_mappings AS (
  SELECT
    supplier_code,
    article_plu,
    supplier_ref,
    supplier_label,
    purchase_unit,
    is_active,
    created_at
  FROM dblink(
    'dbname=gestion_rayons',
    $$
      SELECT DISTINCT ON (s.code, a.plu, m.supplier_ref)
        s.code AS supplier_code,
        a.plu AS article_plu,
        m.supplier_ref::text AS supplier_ref,
        m.supplier_label,
        m.purchase_unit,
        m.is_active,
        m.created_at
      FROM supplier_article_mappings m
      JOIN suppliers s ON s.id = m.supplier_id
      JOIN articles a ON a.id = m.article_id
      JOIN article_departments ad ON ad.article_id = a.id
      JOIN department_sectors ds ON ds.id = ad.department_sector_id
      WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
        AND s.code IS NOT NULL
        AND BTRIM(s.code) <> ''
        AND a.plu IS NOT NULL
        AND BTRIM(a.plu) <> ''
        AND m.supplier_ref IS NOT NULL
        AND BTRIM(m.supplier_ref::text) <> ''
      ORDER BY s.code, a.plu, m.supplier_ref, m.created_at DESC NULLS LAST
    $$
  ) AS src (
    supplier_code varchar(50),
    article_plu varchar(50),
    supplier_ref text,
    supplier_label varchar(255),
    purchase_unit varchar(50),
    is_active boolean,
    created_at timestamptz
  )
)
INSERT INTO supplier_article_mappings (
  store_id,
  client_key,
  supplier_id,
  article_id,
  supplier_ref,
  supplier_label,
  purchase_unit,
  price_unit,
  is_active,
  created_at,
  updated_at
)
SELECT
  target_store.store_id,
  target_store.client_key,
  target_supplier.id,
  target_article.id,
  source_mappings.supplier_ref,
  source_mappings.supplier_label,
  COALESCE(source_mappings.purchase_unit, 'kg'),
  'kg',
  COALESCE(source_mappings.is_active, true),
  COALESCE(source_mappings.created_at, now()),
  now()
FROM source_mappings
JOIN target_store ON true
JOIN suppliers target_supplier
  ON target_supplier.store_id = target_store.store_id
 AND target_supplier.code = source_mappings.supplier_code
JOIN articles target_article
  ON target_article.store_id = target_store.store_id
 AND target_article.plu = source_mappings.article_plu
ON CONFLICT (supplier_id, supplier_ref) DO UPDATE SET
  article_id = EXCLUDED.article_id,
  supplier_label = EXCLUDED.supplier_label,
  purchase_unit = EXCLUDED.purchase_unit,
  price_unit = EXCLUDED.price_unit,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- =========================================================
-- 4. Comptages de controle
-- =========================================================
-- Ces SELECT ne modifient rien. articles_trad_migrables doit etre proche de 593
-- sur le VPS de reference.

SELECT 'fournisseurs_migrables' AS controle, COUNT(*) AS total
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT code
    FROM suppliers
    WHERE code IS NOT NULL
      AND BTRIM(code) <> ''
  $$
) AS src (code varchar(50));

SELECT 'articles_trad_migrables' AS controle, COUNT(DISTINCT id) AS total
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT a.id
    FROM articles a
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
      AND a.plu IS NOT NULL
      AND BTRIM(a.plu) <> ''
  $$
) AS src (id uuid);

SELECT 'af_map_trad_migrables' AS controle, COUNT(*) AS total
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT DISTINCT s.code, a.plu, m.supplier_ref::text
    FROM supplier_article_mappings m
    JOIN suppliers s ON s.id = m.supplier_id
    JOIN articles a ON a.id = m.article_id
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
      AND s.code IS NOT NULL
      AND BTRIM(s.code) <> ''
      AND a.plu IS NOT NULL
      AND BTRIM(a.plu) <> ''
      AND m.supplier_ref IS NOT NULL
      AND BTRIM(m.supplier_ref::text) <> ''
  $$
) AS src (supplier_code varchar(50), article_plu varchar(50), supplier_ref text);

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
SELECT 'fournisseurs_en_cible' AS controle, COUNT(*) AS total
FROM suppliers s
JOIN target_store ON target_store.store_id = s.store_id;

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
SELECT 'articles_en_cible' AS controle, COUNT(*) AS total
FROM articles a
JOIN target_store ON target_store.store_id = a.store_id;

WITH target_store AS (
  SELECT id AS store_id
  FROM stores
  ORDER BY created_at
  LIMIT 1
)
SELECT 'af_map_en_cible' AS controle, COUNT(*) AS total
FROM supplier_article_mappings m
JOIN target_store ON target_store.store_id = m.store_id;

COMMIT;
