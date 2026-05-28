CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,

  code TEXT,
  name TEXT NOT NULL,
  legal_name TEXT,
  client_type TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active',

  contact_name TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,

  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT DEFAULT 'France',

  vat_number TEXT,
  siret TEXT,

  payment_terms TEXT,
  delivery_terms TEXT,

  notes TEXT,

  created_by UUID,
  updated_by UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT clients_store_code_unique UNIQUE (store_id, code)
);
