CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS supplier_article_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  article_id uuid NOT NULL REFERENCES articles(id),
  supplier_ref text NOT NULL,
  supplier_label text,
  purchase_unit text DEFAULT 'kg',
  price_unit text DEFAULT 'kg',
  is_active boolean DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(supplier_id, supplier_ref)
);

ALTER TABLE supplier_article_mappings
  ADD COLUMN IF NOT EXISTS purchase_unit text DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS price_unit text DEFAULT 'kg';

CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_store
  ON supplier_article_mappings(store_id);

CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_supplier_id
  ON supplier_article_mappings(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_article
  ON supplier_article_mappings(article_id);

CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_ref
  ON supplier_article_mappings(supplier_ref);
