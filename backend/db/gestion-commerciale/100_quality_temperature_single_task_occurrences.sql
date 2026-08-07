-- Temperature scheduling canonicalization.
-- Additive/idempotent: preserves parameters, records, procedures, historical occurrences and legacy task links.
-- Rollback can use quality_temperature_limit_task_migration_audit to restore previous active slot links/tasks.

CREATE TABLE IF NOT EXISTS quality_temperature_limit_task_migration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migrated_at timestamptz NOT NULL DEFAULT now(),
  limit_id uuid NOT NULL REFERENCES quality_temperature_limits(id) ON DELETE CASCADE,
  scheduled_day text NOT NULL,
  target_time time NOT NULL,
  task_id uuid NOT NULL REFERENCES quality_tasks(id) ON DELETE CASCADE,
  was_canonical boolean NOT NULL DEFAULT false,
  task_title text,
  task_status text,
  task_active boolean,
  task_archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_quality_temperature_limit_task_migration_audit_limit
  ON quality_temperature_limit_task_migration_audit (limit_id, migrated_at DESC);

WITH native_limits AS (
  SELECT l.id AS limit_id,
         COALESCE(
           l.quality_task_id,
           (
             SELECT ltt.task_id
             FROM quality_temperature_limit_tasks ltt
             WHERE ltt.limit_id = l.id AND ltt.deleted_at IS NULL
             ORDER BY ltt.scheduled_day ASC, ltt.target_time ASC
             LIMIT 1
           )
         ) AS canonical_task_id
  FROM quality_temperature_limits l
  WHERE jsonb_array_length(COALESCE(l.target_times, '[]'::jsonb)) > 0
),
active_links AS (
  SELECT ltt.limit_id, ltt.scheduled_day, ltt.target_time, ltt.task_id,
         nl.canonical_task_id, qt.title, qt.status, qt.active, qt.archived_at
  FROM quality_temperature_limit_tasks ltt
  INNER JOIN native_limits nl ON nl.limit_id = ltt.limit_id AND nl.canonical_task_id IS NOT NULL
  LEFT JOIN quality_tasks qt ON qt.id = ltt.task_id
  WHERE ltt.deleted_at IS NULL
)
INSERT INTO quality_temperature_limit_task_migration_audit (
  limit_id, scheduled_day, target_time, task_id, was_canonical,
  task_title, task_status, task_active, task_archived_at
)
SELECT limit_id, scheduled_day, target_time, task_id,
       task_id = canonical_task_id,
       title, status, active, archived_at
FROM active_links
WHERE NOT EXISTS (
  SELECT 1
  FROM quality_temperature_limit_task_migration_audit audit
  WHERE audit.limit_id = active_links.limit_id
    AND audit.scheduled_day = active_links.scheduled_day
    AND audit.target_time = active_links.target_time
    AND audit.task_id = active_links.task_id
);

WITH native_limits AS (
  SELECT l.id AS limit_id,
         COALESCE(
           l.quality_task_id,
           (
             SELECT ltt.task_id
             FROM quality_temperature_limit_tasks ltt
             WHERE ltt.limit_id = l.id AND ltt.deleted_at IS NULL
             ORDER BY ltt.scheduled_day ASC, ltt.target_time ASC
             LIMIT 1
           )
         ) AS canonical_task_id
  FROM quality_temperature_limits l
  WHERE jsonb_array_length(COALESCE(l.target_times, '[]'::jsonb)) > 0
)
UPDATE quality_temperature_limits l
SET quality_task_id = nl.canonical_task_id,
    updated_at = now()
FROM native_limits nl
WHERE l.id = nl.limit_id
  AND nl.canonical_task_id IS NOT NULL
  AND l.quality_task_id IS DISTINCT FROM nl.canonical_task_id;

WITH native_limits AS (
  SELECT l.id AS limit_id,
         l.quality_task_id AS canonical_task_id,
         COALESCE(e.name, z.name, tt.label, l.type_code, 'temperature') AS target_label,
         l.is_active
  FROM quality_temperature_limits l
  LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
  LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
  LEFT JOIN quality_temperature_types tt ON tt.code = l.type_code
  WHERE l.quality_task_id IS NOT NULL
    AND jsonb_array_length(COALESCE(l.target_times, '[]'::jsonb)) > 0
)
UPDATE quality_tasks qt
SET title = CONCAT('Releve temperature - ', native_limits.target_label),
    target_time = NULL,
    frequency_value = 1,
    frequency_unit = 'days',
    status = CASE WHEN native_limits.is_active THEN 'planned' ELSE 'paused' END,
    active = native_limits.is_active,
    configuration_status = CASE WHEN native_limits.is_active THEN 'active' ELSE 'inactive' END,
    source_entity_type = 'temperature_parameter',
    source_entity_id = native_limits.limit_id,
    source_locked = true,
    task_origin = 'SYSTEM',
    updated_at = now()
FROM native_limits
WHERE qt.id = native_limits.canonical_task_id;

WITH native_limits AS (
  SELECT l.id AS limit_id, l.quality_task_id AS canonical_task_id
  FROM quality_temperature_limits l
  WHERE l.quality_task_id IS NOT NULL
    AND jsonb_array_length(COALESCE(l.target_times, '[]'::jsonb)) > 0
),
legacy_tasks AS (
  SELECT DISTINCT ltt.task_id
  FROM quality_temperature_limit_tasks ltt
  INNER JOIN native_limits nl ON nl.limit_id = ltt.limit_id
  WHERE ltt.deleted_at IS NULL
    AND ltt.task_id IS DISTINCT FROM nl.canonical_task_id
)
UPDATE quality_tasks qt
SET active = false,
    status = 'archived',
    configuration_status = 'archived',
    archived_at = COALESCE(qt.archived_at, now()),
    updated_at = now()
FROM legacy_tasks
WHERE qt.id = legacy_tasks.task_id;

WITH native_limits AS (
  SELECT l.id AS limit_id, l.quality_task_id AS canonical_task_id
  FROM quality_temperature_limits l
  WHERE l.quality_task_id IS NOT NULL
    AND jsonb_array_length(COALESCE(l.target_times, '[]'::jsonb)) > 0
)
UPDATE quality_temperature_limit_tasks ltt
SET deleted_at = COALESCE(ltt.deleted_at, now())
FROM native_limits nl
WHERE ltt.limit_id = nl.limit_id
  AND ltt.deleted_at IS NULL
  AND (
    ltt.task_id IS DISTINCT FROM nl.canonical_task_id
    OR ltt.scheduled_day <> 'any'
    OR ltt.target_time <> '00:00'::time
  );

INSERT INTO quality_temperature_limit_tasks (limit_id, scheduled_day, target_time, task_id, created_at)
SELECT l.id, 'any', '00:00'::time, l.quality_task_id, now()
FROM quality_temperature_limits l
WHERE l.quality_task_id IS NOT NULL
  AND jsonb_array_length(COALESCE(l.target_times, '[]'::jsonb)) > 0
ON CONFLICT (limit_id, scheduled_day, target_time)
DO UPDATE SET task_id = EXCLUDED.task_id,
              deleted_at = NULL,
              deleted_by = NULL;
