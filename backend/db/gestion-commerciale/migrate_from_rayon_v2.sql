/*
  Migration Rayon V2 -> Gestion Commerciale, filtre TRAD uniquement

  Source : gestion_rayons
  Cible  : gestion_commerciale

  A RELIRE AVANT EXECUTION.
  Ce script doit etre lance connecte a la base cible gestion_commerciale.
  Il ne modifie jamais gestion_rayons : toutes les lectures source passent par dblink.

  Objectif strict :
  - migrer les fournisseurs ;
  - migrer uniquement les articles TRAD ;
  - migrer uniquement les rattachements/metadonnees lies au secteur TRAD ;
  - migrer uniquement les AF_MAP dont article_id pointe vers un article TRAD migre.

  Ne migre pas les articles LS / EMB / SCE / FE / EAN sauf s'ils sont explicitement
  rattaches au secteur TRAD dans Rayon V2.

  Inspection locale Rayon V2 realisee le 2026-05-29 :
  - articles : id, store_id, plu, designation, unit, category, latin_name,
    fao_zone, fao_subzone, fishing_gear, ean, is_active, source_origin,
    source_id, created_at, updated_at
  - article_departments : id, article_id, department_id, department_sector_id,
    display_name, purchase_unit, stock_unit, sale_unit, is_active, created_at,
    updated_at
  - article_department_metadata : article_department_id, field_key, field_value,
    category, nom_latin, latin_name, zone, fao_zone, sous_zone, engin,
    allergenes, raw_source, created_at, updated_at
  - department_sectors : id, department_id, code, name, ...
  - supplier_article_mappings : id, supplier_id, article_id, supplier_ref,
    supplier_label, purchase_unit, conversion_to_stock, is_active, created_at
  - suppliers : id, store_id, code, name, contact_name, phone, email, address,
    is_active, created_at

  Pre-requis cote cible :
  - stores, departments et department_sectors doivent deja exister dans
    gestion_commerciale avec les ids source correspondants, car suppliers,
    articles et article_departments portent des FK vers ces tables.
  - supplier_article_mappings doit exister avec la structure Gestion Commerciale.
  - Si dblink('dbname=gestion_rayons') ne suffit pas sur le VPS, remplacer cette
    chaine par une connexion complete, par exemple :
    'host=localhost port=5432 dbname=gestion_rayons user=admin password=password'

  Securite :
  - aucune suppression de donnees ni destruction de structure ;
  - INSERT ... SELECT uniquement ;
  - ON CONFLICT DO UPDATE/DO NOTHING controle ;
  - les PLU et supplier_ref restent en texte, aucune conversion numerique.
*/

BEGIN;

CREATE EXTENSION IF NOT EXISTS dblink;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. Fournisseurs
-- =========================================================
-- Les fournisseurs sont copies sans ecrasement dangereux : les champs utiles
-- sont rafraichis, mais aucun fournisseur cible n'est supprime.

