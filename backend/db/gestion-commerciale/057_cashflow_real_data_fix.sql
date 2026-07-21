ALTER TABLE cashflow_settings
  ADD COLUMN IF NOT EXISTS initial_bank_history_months integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS monitored_supplier_pennylane_id text,
  ADD COLUMN IF NOT EXISTS monitored_supplier_name text;

CREATE TABLE IF NOT EXISTS cashflow_sync_resource_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sync_log_id uuid,
  resource text NOT NULL,
  endpoint text NOT NULL,
  query_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  http_status integer,
  pages_count integer NOT NULL DEFAULT 0,
  received_count integer NOT NULL DEFAULT 0,
  normalized_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  ignored_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  ignored_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_item_shape jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashflow_sync_resource_logs_store_resource_idx
  ON cashflow_sync_resource_logs (store_id, resource, created_at DESC);

CREATE TABLE IF NOT EXISTS cashflow_pennylane_response_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  resource text NOT NULL,
  endpoint text NOT NULL,
  item_shape jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashflow_pennylane_response_samples_store_resource_idx
  ON cashflow_pennylane_response_samples (store_id, resource, received_at DESC);

CREATE TABLE IF NOT EXISTS cashflow_charge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'trial_balance',
  period_start date,
  period_end date,
  month_key text,
  account_number text NOT NULL,
  account_label text,
  category_code text NOT NULL DEFAULT 'charges_a_classer',
  total_debit numeric(14, 2) NOT NULL DEFAULT 0,
  total_credit numeric(14, 2) NOT NULL DEFAULT 0,
  net_charge numeric(14, 2) NOT NULL DEFAULT 0,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_charge_history_unique_idx
  ON cashflow_charge_history (store_id, source, COALESCE(period_start, '1900-01-01'::date), COALESCE(period_end, '1900-01-01'::date), account_number);

CREATE INDEX IF NOT EXISTS cashflow_charge_history_store_month_idx
  ON cashflow_charge_history (store_id, month_key, category_code);

ALTER TABLE pennylane_supplier_invoices
  ADD COLUMN IF NOT EXISTS cashflow_last_direct_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS cashflow_normalization_status text NOT NULL DEFAULT 'ok';
