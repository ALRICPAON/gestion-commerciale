-- Quality manual execution records.
-- Additive/idempotent: preserves existing manual tasks and occurrence history.

CREATE TABLE IF NOT EXISTS quality_manual_task_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  quality_task_id uuid NOT NULL REFERENCES quality_tasks(id) ON DELETE CASCADE,
  occurrence_id uuid REFERENCES quality_task_occurrences(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  result_status text NOT NULL DEFAULT 'completed',
  conformity_status text NOT NULL DEFAULT 'conform',
  observation text,
  corrective_action text,
  evidence_photo_id uuid REFERENCES quality_photos(id) ON DELETE SET NULL,
  evidence_document_id uuid REFERENCES quality_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_manual_task_records_result_check CHECK (
    result_status IN ('completed', 'partial', 'not_applicable', 'issue')
  ),
  CONSTRAINT quality_manual_task_records_conformity_check CHECK (
    conformity_status IN ('conform', 'non_conform', 'not_applicable')
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_manual_task_records_store_date
  ON quality_manual_task_records (store_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_manual_task_records_task
  ON quality_manual_task_records (quality_task_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_manual_task_records_occurrence
  ON quality_manual_task_records (occurrence_id);