INSERT INTO suppliers (
  id,
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
  src.id,
  src.store_id,
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
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT id, store_id, code, name, contact_name, phone, email, address, is_active, created_at
    FROM suppliers
  $$
) AS src (
  id uuid,
  store_id uuid,
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
-- Un article est considere TRAD uniquement si son rattachement source pointe
-- vers department_sectors.code = 'TRAD'. Les colonnes articles.category et
-- article_department_metadata ne sont pas utilisees pour filtrer.

INSERT INTO articles (
  id,
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
SELECT DISTINCT ON (src.id)
  src.id,
  src.store_id,
  src.plu,
  src.designation,
  src.ean,
  COALESCE(src.unit, 'kg'),
  COALESCE(src.is_active, true),
  COALESCE(src.source_origin, 'rayon_v2'),
  COALESCE(src.source_id, src.id::text),
  COALESCE(src.created_at, now()),
  COALESCE(src.updated_at, src.created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT
      a.id,
      a.store_id,
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
  $$
) AS src (
  id uuid,
  store_id uuid,
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
ON CONFLICT (store_id, plu) DO UPDATE SET
  designation = EXCLUDED.designation,
  ean = EXCLUDED.ean,
  unit = EXCLUDED.unit,
  is_active = EXCLUDED.is_active,
  source_origin = EXCLUDED.source_origin,
  source_id = EXCLUDED.source_id,
  updated_at = now();

-- =========================================================
-- 3. Rattachements article/service TRAD uniquement
-- =========================================================
-- Necessaire pour que les articles TRAD restent visibles/filtrables dans les
-- ecrans Gestion Commerciale. Les rattachements non TRAD sont ignores.

INSERT INTO article_departments (
  id,
  article_id,
  department_id,
  department_sector_id,
  display_name,
  purchase_unit,
  stock_unit,
  sale_unit,
  is_active,
  created_at,
  updated_at
)
SELECT
  src.id,
  src.article_id,
  src.department_id,
  src.department_sector_id,
  src.display_name,
  src.purchase_unit,
  src.stock_unit,
  src.sale_unit,
  COALESCE(src.is_active, true),
  COALESCE(src.created_at, now()),
  COALESCE(src.updated_at, src.created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT
      ad.id,
      ad.article_id,
      ad.department_id,
      ad.department_sector_id,
      ad.display_name,
      ad.purchase_unit,
      ad.stock_unit,
      ad.sale_unit,
      ad.is_active,
      ad.created_at,
      ad.updated_at
    FROM article_departments ad
    JOIN articles a ON a.id = ad.article_id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
  $$
) AS src (
  id uuid,
  article_id uuid,
  department_id uuid,
  department_sector_id uuid,
  display_name text,
  purchase_unit varchar(50),
  stock_unit varchar(50),
  sale_unit varchar(50),
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
JOIN articles a ON a.id = src.article_id
ON CONFLICT (article_id, department_id) DO UPDATE SET
  department_sector_id = EXCLUDED.department_sector_id,
  display_name = EXCLUDED.display_name,
  purchase_unit = EXCLUDED.purchase_unit,
  stock_unit = EXCLUDED.stock_unit,
  sale_unit = EXCLUDED.sale_unit,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- =========================================================
-- 4. Metadonnees TRAD uniquement
-- =========================================================

INSERT INTO article_department_metadata (
  article_department_id,
  field_key,
  field_value,
  category,
  latin_name,
  fao_zone,
  sous_zone,
  engin,
  allergenes,
  raw_source,
  created_at,
  updated_at
)
SELECT
  target_ad.id,
  COALESCE(src.field_key, 'business_metadata'),
  src.field_value,
  src.category,
  COALESCE(src.latin_name, src.nom_latin),
  COALESCE(src.fao_zone, src.zone),
  src.sous_zone,
  src.engin,
  src.allergenes,
  COALESCE(src.raw_source, '{}'::jsonb),
  COALESCE(src.created_at, now()),
  COALESCE(src.updated_at, src.created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT
      adm.article_department_id,
      ad.article_id,
      ad.department_id,
      adm.field_key,
      adm.field_value,
      adm.category,
      adm.latin_name,
      adm.nom_latin,
      adm.fao_zone,
      adm.zone,
      adm.sous_zone,
      adm.engin,
      adm.allergenes,
      adm.raw_source,
      adm.created_at,
      adm.updated_at
    FROM article_department_metadata adm
    JOIN article_departments ad ON ad.id = adm.article_department_id
    JOIN articles a ON a.id = ad.article_id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
  $$
) AS src (
  article_department_id uuid,
  article_id uuid,
  department_id uuid,
  field_key varchar(100),
  field_value text,
  category text,
  latin_name text,
  nom_latin text,
  fao_zone text,
  zone text,
  sous_zone text,
  engin text,
  allergenes text,
  raw_source jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
JOIN article_departments target_ad
  ON target_ad.article_id = src.article_id
 AND target_ad.department_id = src.department_id
ON CONFLICT (article_department_id, field_key) DO UPDATE SET
  field_value = EXCLUDED.field_value,
  category = EXCLUDED.category,
  latin_name = EXCLUDED.latin_name,
  fao_zone = EXCLUDED.fao_zone,
  sous_zone = EXCLUDED.sous_zone,
  engin = EXCLUDED.engin,
  allergenes = EXCLUDED.allergenes,
  raw_source = EXCLUDED.raw_source,
  updated_at = now();

-- =========================================================
-- 5. AF_MAP TRAD uniquement
-- =========================================================
-- Les references fournisseur sont conservees telles quelles : supplier_ref est
-- lu et insere en varchar/text, sans conversion numerique.

INSERT INTO supplier_article_mappings (
  id,
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
  src.id,
  s.store_id,
  st.client_key,
  src.supplier_id,
  src.article_id,
  src.supplier_ref,
  src.supplier_label,
  COALESCE(src.purchase_unit, 'kg'),
  'kg',
  COALESCE(src.is_active, true),
  COALESCE(src.created_at, now()),
  now()
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT DISTINCT ON (m.id)
      m.id,
      m.supplier_id,
      m.article_id,
      m.supplier_ref,
      m.supplier_label,
      m.purchase_unit,
      m.is_active,
      m.created_at
    FROM supplier_article_mappings m
    JOIN articles a ON a.id = m.article_id
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
  $$
) AS src (
  id uuid,
  supplier_id uuid,
  article_id uuid,
  supplier_ref varchar(100),
  supplier_label varchar(255),
  purchase_unit varchar(50),
  is_active boolean,
  created_at timestamptz
)
JOIN suppliers s ON s.id = src.supplier_id
JOIN stores st ON st.id = s.store_id
JOIN articles a ON a.id = src.article_id
ON CONFLICT (supplier_id, supplier_ref) DO UPDATE SET
  article_id = EXCLUDED.article_id,
  supplier_label = EXCLUDED.supplier_label,
  purchase_unit = EXCLUDED.purchase_unit,
  price_unit = EXCLUDED.price_unit,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- =========================================================
-- 6. Comptages de controle
-- =========================================================
-- Ces SELECT ne modifient rien. Ils permettent de comparer les volumes source
-- migrables et les volumes presents en cible apres migration.

SELECT 'fournisseurs_migrables' AS controle, COUNT(*) AS total
FROM dblink(
  'dbname=gestion_rayons',
  $$ SELECT id FROM suppliers $$
) AS src (id uuid);

SELECT 'articles_trad_migrables' AS controle, COUNT(DISTINCT id) AS total
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT a.id
    FROM articles a
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
  $$
) AS src (id uuid);

SELECT 'af_map_trad_migrables' AS controle, COUNT(DISTINCT id) AS total
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT m.id
    FROM supplier_article_mappings m
    JOIN articles a ON a.id = m.article_id
    JOIN article_departments ad ON ad.article_id = a.id
    JOIN department_sectors ds ON ds.id = ad.department_sector_id
    WHERE UPPER(BTRIM(ds.code)) = 'TRAD'
  $$
) AS src (id uuid);

SELECT 'fournisseurs_en_cible' AS controle, COUNT(*) AS total FROM suppliers;

SELECT 'articles_en_cible' AS controle, COUNT(*) AS total FROM articles;

SELECT 'af_map_en_cible' AS controle, COUNT(*) AS total FROM supplier_article_mappings;

COMMIT;
