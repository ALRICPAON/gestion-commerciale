-- PR Q4.2 - Link temperature settings to generic quality tasks.
-- Idempotent and additive: legacy frequency columns remain available.

ALTER TABLE quality_temperature_limits
  ADD COLUMN IF NOT EXISTS quality_task_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_temperature_limits_quality_task_fk'
      AND conrelid = 'quality_temperature_limits'::regclass
  ) THEN
    ALTER TABLE quality_temperature_limits
      ADD CONSTRAINT quality_temperature_limits_quality_task_fk
      FOREIGN KEY (quality_task_id)
      REFERENCES quality_tasks(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_quality_temperature_limits_task
  ON quality_temperature_limits (quality_task_id);
