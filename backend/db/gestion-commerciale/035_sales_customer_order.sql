BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 5.50,
  ADD COLUMN IF NOT EXISTS is_vat_exempt boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS sales_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  document_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft',
  document_type text NOT NULL DEFAULT 'ORDER',
  origin text NOT NULL DEFAULT 'manual',
  reference_number text,
  notes text,
  total_amount_ex_vat numeric(14,2) NOT NULL DEFAULT 0,
  total_vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount_inc_vat numeric(14,2) NOT NULL DEFAULT 0,
  tariff_level_snapshot integer,
  vat_rate_snapshot numeric(5,2),
  is_vat_exempt_snapshot boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS client_key text,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'ORDER',
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS total_amount_ex_vat numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount_inc_vat numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tariff_level_snapshot integer,
  ADD COLUMN IF NOT EXISTS vat_rate_snapshot numeric(5,2),
  ADD COLUMN IF NOT EXISTS is_vat_exempt_snapshot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'sales_documents'::regclass
      AND conname = 'sales_documents_document_type_check'
  ) THEN
    ALTER TABLE sales_documents
      DROP CONSTRAINT sales_documents_document_type_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'sales_documents'::regclass
      AND conname = 'sales_documents_document_type_check'
  ) THEN
    ALTER TABLE sales_documents
      ADD CONSTRAINT sales_documents_document_type_check
      CHECK (
        document_type IN (
          'ORDER',
          'DELIVERY_NOTE',
          'INVOICE',
          'manual_sale',
          'inventory_sale',
          'transfer_out',
          'waste'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  sales_document_id uuid NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
  line_number integer NOT NULL DEFAULT 1,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  article_plu text,
  article_label text,
  package_count numeric(12,3) NOT NULL DEFAULT 0,
  weight_per_package numeric(12,3) NOT NULL DEFAULT 0,
  total_weight numeric(14,3) NOT NULL DEFAULT 0,
  sold_quantity numeric(14,3) NOT NULL DEFAULT 0,
  sale_unit text NOT NULL DEFAULT 'kg',
  unit_sale_price_ht numeric(14,4) NOT NULL DEFAULT 0,
  unit_sale_price_ttc numeric(14,4) NOT NULL DEFAULT 0,
  vat_rate numeric(5,2) NOT NULL DEFAULT 5.50,
  line_amount_ht numeric(14,2) NOT NULL DEFAULT 0,
  line_vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  line_amount_ttc numeric(14,2) NOT NULL DEFAULT 0,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  line_margin_ex_vat numeric(14,2) NOT NULL DEFAULT 0,
  selected_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  suggested_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  traceability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  line_reason text,
  line_status text NOT NULL DEFAULT 'pending',
  source_inventory_line jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_lines
  ADD COLUMN IF NOT EXISTS client_key text,
  ADD COLUMN IF NOT EXISTS article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS article_plu text,
  ADD COLUMN IF NOT EXISTS article_label text,
  ADD COLUMN IF NOT EXISTS package_count numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight_per_package numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_weight numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sold_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_unit text NOT NULL DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS unit_sale_price_ht numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_sale_price_ttc numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 5.50,
  ADD COLUMN IF NOT EXISTS line_amount_ht numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_amount_ttc numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_margin_ex_vat numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selected_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS traceability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS line_reason text,
  ADD COLUMN IF NOT EXISTS line_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS source_inventory_line jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS sale_line_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_line_id uuid NOT NULL REFERENCES sales_lines(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_documents_store_status
  ON sales_documents(store_id, status, document_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_documents_store_client
  ON sales_documents(store_id, client_id, document_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_lines_document
  ON sales_lines(sales_document_id, line_number);

CREATE INDEX IF NOT EXISTS idx_sales_lines_store_article
  ON sales_lines(store_id, article_id);

CREATE INDEX IF NOT EXISTS idx_sales_lines_selected_lot
  ON sales_lines(selected_lot_id);

CREATE INDEX IF NOT EXISTS idx_sales_lines_suggested_lot
  ON sales_lines(suggested_lot_id);

CREATE INDEX IF NOT EXISTS idx_sale_line_allocations_line
  ON sale_line_allocations(sales_line_id);

CREATE INDEX IF NOT EXISTS idx_sale_line_allocations_lot
  ON sale_line_allocations(lot_id);

CREATE INDEX IF NOT EXISTS idx_clients_store_vat
  ON clients(store_id, is_vat_exempt, vat_rate);

UPDATE sales_documents
SET document_type = 'ORDER'
WHERE document_type IN ('manual_sale', 'inventory_sale')
  AND status = 'draft';

COMMIT;
