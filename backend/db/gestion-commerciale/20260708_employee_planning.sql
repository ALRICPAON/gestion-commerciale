CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NULL,
  user_id uuid NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NULL,
  phone text NULL,
  job_title text NULL,
  contract_type text NOT NULL DEFAULT 'CDI',
  weekly_hours numeric(6,2) NOT NULL DEFAULT 35,
  hire_date date NULL,
  leave_date date NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS store_id uuid NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id uuid NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email text NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title text NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'CDI';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_hours numeric(6,2) NOT NULL DEFAULT 35;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date date NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_date date NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS employee_planning_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NULL,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  notes text NULL,
  created_by uuid NULL,
  validated_by uuid NULL,
  validated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS store_id uuid NULL;
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS week_start date;
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS notes text NULL;
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS created_by uuid NULL;
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS validated_by uuid NULL;
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS validated_at timestamptz NULL;
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE employee_planning_weeks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS employee_planning_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_week_id uuid NOT NULL REFERENCES employee_planning_weeks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  planned_start time NULL,
  planned_end time NULL,
  planned_break_minutes integer NOT NULL DEFAULT 0,
  actual_start time NULL,
  actual_end time NULL,
  actual_break_minutes integer NOT NULL DEFAULT 0,
  day_type text NOT NULL DEFAULT 'worked',
  employee_comment text NULL,
  manager_comment text NULL,
  employee_validated_at timestamptz NULL,
  employee_validated_by_user_id uuid NULL,
  employee_validation_ip text NULL,
  employee_validation_user_agent text NULL,
  manager_validated_at timestamptz NULL,
  manager_validated_by_user_id uuid NULL,
  manager_validation_ip text NULL,
  manager_validation_user_agent text NULL,
  planned_hours numeric(8,2) NULL,
  actual_hours numeric(8,2) NULL,
  night_hours numeric(8,2) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS planning_week_id uuid;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS work_date date;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS planned_start time NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS planned_end time NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS planned_break_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS actual_start time NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS actual_end time NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS actual_break_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS day_type text NOT NULL DEFAULT 'worked';
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS employee_comment text NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS manager_comment text NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS employee_validated_at timestamptz NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS employee_validated_by_user_id uuid NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS employee_validation_ip text NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS employee_validation_user_agent text NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS manager_validated_at timestamptz NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS manager_validated_by_user_id uuid NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS manager_validation_ip text NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS manager_validation_user_agent text NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS planned_hours numeric(8,2) NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS actual_hours numeric(8,2) NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS night_hours numeric(8,2) NULL;
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE employee_planning_lines ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS employee_absence_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  absence_type text NOT NULL DEFAULT 'paid_leave',
  status text NOT NULL DEFAULT 'pending',
  employee_comment text NULL,
  manager_comment text NULL,
  decided_by uuid NULL,
  decided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS absence_type text NOT NULL DEFAULT 'paid_leave';
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS employee_comment text NULL;
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS manager_comment text NULL;
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS decided_by uuid NULL;
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS decided_at timestamptz NULL;
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE employee_absence_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_planning_weeks_store_week
  ON employee_planning_weeks(store_id, week_start);

CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_planning_lines_week_employee_date
  ON employee_planning_lines(planning_week_id, employee_id, work_date);

CREATE INDEX IF NOT EXISTS idx_employees_store_active
  ON employees(store_id, is_active);

CREATE INDEX IF NOT EXISTS idx_employees_store_user
  ON employees(store_id, user_id);

CREATE INDEX IF NOT EXISTS idx_employee_planning_weeks_store_week_start
  ON employee_planning_weeks(store_id, week_start);

CREATE INDEX IF NOT EXISTS idx_employee_planning_lines_employee_date
  ON employee_planning_lines(employee_id, work_date);

CREATE INDEX IF NOT EXISTS idx_employee_absence_requests_employee_dates
  ON employee_absence_requests(employee_id, start_date, end_date);
