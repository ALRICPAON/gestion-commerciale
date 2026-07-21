ALTER TABLE cashflow_settings
  ADD COLUMN IF NOT EXISTS included_bank_account_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS excluded_bank_account_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS balance_stale_after_hours integer NOT NULL DEFAULT 24;

ALTER TABLE cashflow_bank_snapshots
  ADD COLUMN IF NOT EXISTS included_bank_account_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS account_count integer NOT NULL DEFAULT 0;

ALTER TABLE cashflow_bank_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS supplier_id text,
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS reconciliation_status text,
  ADD COLUMN IF NOT EXISTS unmatched_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS pennylane_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS pennylane_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_invoices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS categories jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS cashflow_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  pennylane_bank_account_id text NOT NULL,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  balance numeric(14, 2),
  pennylane_updated_at timestamptz,
  bank_establishment_name text,
  bank_establishment_id text,
  journal_id text,
  journal_label text,
  ledger_account_id text,
  ledger_account_number text,
  include_in_cashflow boolean NOT NULL DEFAULT true,
  is_main boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_bank_accounts_unique UNIQUE (store_id, pennylane_bank_account_id)
);

CREATE INDEX IF NOT EXISTS cashflow_bank_accounts_store_include_idx
  ON cashflow_bank_accounts (store_id, include_in_cashflow, is_main);

CREATE TABLE IF NOT EXISTS cashflow_supplier_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  pennylane_supplier_invoice_id text NOT NULL,
  pennylane_payment_id text NOT NULL,
  label text,
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  status text,
  is_confirmed boolean NOT NULL DEFAULT false,
  is_pending boolean NOT NULL DEFAULT false,
  pennylane_created_at timestamptz,
  pennylane_updated_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_supplier_invoice_payments_unique UNIQUE (store_id, pennylane_supplier_invoice_id, pennylane_payment_id)
);

CREATE INDEX IF NOT EXISTS cashflow_supplier_invoice_payments_invoice_idx
  ON cashflow_supplier_invoice_payments (store_id, pennylane_supplier_invoice_id, status);

CREATE TABLE IF NOT EXISTS cashflow_invoice_transaction_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  invoice_type text NOT NULL,
  pennylane_invoice_id text NOT NULL,
  pennylane_transaction_id text NOT NULL,
  amount numeric(14, 2),
  source text NOT NULL DEFAULT 'pennylane_matched_invoices',
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_invoice_transaction_links_type_check CHECK (invoice_type IN ('customer_invoice', 'supplier_invoice')),
  CONSTRAINT cashflow_invoice_transaction_links_unique UNIQUE (store_id, invoice_type, pennylane_invoice_id, pennylane_transaction_id)
);

CREATE INDEX IF NOT EXISTS cashflow_invoice_transaction_links_invoice_idx
  ON cashflow_invoice_transaction_links (store_id, invoice_type, pennylane_invoice_id);

CREATE TABLE IF NOT EXISTS cashflow_charge_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid,
  code text NOT NULL,
  label text NOT NULL,
  ledger_prefixes text[] NOT NULL DEFAULT ARRAY[]::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_charge_categories_global_uidx
  ON cashflow_charge_categories (code)
  WHERE store_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_charge_categories_store_uidx
  ON cashflow_charge_categories (store_id, code)
  WHERE store_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cashflow_recurring_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  label text NOT NULL,
  category_code text NOT NULL DEFAULT 'other',
  cash_amount numeric(14, 2) NOT NULL,
  first_due_date date NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  due_day integer,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  adjust_non_working_days boolean NOT NULL DEFAULT false,
  comment text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_recurring_charges_frequency_check CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly'))
);

CREATE INDEX IF NOT EXISTS cashflow_recurring_charges_store_due_idx
  ON cashflow_recurring_charges (store_id, active, first_due_date, frequency);

CREATE TABLE IF NOT EXISTS cashflow_recurring_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  suggestion_type text NOT NULL,
  label text NOT NULL,
  category_code text,
  estimated_amount numeric(14, 2),
  frequency text,
  confidence text NOT NULL DEFAULT 'moyenne',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_recurring_suggestions_status_check CHECK (status IN ('suggested', 'accepted', 'ignored'))
);

CREATE INDEX IF NOT EXISTS cashflow_recurring_suggestions_store_status_idx
  ON cashflow_recurring_suggestions (store_id, status, suggestion_type);

CREATE TABLE IF NOT EXISTS cashflow_scope_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  endpoint text NOT NULL,
  http_status integer,
  required_scope text NOT NULL,
  access_status text NOT NULL,
  item_count integer NOT NULL DEFAULT 0,
  error_message text,
  action_required text,
  tested_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_scope_diagnostics_access_check CHECK (access_status IN ('accessible', 'forbidden', 'unauthorized', 'error'))
);

CREATE INDEX IF NOT EXISTS cashflow_scope_diagnostics_store_tested_idx
  ON cashflow_scope_diagnostics (store_id, tested_at DESC);

INSERT INTO cashflow_charge_categories(store_id, code, label, ledger_prefixes)
VALUES
  (NULL, 'goods_purchases', 'Achats de marchandises', ARRAY['607']),
  (NULL, 'transport', 'Transport', ARRAY['624']),
  (NULL, 'fees', 'Honoraires', ARRAY['6226']),
  (NULL, 'travel_reception', 'Deplacements et receptions', ARRAY['625']),
  (NULL, 'rent', 'Loyers', ARRAY['613', '614']),
  (NULL, 'insurance', 'Assurances', ARRAY['616']),
  (NULL, 'bank_fees', 'Frais bancaires', ARRAY['627']),
  (NULL, 'wages', 'Salaires', ARRAY['641']),
  (NULL, 'social_charges', 'Charges sociales', ARRAY['645']),
  (NULL, 'taxes', 'Impots et taxes', ARRAY['63']),
  (NULL, 'leasing', 'Leasing et locations', ARRAY['612']),
  (NULL, 'other', 'Autres charges', ARRAY['60', '61', '62', '65', '66'])
ON CONFLICT DO NOTHING;
