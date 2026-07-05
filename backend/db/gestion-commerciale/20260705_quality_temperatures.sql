CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_temperature_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  default_unit text NOT NULL DEFAULT '°C',
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO quality_temperature_types (code, label, default_unit, category) VALUES
  ('COLD_ROOM', 'Chambre froide', '°C', 'storage'),
  ('WORKSHOP', 'Atelier', '°C', 'zone'),
  ('RECEPTION_PRODUCTS', 'Réception produits', '°C', 'process'),
  ('SHIPPING', 'Expédition', '°C', 'process'),
  ('VEHICLE', 'Véhicule', '°C', 'transport'),
  ('LIVE_TANK', 'Vivier', '°C', 'live_products'),
  ('FREEZER', 'Congélateur', '°C', 'storage'),
  ('PRODUCT_TEMPERATURE', 'Température produit', '°C', 'product')
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label,
    default_unit = EXCLUDED.default_unit,
    category = EXCLUDED.category,
    is_active = true;

CREATE TABLE IF NOT EXISTS quality_temperature_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type_code text NOT NULL REFERENCES quality_temperature_types(code),
  zone_id uuid REFERENCES quality_zones(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES quality_equipments(id) ON DELETE CASCADE,
  min_value numeric(8, 2),
  max_value numeric(8, 2),
  unit text NOT NULL DEFAULT '°C',
  is_active boolean NOT NULL DEFAULT true,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_temperature_limits_bounds_check CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
  CONSTRAINT quality_temperature_limits_range_check CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE INDEX IF NOT EXISTS idx_quality_temperature_limits_store ON quality_temperature_limits(store_id);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_limits_type ON quality_temperature_limits(type_code);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_limits_zone ON quality_temperature_limits(zone_id);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_limits_equipment ON quality_temperature_limits(equipment_id);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_limits_active ON quality_temperature_limits(store_id, is_active);

CREATE TABLE IF NOT EXISTS quality_temperature_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES quality_zones(id) ON DELETE SET NULL,
  equipment_id uuid REFERENCES quality_equipments(id) ON DELETE SET NULL,
  type_code text NOT NULL REFERENCES quality_temperature_types(code),
  value numeric(8, 2) NOT NULL,
  unit text NOT NULL DEFAULT '°C',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'iot', 'import', 'api')),
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  comment text,
  evidence_photo_id uuid REFERENCES quality_photos(id) ON DELETE SET NULL,
  evidence_document_id uuid REFERENCES quality_documents(id) ON DELETE SET NULL,
  min_limit numeric(8, 2),
  max_limit numeric(8, 2),
  alert_status text NOT NULL DEFAULT 'warning' CHECK (alert_status IN ('compliant', 'warning', 'out_of_limits')),
  alert_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_store ON quality_temperature_records(store_id);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_recorded_at ON quality_temperature_records(recorded_at);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_type ON quality_temperature_records(type_code);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_zone ON quality_temperature_records(zone_id);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_equipment ON quality_temperature_records(equipment_id);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_alert ON quality_temperature_records(store_id, alert_status);
CREATE INDEX IF NOT EXISTS idx_quality_temperature_records_source ON quality_temperature_records(source);
