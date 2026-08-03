-- Canonical quality execution sources.
-- Additive/idempotent: records why a control was created outside a scheduled occurrence.

ALTER TABLE quality_temperature_records
  ADD COLUMN IF NOT EXISTS exceptional_reason text;

ALTER TABLE quality_cleaning_records
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS exceptional_reason text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_source_occurrence
  ON quality_temperature_records (store_id, source, occurrence_id);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_records_source_occurrence
  ON quality_cleaning_records (store_id, source, occurrence_id);
