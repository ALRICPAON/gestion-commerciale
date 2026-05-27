CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(50) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  client_key text NOT NULL DEFAULT 'scorpa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_client_key
ON stores(client_key);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code varchar(50) NOT NULL,
  name varchar(100) NOT NULL,
  business_type varchar(50) NOT NULL DEFAULT 'commercial',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  email varchar(150) NOT NULL,
  password_hash text NOT NULL,
  role varchar(50) NOT NULL DEFAULT 'vendeur',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, email),
  CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'responsable', 'commercial', 'qualite', 'vendeur'))
);

CREATE TABLE IF NOT EXISTS user_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS user_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  client_key text NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_audit_events_store_date
ON user_audit_events(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_audit_events_user_date
ON user_audit_events(user_id, created_at DESC);
