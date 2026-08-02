-- Cleaning plans multi-zone / multi-equipment targets.
-- Additive and idempotent: legacy zone_id/equipment_id columns remain for compatibility.
-- Cleaning plans are the PMS source of truth; linked quality tasks are synchronized from plan fields.

ALTER TABLE quality_cleaning_plans
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS frequency_value integer,
  ADD COLUMN IF NOT EXISTS frequency_unit text,
  ADD COLUMN IF NOT EXISTS target_time time,
  ADD COLUMN IF NOT EXISTS scheduled_days jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_cleaning_plans_frequency_value_check'
  ) THEN
    ALTER TABLE quality_cleaning_plans
      ADD CONSTRAINT quality_cleaning_plans_frequency_value_check CHECK (
        frequency_value IS NULL OR frequency_value > 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_cleaning_plans_frequency_unit_check'
  ) THEN
    ALTER TABLE quality_cleaning_plans
      ADD CONSTRAINT quality_cleaning_plans_frequency_unit_check CHECK (
        frequency_unit IS NULL OR frequency_unit IN ('hours', 'days', 'weeks', 'months', 'events')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_responsible
  ON quality_cleaning_plans (store_id, responsible_user_id);

CREATE TABLE IF NOT EXISTS quality_cleaning_plan_zones (
  plan_id uuid NOT NULL REFERENCES quality_cleaning_plans(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES quality_zones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (plan_id, zone_id)
);

CREATE TABLE IF NOT EXISTS quality_cleaning_plan_equipments (
  plan_id uuid NOT NULL REFERENCES quality_cleaning_plans(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES quality_equipments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (plan_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plan_zones_zone
  ON quality_cleaning_plan_zones (zone_id, plan_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plan_zones_active_plan
  ON quality_cleaning_plan_zones (plan_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plan_equipments_equipment
  ON quality_cleaning_plan_equipments (equipment_id, plan_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plan_equipments_active_plan
  ON quality_cleaning_plan_equipments (plan_id)
  WHERE deleted_at IS NULL;

INSERT INTO quality_cleaning_plan_zones (plan_id, zone_id, created_at, created_by)
SELECT p.id, p.zone_id, COALESCE(p.created_at, now()), p.created_by
FROM quality_cleaning_plans p
WHERE p.zone_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM quality_cleaning_plan_zones pz
    WHERE pz.plan_id = p.id AND pz.zone_id = p.zone_id
  );

INSERT INTO quality_cleaning_plan_equipments (plan_id, equipment_id, created_at, created_by)
SELECT p.id, p.equipment_id, COALESCE(p.created_at, now()), p.created_by
FROM quality_cleaning_plans p
WHERE p.equipment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM quality_cleaning_plan_equipments pe
    WHERE pe.plan_id = p.id AND pe.equipment_id = p.equipment_id
  );
