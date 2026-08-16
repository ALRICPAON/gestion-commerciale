BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_id_store_id_unique'
      AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_id_store_id_unique UNIQUE (id, store_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'articles_id_store_id_unique'
      AND conrelid = 'articles'::regclass
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT articles_id_store_id_unique UNIQUE (id, store_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_contacts_id_store_id_unique'
      AND conrelid = 'client_contacts'::regclass
  ) THEN
    ALTER TABLE client_contacts
      ADD CONSTRAINT client_contacts_id_store_id_unique UNIQUE (id, store_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_events_id_store_id_unique'
      AND conrelid = 'quality_events'::regclass
  ) THEN
    ALTER TABLE quality_events
      ADD CONSTRAINT quality_events_id_store_id_unique UNIQUE (id, store_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_evidence_records_id_store_id_unique'
      AND conrelid = 'quality_evidence_records'::regclass
  ) THEN
    ALTER TABLE quality_evidence_records
      ADD CONSTRAINT quality_evidence_records_id_store_id_unique UNIQUE (id, store_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_recall_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL,
  article_id uuid,
  status text NOT NULL DEFAULT 'draft',
  recall_type text NOT NULL,
  reason text NOT NULL,
  comment text,
  initiated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  closed_at timestamptz,
  quality_event_id uuid,
  quality_evidence_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT product_recall_campaigns_status_check
    CHECK (status IN ('draft', 'ready', 'sending', 'sent', 'partial', 'closed', 'cancelled')),
  CONSTRAINT product_recall_campaigns_type_check
    CHECK (recall_type IN ('supplier_recall', 'health_alert', 'quality_suspicion', 'authority_request', 'traceability_issue', 'other')),
  CONSTRAINT product_recall_campaigns_reason_check
    CHECK (btrim(reason) <> ''),
  CONSTRAINT product_recall_campaigns_lot_store_fk
    FOREIGN KEY (lot_id, store_id)
    REFERENCES lots(id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT product_recall_campaigns_article_store_fk
    FOREIGN KEY (article_id, store_id)
    REFERENCES articles(id, store_id)
    ON DELETE SET NULL (article_id),
  CONSTRAINT product_recall_campaigns_event_store_fk
    FOREIGN KEY (quality_event_id, store_id)
    REFERENCES quality_events(id, store_id)
    ON DELETE SET NULL (quality_event_id),
  CONSTRAINT product_recall_campaigns_evidence_store_fk
    FOREIGN KEY (quality_evidence_record_id, store_id)
    REFERENCES quality_evidence_records(id, store_id)
    ON DELETE SET NULL (quality_evidence_record_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recall_campaigns_id_store_id_unique'
      AND conrelid = 'product_recall_campaigns'::regclass
  ) THEN
    ALTER TABLE product_recall_campaigns
      ADD CONSTRAINT product_recall_campaigns_id_store_id_unique UNIQUE (id, store_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_recall_active_lot
  ON product_recall_campaigns(store_id, lot_id)
  WHERE status NOT IN ('closed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_product_recall_campaigns_store_status
  ON product_recall_campaigns(store_id, status, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_recall_campaigns_lot
  ON product_recall_campaigns(store_id, lot_id);

CREATE TABLE IF NOT EXISTS product_recall_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  delivered_client_id uuid NOT NULL,
  delivered_client_name text,
  delivered_client_code text,
  delivered_client_store_identifier text,
  email text,
  contact_id uuid,
  contact_name text,
  contact_source text,
  status text NOT NULL,
  delivered_quantity numeric(14,3) NOT NULL DEFAULT 0,
  delivery_note_count integer NOT NULL DEFAULT 0,
  delivery_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  prepared_subject text,
  prepared_body text,
  email_message_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT product_recall_recipients_status_check
    CHECK (status IN ('pending', 'ready', 'contact_required', 'sent', 'failed', 'skipped')),
  CONSTRAINT product_recall_recipients_contact_source_check
    CHECK (contact_source IS NULL OR contact_source IN ('delivery_note_contact', 'primary_contact', 'client_email')),
  CONSTRAINT product_recall_recipients_delivery_notes_array_check
    CHECK (jsonb_typeof(delivery_notes) = 'array'),
  CONSTRAINT product_recall_recipients_campaign_store_fk
    FOREIGN KEY (campaign_id, store_id)
    REFERENCES product_recall_campaigns(id, store_id)
    ON DELETE CASCADE,
  CONSTRAINT product_recall_recipients_client_store_fk
    FOREIGN KEY (delivered_client_id, store_id)
    REFERENCES clients(id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT product_recall_recipients_contact_store_fk
    FOREIGN KEY (contact_id, store_id)
    REFERENCES client_contacts(id, store_id)
    ON DELETE SET NULL (contact_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_recall_recipient_client
  ON product_recall_recipients(campaign_id, delivered_client_id);

CREATE INDEX IF NOT EXISTS idx_product_recall_recipients_campaign_status
  ON product_recall_recipients(store_id, campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_product_recall_recipients_client
  ON product_recall_recipients(store_id, delivered_client_id);

COMMIT;
