BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS supplier_article_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
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
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE supplier_article_mappings
  ADD COLUMN IF NOT EXISTS client_key text,
  ADD COLUMN IF NOT EXISTS purchase_unit text DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS price_unit text DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS supplier_designation_original text,
  ADD COLUMN IF NOT EXISTS supplier_designation_normalized text,
  ADD COLUMN IF NOT EXISTS mapping_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confidence_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

UPDATE supplier_article_mappings
SET supplier_designation_original = COALESCE(supplier_designation_original, supplier_label, supplier_ref),
    supplier_designation_normalized = COALESCE(
      supplier_designation_normalized,
      lower(regexp_replace(trim(COALESCE(supplier_label, supplier_ref, '')), '\s+', ' ', 'g'))
    )
WHERE supplier_designation_original IS NULL
   OR supplier_designation_normalized IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'supplier_article_mappings'::regclass
      AND conname = 'supplier_article_mappings_supplier_id_supplier_ref_key'
  ) THEN
    ALTER TABLE supplier_article_mappings
      DROP CONSTRAINT supplier_article_mappings_supplier_id_supplier_ref_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_article_mappings_store_supplier_ref_active
  ON supplier_article_mappings(store_id, supplier_id, supplier_ref)
  WHERE COALESCE(is_active, true) = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_article_mappings_store_supplier_normalized_active
  ON supplier_article_mappings(store_id, supplier_id, supplier_designation_normalized)
  WHERE COALESCE(is_active, true) = true;

CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_normalized
  ON supplier_article_mappings(store_id, supplier_id, supplier_designation_normalized);

COMMIT;
