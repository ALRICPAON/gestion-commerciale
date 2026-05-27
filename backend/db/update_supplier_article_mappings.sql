CREATE TABLE supplier_article_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  supplier_ref VARCHAR(100),
  supplier_label VARCHAR(200),

  purchase_unit VARCHAR(20),
  conversion_to_stock NUMERIC(10,3),

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (supplier_id, supplier_ref)
);