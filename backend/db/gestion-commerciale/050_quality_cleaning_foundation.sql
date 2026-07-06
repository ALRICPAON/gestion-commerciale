-- PR Q5.1 - Cleaning & Disinfection foundation.
-- Idempotent and additive: quality_tasks remains the official scheduler.

CREATE TABLE IF NOT EXISTS quality_cleaning_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  zone_id uuid REFERENCES quality_zones(id) ON DELETE SET NULL,
  equipment_id uuid REFERENCES quality_equipments(id) ON DELETE SET NULL,
  product_name text,
  method text,
  safety_instructions text,
  expected_duration_minutes integer,
  quality_task_id uuid REFERENCES quality_tasks(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_cleaning_plans_duration_check CHECK (
    expected_duration_minutes IS NULL OR expected_duration_minutes > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_store
  ON quality_cleaning_plans (store_id, active);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_zone
  ON quality_cleaning_plans (store_id, zone_id);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_equipment
  ON quality_cleaning_plans (store_id, equipment_id);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_task
  ON quality_cleaning_plans (quality_task_id);

CREATE TABLE IF NOT EXISTS quality_cleaning_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cleaning_plan_id uuid NOT NULL REFERENCES quality_cleaning_plans(id) ON DELETE CASCADE,
  quality_task_id uuid REFERENCES quality_tasks(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'done',
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_cleaning_records_status_check CHECK (
    status IN ('done', 'partial', 'not_done', 'issue')
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_records_store
  ON quality_cleaning_records (store_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_records_plan
  ON quality_cleaning_records (cleaning_plan_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_records_task
  ON quality_cleaning_records (quality_task_id, performed_at DESC);
