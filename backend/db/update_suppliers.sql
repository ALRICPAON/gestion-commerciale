CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  code VARCHAR(50),
  name VARCHAR(200) NOT NULL,

  contact_name VARCHAR(150),
  phone VARCHAR(50),
  email VARCHAR(150),
  address TEXT,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (store_id, name)
);