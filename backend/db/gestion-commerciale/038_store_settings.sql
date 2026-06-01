BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_name text,
  logo_url text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text NOT NULL DEFAULT 'France',
  phone text,
  email text,
  siret text,
  vat_number text,
  sanitary_approval_number text,
  iban text,
  bic text,
  payment_terms text,
  legal_mentions text,
  terms_and_conditions text,
  delivery_note_footer text,
  invoice_footer text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_settings_store_unique UNIQUE (store_id)
);

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'France',
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS siret text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS sanitary_approval_number text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS bic text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS legal_mentions text,
  ADD COLUMN IF NOT EXISTS terms_and_conditions text,
  ADD COLUMN IF NOT EXISTS delivery_note_footer text,
  ADD COLUMN IF NOT EXISTS invoice_footer text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'store_settings'::regclass
      AND conname = 'store_settings_store_unique'
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT store_settings_store_unique UNIQUE (store_id);
  END IF;
END $$;

COMMIT;
