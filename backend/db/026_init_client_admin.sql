-- Initialise une base dediee client avec un magasin, un rayon et un admin.
-- A executer uniquement sur une base cliente dediee, jamais sur la base source gestion_commerciale.
--
-- Variables psql requises :
--   client_key
--   store_code
--   store_name
--   department_code
--   department_name
--   business_type
--   admin_email
--   admin_password_hash

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE _client_init_input (
  client_key text NOT NULL,
  store_code text NOT NULL,
  store_name text NOT NULL,
  department_code text NOT NULL,
  department_name text NOT NULL,
  business_type text NOT NULL,
  admin_email text NOT NULL,
  admin_password_hash text NOT NULL
) ON COMMIT DROP;

INSERT INTO _client_init_input (
  client_key,
  store_code,
  store_name,
  department_code,
  department_name,
  business_type,
  admin_email,
  admin_password_hash
)
VALUES (
  :'client_key',
  :'store_code',
  :'store_name',
  :'department_code',
  :'department_name',
  :'business_type',
  lower(:'admin_email'),
  :'admin_password_hash'
);

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  missing_tables text[];
BEGIN
  SELECT array_agg(required.table_name)
  INTO missing_tables
  FROM (
    VALUES
      ('stores'),
      ('departments'),
      ('users'),
      ('user_departments')
  ) AS required(table_name)
  WHERE to_regclass('public.' || required.table_name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Tables manquantes dans la base courante : %', missing_tables;
  END IF;
END $$;

ALTER TABLE stores
ADD COLUMN IF NOT EXISTS client_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_client_key
ON stores(client_key)
WHERE client_key IS NOT NULL;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

UPDATE users
SET is_active = true
WHERE is_active IS NULL;

DO $$
DECLARE
  input record;
  missing_columns text[];
  v_store_id uuid;
  v_department_id uuid;
  v_admin_id uuid;
BEGIN
  SELECT *
  INTO STRICT input
  FROM _client_init_input;

  IF input.client_key = 'default' THEN
    RAISE EXCEPTION 'client_key=default refuse pour une base dediee client';
  END IF;

  IF input.client_key = ''
    OR input.store_code = ''
    OR input.store_name = ''
    OR input.department_code = ''
    OR input.department_name = ''
    OR input.business_type = ''
    OR input.admin_email = ''
    OR input.admin_password_hash = ''
  THEN
    RAISE EXCEPTION 'Variables psql incompletes pour initialiser le client';
  END IF;

  IF input.admin_password_hash !~ '^\$2[aby]\$[0-9]{2}\$' THEN
    RAISE EXCEPTION 'admin_password_hash doit etre un hash bcrypt, pas un mot de passe en clair';
  END IF;

  SELECT array_agg(required.column_name)
  INTO missing_columns
  FROM (
    VALUES
      ('stores', 'id'),
      ('stores', 'code'),
      ('stores', 'name'),
      ('stores', 'client_key'),
      ('departments', 'id'),
      ('departments', 'store_id'),
      ('departments', 'code'),
      ('departments', 'name'),
      ('departments', 'business_type'),
      ('users', 'id'),
      ('users', 'store_id'),
      ('users', 'email'),
      ('users', 'password_hash'),
      ('users', 'role'),
      ('users', 'is_active'),
      ('user_departments', 'id'),
      ('user_departments', 'user_id'),
      ('user_departments', 'department_id'),
      ('user_departments', 'is_default')
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

  INSERT INTO stores (id, code, name, client_key)
  VALUES (gen_random_uuid(), input.store_code, input.store_name, input.client_key)
  ON CONFLICT (code) DO UPDATE
  SET
    name = EXCLUDED.name,
    client_key = EXCLUDED.client_key
  RETURNING id INTO v_store_id;

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

  SELECT id
  INTO v_admin_id
  FROM users
  WHERE users.store_id = v_store_id
    AND lower(email) = input.admin_email
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    INSERT INTO users (id, store_id, email, password_hash, role, is_active)
    VALUES (
      gen_random_uuid(),
      v_store_id,
      input.admin_email,
      input.admin_password_hash,
      'admin',
      true
    )
    RETURNING id INTO v_admin_id;
  ELSE
    UPDATE users
    SET
      password_hash = input.admin_password_hash,
      role = 'admin',
      is_active = true
    WHERE id = v_admin_id;
  END IF;

  INSERT INTO user_departments (id, user_id, department_id, is_default)
  VALUES (gen_random_uuid(), v_admin_id, v_department_id, true)
  ON CONFLICT (user_id, department_id) DO UPDATE
  SET is_default = true;

  RAISE NOTICE 'Client initialise : %, store_id=%, department_id=%, admin_id=%',
    input.client_key,
    v_store_id,
    v_department_id,
    v_admin_id;
END $$;

COMMIT;
