CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customer_price_list_email_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  total_clients integer NOT NULL DEFAULT 0,
  clients_with_email integer NOT NULL DEFAULT 0,
  clients_without_email integer NOT NULL DEFAULT 0,
  emails_planned integer NOT NULL DEFAULT 0,
  emails_sent integer NOT NULL DEFAULT 0,
  clients_skipped integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  smtp_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_price_list_email_batches_store_sent
  ON customer_price_list_email_batches (store_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS customer_price_list_email_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES customer_price_list_email_batches(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  client_id uuid NULL,
  client_name text NULL,
  email text NULL,
  status text NOT NULL,
  error text NULL,
  message_id text NULL,
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_price_list_email_results_batch
  ON customer_price_list_email_results (batch_id);

CREATE INDEX IF NOT EXISTS idx_customer_price_list_email_results_store_created
  ON customer_price_list_email_results (store_id, created_at DESC);
