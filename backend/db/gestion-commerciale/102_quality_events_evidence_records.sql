-- Socle transversal evenements metier / preuves qualite.
-- Additif et idempotent: aucun flux metier existant n est modifie automatiquement.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  source_line_id uuid,
  source_discriminator text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  triggered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  event_status text NOT NULL DEFAULT 'recorded',
  payload_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_events_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT quality_events_event_type_check CHECK (length(trim(event_type)) > 0),
  CONSTRAINT quality_events_source_table_check CHECK (length(trim(source_table)) > 0),
  CONSTRAINT quality_events_status_check CHECK (
    event_status IN ('recorded', 'processed', 'ignored', 'failed', 'archived')
  ),
  CONSTRAINT quality_events_payload_version_check CHECK (payload_version > 0),
  CONSTRAINT quality_events_payload_object_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE IF NOT EXISTS quality_evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  quality_event_id uuid,
  evidence_type text NOT NULL,
  evidence_reference text,
  evidence_status text NOT NULL DEFAULT 'recorded',
  evidence_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'human',
  source_record_type text,
  source_record_id uuid,
  quality_task_id uuid REFERENCES quality_tasks(id) ON DELETE SET NULL,
  occurrence_id uuid REFERENCES quality_task_occurrences(id) ON DELETE SET NULL,
  non_conformity_id uuid REFERENCES quality_non_conformities(id) ON DELETE SET NULL,
  document_id uuid REFERENCES quality_documents(id) ON DELETE SET NULL,
  photo_id uuid REFERENCES quality_photos(id) ON DELETE SET NULL,
  master_document_id uuid REFERENCES quality_master_documents(id) ON DELETE SET NULL,
  payload_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_evidence_records_event_store_fk
    FOREIGN KEY (quality_event_id, store_id)
    REFERENCES quality_events(id, store_id)
    ON DELETE CASCADE,
  CONSTRAINT quality_evidence_records_type_check CHECK (length(trim(evidence_type)) > 0),
  CONSTRAINT quality_evidence_records_status_check CHECK (
    evidence_status IN ('draft', 'recorded', 'validated', 'rejected', 'archived')
  ),
  CONSTRAINT quality_evidence_records_source_type_check CHECK (
    source_type IN ('human', 'automatic', 'import', 'agent', 'system')
  ),
  CONSTRAINT quality_evidence_records_payload_version_check CHECK (payload_version > 0),
  CONSTRAINT quality_evidence_records_payload_object_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_events_idempotency
  ON quality_events (
    store_id,
    event_type,
    source_table,
    source_id,
    COALESCE(source_line_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_discriminator
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_events_store_recorded
  ON quality_events(store_id, recorded_at DESC, archived_at);

CREATE INDEX IF NOT EXISTS idx_quality_events_store_occurred
  ON quality_events(store_id, occurred_at DESC, archived_at);

CREATE INDEX IF NOT EXISTS idx_quality_events_source
  ON quality_events(store_id, source_table, source_id, source_line_id, source_discriminator)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_events_type_status
  ON quality_events(store_id, event_type, event_status, occurred_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_events_payload
  ON quality_events USING gin (payload);

CREATE INDEX IF NOT EXISTS idx_quality_evidence_records_event
  ON quality_evidence_records(store_id, quality_event_id, evidence_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_evidence_records_store_type
  ON quality_evidence_records(store_id, evidence_type, evidence_status, evidence_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_evidence_records_source
  ON quality_evidence_records(store_id, source_record_type, source_record_id)
  WHERE source_record_type IS NOT NULL AND source_record_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_evidence_records_task
  ON quality_evidence_records(store_id, quality_task_id, occurrence_id)
  WHERE quality_task_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_evidence_records_master_document
  ON quality_evidence_records(store_id, master_document_id)
  WHERE master_document_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_evidence_records_payload
  ON quality_evidence_records USING gin (payload);

CREATE OR REPLACE FUNCTION set_quality_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_quality_evidence_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quality_events_updated_at ON quality_events;

CREATE TRIGGER trg_quality_events_updated_at
BEFORE UPDATE ON quality_events
FOR EACH ROW
EXECUTE FUNCTION set_quality_events_updated_at();

DROP TRIGGER IF EXISTS trg_quality_evidence_records_updated_at ON quality_evidence_records;

CREATE TRIGGER trg_quality_evidence_records_updated_at
BEFORE UPDATE ON quality_evidence_records
FOR EACH ROW
EXECUTE FUNCTION set_quality_evidence_records_updated_at();

COMMIT;
