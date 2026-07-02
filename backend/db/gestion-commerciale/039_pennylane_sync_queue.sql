BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pennylane_sync_status') THEN
    CREATE TYPE pennylane_sync_status AS ENUM ('pending', 'processing', 'success', 'failed', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pennylane_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  status pennylane_sync_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  priority integer NOT NULL DEFAULT 100,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pennylane_reference jsonb,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pennylane_sync_queue_store_status_idx
  ON pennylane_sync_queue (store_id, status, scheduled_at, priority);

CREATE INDEX IF NOT EXISTS pennylane_sync_queue_entity_idx
  ON pennylane_sync_queue (store_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS pennylane_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid REFERENCES pennylane_sync_queue(id) ON DELETE SET NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status pennylane_sync_status NOT NULL,
  message text NOT NULL,
  request_payload jsonb,
  response_payload jsonb,
  error_code text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pennylane_sync_logs_store_created_idx
  ON pennylane_sync_logs (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pennylane_sync_logs_queue_idx
  ON pennylane_sync_logs (queue_id, created_at DESC);

COMMIT;
