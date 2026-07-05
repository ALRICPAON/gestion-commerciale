CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  description text,
  surface_area numeric(10, 2),
  capacity text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_zones_store_code_unique UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_quality_zones_store_id ON quality_zones(store_id);
CREATE INDEX IF NOT EXISTS idx_quality_zones_status ON quality_zones(status);
CREATE INDEX IF NOT EXISTS idx_quality_zones_type ON quality_zones(type);
CREATE INDEX IF NOT EXISTS idx_quality_zones_store_status ON quality_zones(store_id, status);

CREATE TABLE IF NOT EXISTS quality_equipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES quality_zones(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  description text,
  manufacturer text,
  model text,
  serial_number text,
  supplier_name text,
  purchase_date date,
  warranty_end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'out_of_service', 'archived')),
  is_food_contact boolean NOT NULL DEFAULT false,
  is_temperature_controlled boolean NOT NULL DEFAULT false,
  requires_cleaning boolean NOT NULL DEFAULT false,
  requires_maintenance boolean NOT NULL DEFAULT false,
  requires_calibration boolean NOT NULL DEFAULT false,
  criticality text NOT NULL DEFAULT 'medium' CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_equipments_store_code_unique UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_quality_equipments_store_id ON quality_equipments(store_id);
CREATE INDEX IF NOT EXISTS idx_quality_equipments_zone_id ON quality_equipments(zone_id);
CREATE INDEX IF NOT EXISTS idx_quality_equipments_status ON quality_equipments(status);
CREATE INDEX IF NOT EXISTS idx_quality_equipments_type ON quality_equipments(type);
CREATE INDEX IF NOT EXISTS idx_quality_equipments_store_status ON quality_equipments(store_id, status);
