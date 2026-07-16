BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS receives_credit_notes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_price_lists boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_promotions boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

UPDATE client_contacts
SET is_primary = true
WHERE COALESCE(is_default_for_orders, false)
   OR COALESCE(is_default_for_delivery_notes, false)
   OR COALESCE(is_default_for_invoices, false);

CREATE INDEX IF NOT EXISTS idx_client_contacts_store_client_status
  ON client_contacts(store_id, client_id, status);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  label text,
  contact_name text NOT NULL,
  first_name text,
  last_name text,
  role text,

  email text,
  phone text,
  mobile text,

  receives_purchase_orders boolean NOT NULL DEFAULT false,
  receives_price_requests boolean NOT NULL DEFAULT false,
  receives_delivery_claims boolean NOT NULL DEFAULT false,
  receives_accounting_documents boolean NOT NULL DEFAULT false,

  is_primary boolean NOT NULL DEFAULT false,

  notes text,
  status text NOT NULL DEFAULT 'active',

  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier
  ON supplier_contacts(store_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_email
  ON supplier_contacts(store_id, email);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_store_supplier_status
  ON supplier_contacts(store_id, supplier_id, status);

COMMIT;
