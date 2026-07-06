-- PR Q4.1 - Generic quality task engine foundation
-- Idempotent migration: generic planning tables for all future QMS modules.

CREATE TABLE IF NOT EXISTS quality_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  module_key text NOT NULL,
  entity_type text,
  entity_id uuid,
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  frequency_value integer,
  frequency_unit text,
  target_time time,
  next_due_at timestamptz,
  last_completed_at timestamptz,
  status text NOT NULL DEFAULT 'planned',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_tasks_frequency_value_check CHECK (frequency_value IS NULL OR frequency_value > 0),
  CONSTRAINT quality_tasks_frequency_unit_check CHECK (
    frequency_unit IS NULL OR frequency_unit IN ('hours', 'days', 'weeks', 'months', 'events')
  ),
  CONSTRAINT quality_tasks_status_check CHECK (
    status IN ('planned', 'due', 'overdue', 'completed', 'paused', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_tasks_store_module
  ON quality_tasks (store_id, module_key);

CREATE INDEX IF NOT EXISTS idx_quality_tasks_store_due
  ON quality_tasks (store_id, active, next_due_at);

CREATE INDEX IF NOT EXISTS idx_quality_tasks_store_responsible
  ON quality_tasks (store_id, responsible_user_id);

CREATE INDEX IF NOT EXISTS idx_quality_tasks_entity
  ON quality_tasks (store_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS quality_task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES quality_tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  status text NOT NULL,
  previous_due_at timestamptz,
  next_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_task_history_status_check CHECK (
    status IN ('planned', 'due', 'overdue', 'completed', 'paused', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_task_history_task
  ON quality_task_history (task_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_task_history_store
  ON quality_task_history (store_id, completed_at DESC);
