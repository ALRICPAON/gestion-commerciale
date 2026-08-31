ALTER TABLE customer_price_list_email_results
  ADD COLUMN IF NOT EXISTS sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS tracking_token uuid NULL,
  ADD COLUMN IF NOT EXISTS first_opened_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0;

UPDATE customer_price_list_email_results
SET sent_at = created_at
WHERE status = 'sent' AND sent_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_price_list_email_results_tracking_token
  ON customer_price_list_email_results (tracking_token)
  WHERE tracking_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_price_list_email_results_store_batch
  ON customer_price_list_email_results (store_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_customer_price_list_email_results_store_opened
  ON customer_price_list_email_results (store_id, first_opened_at DESC)
  WHERE first_opened_at IS NOT NULL;
