CREATE TABLE IF NOT EXISTS cashflow_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  opening_balance numeric(14, 2) NOT NULL DEFAULT 0,
  main_bank_account_label text,
  main_bank_account_pennylane_id text,
  distrimer_supplier_id uuid,
  distrimer_pennylane_supplier_id text,
  distrimer_limit numeric(14, 2) NOT NULL DEFAULT 10000,
  distrimer_green_threshold numeric(14, 2) NOT NULL DEFAULT 8000,
  distrimer_orange_threshold numeric(14, 2) NOT NULL DEFAULT 9500,
  distrimer_red_threshold numeric(14, 2) NOT NULL DEFAULT 9500,
  distrimer_target_after_payment numeric(14, 2) NOT NULL DEFAULT 7500,
  default_customer_delay_days integer NOT NULL DEFAULT 30,
  cautious_customer_delay_days integer NOT NULL DEFAULT 7,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_settings_store_unique UNIQUE (store_id)
);

CREATE TABLE IF NOT EXISTS cashflow_bank_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  bank_account_pennylane_id text,
  bank_account_label text,
  balance numeric(14, 2) NOT NULL DEFAULT 0,
  balance_source text NOT NULL DEFAULT 'manual',
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_bank_snapshots_source_check CHECK (balance_source IN ('pennylane', 'calculated', 'manual'))
);

CREATE INDEX IF NOT EXISTS cashflow_bank_snapshots_store_date_idx
  ON cashflow_bank_snapshots (store_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS cashflow_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  pennylane_transaction_id text,
  bank_account_pennylane_id text,
  transaction_date date NOT NULL,
  label text NOT NULL,
  direction text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  reconciled boolean,
  counterparty_name text,
  linked_document_id text,
  source text NOT NULL DEFAULT 'pennylane',
  balance_after numeric(14, 2),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_bank_transactions_direction_check CHECK (direction IN ('in', 'out'))
);

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_bank_transactions_pennylane_uidx
  ON cashflow_bank_transactions (store_id, pennylane_transaction_id)
  WHERE pennylane_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cashflow_bank_transactions_store_date_idx
  ON cashflow_bank_transactions (store_id, transaction_date DESC, direction);

CREATE TABLE IF NOT EXISTS cashflow_forecast_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  source text NOT NULL,
  source_id text,
  label text NOT NULL,
  counterparty_id text,
  counterparty_name text,
  direction text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  due_date date,
  forecast_date date,
  status text,
  confidence text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_forecast_items_direction_check CHECK (direction IN ('in', 'out'))
);

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_forecast_items_source_uidx
  ON cashflow_forecast_items (store_id, source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cashflow_forecast_items_store_date_idx
  ON cashflow_forecast_items (store_id, forecast_date, direction, status);

CREATE TABLE IF NOT EXISTS cashflow_manual_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  label text NOT NULL,
  direction text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  forecast_date date NOT NULL,
  recurrence text NOT NULL DEFAULT 'unique',
  category text,
  comment text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_manual_items_direction_check CHECK (direction IN ('in', 'out')),
  CONSTRAINT cashflow_manual_items_recurrence_check CHECK (recurrence IN ('unique', 'weekly', 'monthly', 'quarterly', 'yearly'))
);

CREATE INDEX IF NOT EXISTS cashflow_manual_items_store_date_idx
  ON cashflow_manual_items (store_id, active, forecast_date, recurrence);

CREATE TABLE IF NOT EXISTS cashflow_customer_behaviour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_id uuid,
  pennylane_customer_id text,
  client_name text NOT NULL,
  invoice_count integer NOT NULL DEFAULT 0,
  paid_invoice_count integer NOT NULL DEFAULT 0,
  average_invoice_to_payment_days integer,
  average_due_delay_days integer,
  reliability text NOT NULL DEFAULT 'faible',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_customer_behaviour_client_uidx
  ON cashflow_customer_behaviour (store_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cashflow_supplier_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  supplier_id uuid,
  pennylane_supplier_id text,
  supplier_name text NOT NULL,
  planned_payment_delay_days integer,
  priority text NOT NULL DEFAULT 'normale',
  active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashflow_supplier_rules_store_supplier_idx
  ON cashflow_supplier_rules (store_id, supplier_id, pennylane_supplier_id, active);

CREATE TABLE IF NOT EXISTS cashflow_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  alert_type text NOT NULL,
  level text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  alert_date date,
  amount numeric(14, 2),
  status text NOT NULL DEFAULT 'open',
  source text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_alerts_level_check CHECK (level IN ('info', 'vert', 'orange', 'rouge', 'bloquant')),
  CONSTRAINT cashflow_alerts_status_check CHECK (status IN ('open', 'acknowledged', 'closed'))
);

CREATE INDEX IF NOT EXISTS cashflow_alerts_store_status_idx
  ON cashflow_alerts (store_id, status, level, alert_date DESC);

CREATE TABLE IF NOT EXISTS cashflow_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sync_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'started',
  read_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_sync_logs_status_check CHECK (status IN ('started', 'success', 'failed', 'partial'))
);

CREATE INDEX IF NOT EXISTS cashflow_sync_logs_store_started_idx
  ON cashflow_sync_logs (store_id, started_at DESC);

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS payment_due_date date;

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS due_date date;
