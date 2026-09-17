BEGIN;

CREATE TABLE IF NOT EXISTS transport_preparation_supplier_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sales_document_id uuid NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_key text NOT NULL,
  supplier_name_snapshot text NOT NULL,
  is_selected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_transport_preparation_supplier_selection
    UNIQUE (store_id, sales_document_id, supplier_key)
);

CREATE INDEX IF NOT EXISTS idx_transport_preparation_supplier_selection_document
  ON transport_preparation_supplier_selections(store_id, sales_document_id);

COMMIT;
