CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  code VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),

  supplier_type VARCHAR(50) NOT NULL DEFAULT 'standard',
  status VARCHAR(30) NOT NULL DEFAULT 'active',

  contact_name VARCHAR(255),
  phone VARCHAR(50),
  mobile VARCHAR(50),
  email VARCHAR(255),

  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  postal_code VARCHAR(20),
  city VARCHAR(120),
  country VARCHAR(120) DEFAULT 'France',

  vat_number VARCHAR(80),
  siret VARCHAR(80),

  payment_terms VARCHAR(120),
  delivery_terms VARCHAR(120),

  notes TEXT,

  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT suppliers_store_code_unique UNIQUE (store_id, code),
  CONSTRAINT suppliers_status_check CHECK (status IN ('active', 'inactive', 'blocked')),
  CONSTRAINT suppliers_type_check CHECK (
    supplier_type IN (
      'standard',
      'mareyeur',
      'criee',
      'importateur',
      'transporteur',
      'emballage',
      'autre'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_suppliers_store_id
ON suppliers(store_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_store_status
ON suppliers(store_id, status);

CREATE INDEX IF NOT EXISTS idx_suppliers_store_type
ON suppliers(store_id, supplier_type);

CREATE OR REPLACE FUNCTION set_suppliers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;

CREATE TRIGGER trg_suppliers_updated_at
BEFORE UPDATE ON suppliers
FOR EACH ROW
EXECUTE FUNCTION set_suppliers_updated_at();