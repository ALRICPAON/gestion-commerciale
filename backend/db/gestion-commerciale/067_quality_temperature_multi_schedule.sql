-- Temperature parameter native scheduling.
-- Additive/idempotent: legacy target_time and quality_task_id stay available.

ALTER TABLE quality_temperature_limits
  ADD COLUMN IF NOT EXISTS scheduled_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS target_times jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_quality_temperature_limits_schedule
  ON quality_temperature_limits USING gin (scheduled_days);

CREATE TABLE IF NOT EXISTS quality_temperature_limit_tasks (
  limit_id uuid NOT NULL REFERENCES quality_temperature_limits(id) ON DELETE CASCADE,
  scheduled_day text NOT NULL DEFAULT 'any',
  target_time time NOT NULL DEFAULT '00:00',
  task_id uuid NOT NULL REFERENCES quality_tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (limit_id, scheduled_day, target_time)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_temperature_limit_tasks_day_check'
      AND conrelid = 'quality_temperature_limit_tasks'::regclass
  ) THEN
    ALTER TABLE quality_temperature_limit_tasks
      ADD CONSTRAINT quality_temperature_limit_tasks_day_check
      CHECK (scheduled_day IN ('any', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_quality_temperature_limit_tasks_task
  ON quality_temperature_limit_tasks (task_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_temperature_limit_tasks_active_limit
  ON quality_temperature_limit_tasks (limit_id, scheduled_day, target_time)
  WHERE deleted_at IS NULL;

INSERT INTO quality_temperature_limit_tasks (limit_id, scheduled_day, target_time, task_id, created_at, created_by)
SELECT l.id, 'any', COALESCE(l.target_time, '00:00'::time), l.quality_task_id, COALESCE(l.created_at, now()), l.created_by
FROM quality_temperature_limits l
WHERE l.quality_task_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM quality_temperature_limit_tasks lt
    WHERE lt.limit_id = l.id
      AND lt.task_id = l.quality_task_id
      AND lt.deleted_at IS NULL
  );
