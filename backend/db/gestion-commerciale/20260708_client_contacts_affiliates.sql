BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS parent_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS affiliate_label text,
  ADD COLUMN IF NOT EXISTS affiliate_store_number text;

CREATE INDEX IF NOT EXISTS idx_clients_parent_client
  ON clients(store_id, parent_client_id);

CREATE INDEX IF NOT EXISTS idx_clients_affiliate_store_number
  ON clients(store_id, affiliate_store_number);

CREATE TABLE IF NOT EXISTS client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  label text,
  contact_name text NOT NULL,
  role text,

  email text,
  phone text,
  mobile text,

  receives_orders boolean NOT NULL DEFAULT false,
  receives_delivery_notes boolean NOT NULL DEFAULT false,
  receives_invoices boolean NOT NULL DEFAULT false,
  receives_statements boolean NOT NULL DEFAULT false,

  is_default_for_orders boolean NOT NULL DEFAULT false,
  is_default_for_delivery_notes boolean NOT NULL DEFAULT false,
  is_default_for_invoices boolean NOT NULL DEFAULT false,

  notes text,
  status text NOT NULL DEFAULT 'active',

  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_client
  ON client_contacts(store_id, client_id);

CREATE INDEX IF NOT EXISTS idx_client_contacts_email
  ON client_contacts(store_id, email);

ALTER TABLE sales_lines
  ADD COLUMN IF NOT EXISTS delivered_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivered_client_name_snapshot text,
  ADD COLUMN IF NOT EXISTS delivered_client_code_snapshot text,
  ADD COLUMN IF NOT EXISTS delivered_client_store_identifier_snapshot text;

CREATE INDEX IF NOT EXISTS idx_sales_lines_delivered_client
  ON sales_lines(store_id, delivered_client_id);

COMMIT;