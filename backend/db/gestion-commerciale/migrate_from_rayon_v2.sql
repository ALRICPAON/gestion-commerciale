/*
  Migration Rayon V2 -> Gestion Commerciale

  Source : gestion_rayons
  Cible  : gestion_commerciale

  A RELIRE AVANT EXECUTION.
  Ce script est prevu pour etre lance connecte a la base cible gestion_commerciale.
  Il ne modifie jamais gestion_rayons : les lectures source passent par dblink.

  Inspection locale realisee le 2026-05-29 :
  - gestion_rayons contient suppliers, articles, article_departments,
    article_department_metadata et supplier_article_mappings.
  - gestion_commerciale n'etait pas disponible localement, la structure cible
    est donc celle des fichiers SQL de ce depot.

  Pre-requis :
  - les schemas Gestion Commerciale doivent deja etre crees.
  - l'utilisateur PostgreSQL doit pouvoir lire gestion_rayons via dblink.
  - si la connexion implicite ne fonctionne pas, remplacer SOURCE_CONN ci-dessous
    par une chaine complete, par exemple :
    'host=localhost port=5432 dbname=gestion_rayons user=admin password=password'
*/

BEGIN;

CREATE EXTENSION IF NOT EXISTS dblink;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ajuster cette valeur si dblink('dbname=gestion_rayons') ne suffit pas.
-- Dans psql, remplacer manuellement : :SOURCE_CONN n'est volontairement pas utilise
-- pour rester compatible avec une execution SQL simple.

-- 1. Magasins et services requis par les FK articles/fournisseurs.
INSERT INTO stores (id, code, name, client_key, created_at, updated_at)
SELECT id, code, name, COALESCE(client_key, 'scorpa'), created_at, COALESCE(updated_at, created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT id, code, name, NULL::text AS client_key, created_at, created_at AS updated_at
    FROM stores
  $$
) AS src (
  id uuid,
  code varchar(50),
  name varchar(150),
  client_key text,
  created_at timestamptz,
  updated_at timestamptz
)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  client_key = EXCLUDED.client_key,
  updated_at = now();

INSERT INTO departments (id, store_id, code, name, business_type, created_at, updated_at)
SELECT id, store_id, code, name, COALESCE(business_type, 'commercial'), created_at, COALESCE(updated_at, created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT id, store_id, code, name, business_type, created_at, created_at AS updated_at
    FROM departments
  $$
) AS src (
  id uuid,
  store_id uuid,
  code varchar(50),
  name varchar(100),
  business_type varchar(50),
  created_at timestamptz,
  updated_at timestamptz
)
ON CONFLICT (store_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  business_type = EXCLUDED.business_type,
  updated_at = now();

INSERT INTO department_sectors (
  id,
  department_id,
  code,
  name,
  description,
  color_hex,
  display_order,
  is_active,
  created_at,
  updated_at
)
SELECT
  id,
  department_id,
  code,
  name,
  description,
  color_hex,
  COALESCE(display_order, 0),
  COALESCE(is_active, true),
  created_at,
  COALESCE(updated_at, created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT id, department_id, code, name, description, color_hex,
           display_order, is_active, created_at, updated_at
    FROM department_sectors
  $$
) AS src (
  id uuid,
  department_id uuid,
  code varchar(50),
  name varchar(120),
  description text,
  color_hex varchar(20),
  display_order integer,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
ON CONFLICT (department_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color_hex = EXCLUDED.color_hex,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- 2. Fournisseurs.
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
  id,
  store_id,
  code,
  name,
  'standard',
  CASE WHEN COALESCE(is_active, true) THEN 'active' ELSE 'inactive' END,
  contact_name,
  phone,
  email,
  address,
  created_at,
  created_at
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

-- 3. Articles.
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
SELECT
  id,
  store_id,
  plu,
  designation,
  ean,
  COALESCE(unit, 'kg'),
  COALESCE(is_active, true),
  COALESCE(source_origin, 'rayon_v2'),
  COALESCE(source_id, id::text),
  created_at,
  COALESCE(updated_at, created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT id, store_id, plu, designation, ean, unit, is_active, source_origin, source_id, created_at, updated_at
    FROM articles
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

-- 4. Rattachements articles/services.
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
  id,
  article_id,
  department_id,
  department_sector_id,
  display_name,
  purchase_unit,
  stock_unit,
  sale_unit,
  COALESCE(is_active, true),
  created_at,
  COALESCE(updated_at, created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT id, article_id, department_id, department_sector_id, display_name,
           purchase_unit, stock_unit, sale_unit, is_active, created_at, updated_at
    FROM article_departments
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
ON CONFLICT (article_id, department_id) DO UPDATE SET
  department_sector_id = EXCLUDED.department_sector_id,
  display_name = EXCLUDED.display_name,
  purchase_unit = EXCLUDED.purchase_unit,
  stock_unit = EXCLUDED.stock_unit,
  sale_unit = EXCLUDED.sale_unit,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- 5. Metadonnees articles.
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
  article_department_id,
  COALESCE(field_key, 'business_metadata'),
  field_value,
  category,
  COALESCE(latin_name, nom_latin),
  COALESCE(fao_zone, zone),
  sous_zone,
  engin,
  allergenes,
  COALESCE(raw_source, '{}'::jsonb),
  created_at,
  COALESCE(updated_at, created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT article_department_id, field_key, field_value, category,
           latin_name, nom_latin, fao_zone, zone, sous_zone, engin,
           allergenes, raw_source, created_at, updated_at
    FROM article_department_metadata
  $$
) AS src (
  article_department_id uuid,
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

-- 6. AF_MAP fournisseur/article.
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
  m.id,
  s.store_id,
  st.client_key,
  m.supplier_id,
  m.article_id,
  m.supplier_ref,
  m.supplier_label,
  COALESCE(m.purchase_unit, 'kg'),
  'kg',
  COALESCE(m.is_active, true),
  m.created_at,
  COALESCE(m.created_at, now())
FROM dblink(
  'dbname=gestion_rayons',
  $$
    SELECT id, supplier_id, article_id, supplier_ref, supplier_label,
           purchase_unit, is_active, created_at
    FROM supplier_article_mappings
  $$
) AS m (
  id uuid,
  supplier_id uuid,
  article_id uuid,
  supplier_ref varchar(100),
  supplier_label varchar(255),
  purchase_unit varchar(50),
  is_active boolean,
  created_at timestamptz
)
JOIN suppliers s ON s.id = m.supplier_id
JOIN stores st ON st.id = s.store_id
JOIN articles a ON a.id = m.article_id
ON CONFLICT (supplier_id, supplier_ref) DO UPDATE SET
  article_id = EXCLUDED.article_id,
  supplier_label = EXCLUDED.supplier_label,
  purchase_unit = EXCLUDED.purchase_unit,
  price_unit = EXCLUDED.price_unit,
  is_active = EXCLUDED.is_active,
  updated_at = now();

COMMIT;
