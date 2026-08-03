-- Quality operational workstation.
-- Additive/idempotent: existing tasks, records, plans and temperature parameters remain untouched.

CREATE TABLE IF NOT EXISTS quality_task_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES quality_tasks(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  due_date date NOT NULL,
  due_time time,
  status text NOT NULL DEFAULT 'planned',
  source_entity_type text,
  source_entity_id uuid,
  source_record_type text,
  source_record_id uuid,
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  result_status text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_task_occurrences_status_check CHECK (
    status IN ('planned', 'due', 'completed', 'late', 'skipped', 'cancelled', 'not_applicable')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_task_occurrences_task_due
  ON quality_task_occurrences (task_id, due_at);

CREATE INDEX IF NOT EXISTS idx_quality_task_occurrences_store_due
  ON quality_task_occurrences (store_id, due_date, status);

CREATE INDEX IF NOT EXISTS idx_quality_task_occurrences_source_record
  ON quality_task_occurrences (store_id, source_record_type, source_record_id);

ALTER TABLE quality_temperature_records
  ADD COLUMN IF NOT EXISTS temperature_limit_id uuid REFERENCES quality_temperature_limits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quality_task_id uuid REFERENCES quality_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS occurrence_id uuid REFERENCES quality_task_occurrences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS method_used text;

CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_task
  ON quality_temperature_records (quality_task_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_occurrence
  ON quality_temperature_records (occurrence_id);

ALTER TABLE quality_cleaning_records
  ADD COLUMN IF NOT EXISTS occurrence_id uuid REFERENCES quality_task_occurrences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visual_check_status text,
  ADD COLUMN IF NOT EXISTS anomaly_comment text,
  ADD COLUMN IF NOT EXISTS corrective_action text,
  ADD COLUMN IF NOT EXISTS evidence_photo_id uuid REFERENCES quality_photos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_document_id uuid REFERENCES quality_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS execution_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_records_occurrence
  ON quality_cleaning_records (occurrence_id);

CREATE TABLE IF NOT EXISTS quality_non_conformities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  origin_type text NOT NULL,
  origin_record_id uuid,
  quality_task_id uuid REFERENCES quality_tasks(id) ON DELETE SET NULL,
  occurrence_id uuid REFERENCES quality_task_occurrences(id) ON DELETE SET NULL,
  source_entity_type text,
  source_entity_id uuid,
  zone_id uuid REFERENCES quality_zones(id) ON DELETE SET NULL,
  equipment_id uuid REFERENCES quality_equipments(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL,
  immediate_action text,
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open',
  closure_validation_required boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  closure_comment text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_non_conformities_status_check CHECK (status IN ('open', 'in_progress', 'closed', 'cancelled')),
  CONSTRAINT quality_non_conformities_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_quality_non_conformities_store_status
  ON quality_non_conformities (store_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_quality_non_conformities_origin
  ON quality_non_conformities (store_id, origin_type, origin_record_id);

CREATE TABLE IF NOT EXISTS quality_corrective_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  non_conformity_id uuid REFERENCES quality_non_conformities(id) ON DELETE CASCADE,
  quality_task_id uuid REFERENCES quality_tasks(id) ON DELETE SET NULL,
  action text NOT NULL,
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at timestamptz,
  proof_document_id uuid REFERENCES quality_documents(id) ON DELETE SET NULL,
  proof_photo_id uuid REFERENCES quality_photos(id) ON DELETE SET NULL,
  effectiveness_check text,
  validation_comment text,
  status text NOT NULL DEFAULT 'open',
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_corrective_actions_status_check CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_quality_corrective_actions_nc
  ON quality_corrective_actions (non_conformity_id, status);
