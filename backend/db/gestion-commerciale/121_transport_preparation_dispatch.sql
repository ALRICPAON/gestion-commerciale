BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS transport_operations_email text;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS delanchy_dock_pickup boolean NOT NULL DEFAULT false;

ALTER TABLE transport_shipments
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_transport_shipments_source_active
  ON transport_shipments(store_id, source_type, source_id)
  WHERE source_type IS NOT NULL
    AND source_id IS NOT NULL
    AND COALESCE(status, 'draft') <> 'cancelled';

CREATE TABLE IF NOT EXISTS transport_dispatch_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  dispatch_date date NOT NULL,
  carrier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  email_to text NOT NULL,
  subject text NOT NULL,
  attachment_count integer NOT NULL DEFAULT 0,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now(),
  smtp_message_id text
);

CREATE INDEX IF NOT EXISTS idx_transport_dispatch_email_logs_day
  ON transport_dispatch_email_logs(store_id, dispatch_date, carrier_id, sent_at DESC);

COMMIT;
