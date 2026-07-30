-- Agent ALTA quality configuration write support.
-- Idempotent and additive: no operational record or history is modified or deleted.

ALTER TABLE quality_tasks
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS responsible_role text,
  ADD COLUMN IF NOT EXISTS criticality text,
  ADD COLUMN IF NOT EXISTS execution_method text,
  ADD COLUMN IF NOT EXISTS verification_method text,
  ADD COLUMN IF NOT EXISTS proof_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS acceptance_criteria text,
  ADD COLUMN IF NOT EXISTS deviation_action text,
  ADD COLUMN IF NOT EXISTS configuration_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_source text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS created_by_agent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_action_id text;

ALTER TABLE quality_cleaning_plans
  ADD COLUMN IF NOT EXISTS dosage_concentration text,
  ADD COLUMN IF NOT EXISTS usage_temperature text,
  ADD COLUMN IF NOT EXISTS contact_time_minutes integer,
  ADD COLUMN IF NOT EXISTS rinse_required boolean,
  ADD COLUMN IF NOT EXISTS material_used text,
  ADD COLUMN IF NOT EXISTS post_cleaning_check text,
  ADD COLUMN IF NOT EXISTS expected_proof text,
  ADD COLUMN IF NOT EXISTS corrective_action text,
  ADD COLUMN IF NOT EXISTS configuration_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS validation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_source text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS created_by_agent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_action_id text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_tasks_status_check'
  ) THEN
    ALTER TABLE quality_tasks DROP CONSTRAINT quality_tasks_status_check;
  END IF;

  ALTER TABLE quality_tasks
    ADD CONSTRAINT quality_tasks_status_check CHECK (
      status IN ('draft', 'pending_review', 'planned', 'due', 'overdue', 'completed', 'paused', 'cancelled', 'archived')
    );

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_task_history_status_check'
  ) THEN
    ALTER TABLE quality_task_history DROP CONSTRAINT quality_task_history_status_check;
  END IF;

  ALTER TABLE quality_task_history
    ADD CONSTRAINT quality_task_history_status_check CHECK (
      status IN ('draft', 'pending_review', 'planned', 'due', 'overdue', 'completed', 'paused', 'cancelled', 'archived')
    );
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_tasks_configuration_status_check'
  ) THEN
    ALTER TABLE quality_tasks
      ADD CONSTRAINT quality_tasks_configuration_status_check CHECK (
        configuration_status IN ('draft', 'pending_review', 'active', 'inactive', 'archived')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_tasks_criticality_check'
  ) THEN
    ALTER TABLE quality_tasks
      ADD CONSTRAINT quality_tasks_criticality_check CHECK (
        criticality IS NULL OR criticality IN ('low', 'medium', 'high', 'critical')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_cleaning_plans_configuration_status_check'
  ) THEN
    ALTER TABLE quality_cleaning_plans
      ADD CONSTRAINT quality_cleaning_plans_configuration_status_check CHECK (
        configuration_status IN ('draft', 'pending_review', 'active', 'inactive', 'archived')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_cleaning_plans_contact_time_check'
  ) THEN
    ALTER TABLE quality_cleaning_plans
      ADD CONSTRAINT quality_cleaning_plans_contact_time_check CHECK (
        contact_time_minutes IS NULL OR contact_time_minutes > 0
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quality_tasks_store_configuration_status
  ON quality_tasks (store_id, configuration_status);

CREATE INDEX IF NOT EXISTS idx_quality_tasks_agent_source
  ON quality_tasks (store_id, created_source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_store_configuration_status
  ON quality_cleaning_plans (store_id, configuration_status);

CREATE INDEX IF NOT EXISTS idx_quality_cleaning_plans_agent_source
  ON quality_cleaning_plans (store_id, created_source, created_at DESC);
