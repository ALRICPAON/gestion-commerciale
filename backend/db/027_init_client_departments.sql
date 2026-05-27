-- Ajoute ou met a jour un rayon dans une base dediee client.
-- A executer uniquement sur une base cliente dediee, jamais sur la base source gestion_commerciale.
--
-- Variables psql requises :
--   store_code
--   department_code
--   department_name
--   business_type

\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TEMP TABLE _department_init_input (
  store_code text NOT NULL,
  department_code text NOT NULL,
  department_name text NOT NULL,
  business_type text NOT NULL
) ON COMMIT DROP;

INSERT INTO _department_init_input (
  store_code,
  department_code,
  department_name,
  business_type
)
VALUES (
  :'store_code',
  :'department_code',
  :'department_name',
  :'business_type'
);

DO $$
DECLARE
  missing_tables text[];
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
      ('user_departments')
  ) AS required(table_name)
  WHERE to_regclass('public.' || required.table_name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Tables manquantes dans la base courante : %', missing_tables;
  END IF;
END $$;

DO $$
DECLARE
  input record;
  missing_columns text[];
  v_store_id uuid;
  v_client_key text;
  v_department_id uuid;
BEGIN
  SELECT *
  INTO STRICT input
  FROM _department_init_input;

  IF input.store_code = ''
    OR input.department_code = ''
    OR input.department_name = ''
    OR input.business_type = ''
  THEN
    RAISE EXCEPTION 'Variables psql incompletes pour initialiser le rayon';
  END IF;

  SELECT array_agg(required.column_name)
  INTO missing_columns
  FROM (
    VALUES
      ('stores', 'id'),
      ('stores', 'code'),
      ('stores', 'client_key'),
      ('departments', 'id'),
      ('departments', 'store_id'),
      ('departments', 'code'),
      ('departments', 'name'),
      ('departments', 'business_type'),
      ('user_departments', 'user_id'),
      ('user_departments', 'department_id')
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

  SELECT s.id, s.client_key
  INTO v_store_id, v_client_key
  FROM stores s
  WHERE s.code = input.store_code
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Magasin introuvable pour store_code=%', input.store_code;
  END IF;

  IF v_client_key IS NULL OR v_client_key = '' OR v_client_key = 'default' THEN
    RAISE EXCEPTION 'client_key invalide pour store_code=% : %', input.store_code, v_client_key;
  END IF;

  INSERT INTO departments (id, store_id, code, name, business_type)
  VALUES (
    gen_random_uuid(),
    v_store_id,
    input.department_code,
    input.department_name,
    input.business_type
  )
  ON CONFLICT (store_id, code) DO UPDATE
  SET
    name = EXCLUDED.name,
    business_type = EXCLUDED.business_type
  RETURNING id INTO v_department_id;

  RAISE NOTICE 'Rayon initialise : client_key=%, store_code=%, department_code=%, department_id=%',
    v_client_key,
    input.store_code,
    input.department_code,
    v_department_id;
END $$;

COMMIT;
