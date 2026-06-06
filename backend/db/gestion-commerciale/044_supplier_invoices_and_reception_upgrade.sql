BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS source_document_url text,
  ADD COLUMN IF NOT EXISTS source_document_storage_path text,
  ADD COLUMN IF NOT EXISTS source_document_original_name text,
  ADD COLUMN IF NOT EXISTS source_document_mime_type text,
  ADD COLUMN IF NOT EXISTS source_document_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_document_uploaded_by uuid;

ALTER TABLE purchase_line_metadata
  ADD COLUMN IF NOT EXISTS meta_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS latin_name text,
  ADD COLUMN IF NOT EXISTS fao_zone text,
  ADD COLUMN IF NOT EXISTS sous_zone text,
  ADD COLUMN IF NOT EXISTS fishing_gear text,
  ADD COLUMN IF NOT EXISTS production_method text,
  ADD COLUMN IF NOT EXISTS allergens text,
  ADD COLUMN IF NOT EXISTS origin_label text,
  ADD COLUMN IF NOT EXISTS supplier_lot_number text,
  ADD COLUMN IF NOT EXISTS dlc date,
  ADD COLUMN IF NOT EXISTS sanitary_photo_url text,
  ADD COLUMN IF NOT EXISTS sanitary_photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_line_metadata_line_key
  ON purchase_line_metadata(purchase_line_id, meta_key);

DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'purchases'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE purchases DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;
END $$;

ALTER TABLE purchases
  ADD CONSTRAINT chk_purchases_status_supplier_invoice_flow
  CHECK (status IN (
    'draft',
    'ordered',
    'receiving',
    'received',
    'received_pending_invoice',
    'invoice_matched',
    'invoice_difference',
    'invoice_validated',
    'cost_adjusted',
    'sent_pennylane',
    'closed',
    'cancelled'
  ));

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  client_key text,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  invoice_date date,
  due_date date,
  status text NOT NULL DEFAULT 'draft',
  match_status text NOT NULL DEFAULT 'unmatched',
  supplier_type text,
  total_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  product_total_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  fees_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  vat_amount numeric(14,4) NOT NULL DEFAULT 0,
  total_inc_vat numeric(14,4) NOT NULL DEFAULT 0,
  document_url text,
  pennylane_status text NOT NULL DEFAULT 'ready_to_send',
  pennylane_id text,
  pennylane_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pennylane_synced_at timestamptz,
  pennylane_error text,
  notes text,
  created_by uuid,
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_invoices_status CHECK (status IN (
    'draft',
    'matched',
    'invoice_difference',
    'invoice_validated',
    'cost_adjusted',
    'ready_to_send',
    'sent_to_pennylane',
    'pennylane_error',
    'cancelled'
  )),
  CONSTRAINT chk_supplier_invoices_match_status CHECK (match_status IN (
    'unmatched',
    'partial',
    'matched',
    'discrepancy'
  )),
  CONSTRAINT chk_supplier_invoices_pennylane_status CHECK (pennylane_status IN (
    'not_ready',
    'ready_to_send',
    'pending',
    'sent_to_pennylane',
    'error'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_invoices_store_supplier_number
  ON supplier_invoices(store_id, supplier_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_store_status
  ON supplier_invoices(store_id, status, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_pennylane
  ON supplier_invoices(store_id, pennylane_status);

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  line_number integer NOT NULL DEFAULT 1,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  supplier_reference text,
  supplier_label text,
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  colis numeric(14,3),
  pieces numeric(14,3),
  price_unit text NOT NULL DEFAULT 'kg',
  unit_price_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  line_amount_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  vat_rate numeric(6,3) NOT NULL DEFAULT 0,
  vat_amount numeric(14,4) NOT NULL DEFAULT 0,
  line_amount_inc_vat numeric(14,4) NOT NULL DEFAULT 0,
  match_status text NOT NULL DEFAULT 'unmatched',
  match_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_invoice_lines_match_status CHECK (match_status IN (
    'unmatched',
    'matched',
    'quantity_difference',
    'price_difference',
    'missing_purchase_line'
  ))
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_invoice
  ON supplier_invoice_lines(supplier_invoice_id, line_number);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_article
  ON supplier_invoice_lines(store_id, article_id);

CREATE TABLE IF NOT EXISTS supplier_invoice_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  supplier_invoice_line_id uuid REFERENCES supplier_invoice_lines(id) ON DELETE CASCADE,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'matched',
  difference_type text,
  quantity_difference numeric(14,3) NOT NULL DEFAULT 0,
  price_difference numeric(14,4) NOT NULL DEFAULT 0,
  amount_difference numeric(14,4) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_invoice_matches_status CHECK (match_status IN (
    'matched',
    'partial',
    'difference',
    'manual_validated'
  ))
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_matches_invoice
  ON supplier_invoice_matches(supplier_invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_matches_purchase
  ON supplier_invoice_matches(store_id, purchase_id);

CREATE TABLE IF NOT EXISTS supplier_invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'invoice',
  original_name text,
  mime_type text,
  storage_path text NOT NULL,
  public_url text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_documents_invoice
  ON supplier_invoice_documents(supplier_invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_documents_purchase
  ON supplier_invoice_documents(purchase_id);

CREATE TABLE IF NOT EXISTS supplier_invoice_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  export_type text NOT NULL DEFAULT 'pennylane_payload',
  status text NOT NULL DEFAULT 'ready_to_send',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_id text,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_exports_invoice
  ON supplier_invoice_exports(supplier_invoice_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_invoice_cost_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  old_unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  new_unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  quantity_reference numeric(14,3) NOT NULL DEFAULT 0,
  adjustment_amount_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_cost_adjustments_invoice
  ON supplier_invoice_cost_adjustments(supplier_invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_cost_adjustments_lot
  ON supplier_invoice_cost_adjustments(lot_id);

COMMIT;
