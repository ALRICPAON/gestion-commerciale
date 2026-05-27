CREATE TABLE department_sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color_hex VARCHAR(7),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT department_sectors_unique_code_per_department
    UNIQUE (department_id, code)
);

CREATE INDEX idx_department_sectors_department_id
  ON department_sectors(department_id);

CREATE OR REPLACE FUNCTION set_department_sectors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_department_sectors_updated_at ON department_sectors;

CREATE TRIGGER trg_department_sectors_updated_at
BEFORE UPDATE ON department_sectors
FOR EACH ROW
EXECUTE FUNCTION set_department_sectors_updated_at();