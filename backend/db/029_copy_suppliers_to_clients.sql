BEGIN;

CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
BEGIN
  IF current_database() = 'gestion_commerciale' THEN
    RAISE EXCEPTION 'Ne pas executer ce script sur gestion_commerciale. Utiliser une base client.';
  END IF;
END $$;

INSERT INTO suppliers (
  id,
  store_id,
  code,
  name,
  contact_name,
  phone,
  email,
  address,
  is_active,
  created_at
)
SELECT
  s.id,
  target_store.id AS store_id,
  s.code,
  s.name,
  s.contact_name,
  s.phone,
  s.email,
  s.address,
  s.is_active,
  COALESCE(s.created_at, NOW())
FROM dblink(
  'dbname=gestion_commerciale user=admin',
  'SELECT id, code, name, contact_name, phone, email, address, is_active, created_at FROM suppliers'
) AS s(
  id uuid,
  code text,
  name text,
  contact_name text,
  phone text,
  email text,
  address text,
  is_active boolean,
  created_at timestamptz
)
CROSS JOIN (
  SELECT id FROM stores LIMIT 1
) target_store
ON CONFLICT (store_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  contact_name = EXCLUDED.contact_name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  address = EXCLUDED.address,
  is_active = EXCLUDED.is_active;

COMMIT;
