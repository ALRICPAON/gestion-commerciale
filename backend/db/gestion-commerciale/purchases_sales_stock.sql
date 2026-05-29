CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','received','closed','cancelled')),
  purchase_type text NOT NULL DEFAULT 'order' CHECK (purchase_type IN ('order','direct_bl','invoice_only')),
  order_date date DEFAULT CURRENT_DATE,
  receipt_date date,
  bl_number text,
  invoice_number text,
  notes text,
  total_amount_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_store ON purchases(store_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  client_key text,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  line_number integer NOT NULL DEFAULT 1,
  supplier_article_mapping_id uuid,
  article_id uuid REFERENCES articles(id),
  supplier_reference text,
  supplier_label text,
  ordered_colis numeric(14,4),
  ordered_pieces numeric(14,4),
  ordered_quantity numeric(14,4) DEFAULT 0,
  received_colis numeric(14,4),
  received_pieces numeric(14,4),
  received_quantity numeric(14,4) DEFAULT 0,
  stock_quantity numeric(14,4) DEFAULT 0,
  unit_price_ex_vat numeric(14,4) DEFAULT 0,
  line_amount_ex_vat numeric(14,4) DEFAULT 0,
  price_unit text NOT NULL DEFAULT 'kg' CHECK (price_unit IN ('kg','piece','colis')),
  line_status text NOT NULL DEFAULT 'pending' CHECK (line_status IN ('pending','received','cancelled')),
  lot_id uuid,
  lot_mode text DEFAULT 'auto',
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase ON purchase_lines(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_article ON purchase_lines(article_id);

CREATE TABLE IF NOT EXISTS supplier_article_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  article_id uuid NOT NULL REFERENCES articles(id),
  supplier_ref text NOT NULL,
  supplier_label text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(supplier_id, supplier_ref)
);

CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_supplier
  ON supplier_article_mappings(supplier_id, supplier_ref);

CREATE TABLE IF NOT EXISTS purchase_line_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_line_id uuid NOT NULL REFERENCES purchase_lines(id) ON DELETE CASCADE,
  meta_key text NOT NULL DEFAULT 'gc_line',
  meta_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  dlc date,
  latin_name text,
  fao_zone text,
  sous_zone text,
  fishing_gear text,
  production_method text,
  allergens text,
  origin_label text,
  supplier_lot_number text,
  sanitary_photo_url text,
  sanitary_photo_urls jsonb DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(purchase_line_id, meta_key)
);

CREATE TABLE IF NOT EXISTS lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  article_id uuid NOT NULL REFERENCES articles(id),
  purchase_id uuid REFERENCES purchases(id),
  purchase_line_id uuid REFERENCES purchase_lines(id),
  supplier_id uuid REFERENCES suppliers(id),
  lot_code text NOT NULL,
  supplier_lot_number text,
  source_type text NOT NULL DEFAULT 'purchase',
  qty_initial numeric(14,4) NOT NULL DEFAULT 0,
  qty_remaining numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  dlc date,
  traceability_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, lot_code)
);

CREATE INDEX IF NOT EXISTS idx_lots_store_article ON lots(store_id, article_id);
CREATE INDEX IF NOT EXISTS idx_lots_remaining ON lots(store_id, article_id, qty_remaining);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  article_id uuid NOT NULL REFERENCES articles(id),
  lot_id uuid REFERENCES lots(id),
  movement_type text NOT NULL,
  quantity numeric(14,4) NOT NULL,
  unit_cost_ex_vat numeric(14,4) DEFAULT 0,
  source_table text,
  source_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_store_article ON stock_movements(store_id, article_id);

CREATE TABLE IF NOT EXISTS stock_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  article_id uuid NOT NULL REFERENCES articles(id),
  stock_quantity numeric(14,4) NOT NULL DEFAULT 0,
  stock_value_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  pma numeric(14,4) NOT NULL DEFAULT 0,
  next_dlc date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, article_id)
);

CREATE TABLE IF NOT EXISTS sales_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  client_key text,
  client_id uuid REFERENCES clients(id),
  document_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','cancelled')),
  document_type text NOT NULL DEFAULT 'manual_sale' CHECK (document_type IN ('manual_sale','quote_sale','order_sale','delivery_note','invoice','transfer_out','waste')),
  origin text NOT NULL DEFAULT 'manual',
  reference_number text,
  notes text,
  total_amount_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  total_amount_inc_vat numeric(14,4) NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_document_id uuid NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  client_key text,
  article_id uuid REFERENCES articles(id),
  line_number integer NOT NULL DEFAULT 1,
  ean text,
  article_label text,
  sold_quantity numeric(14,4) NOT NULL DEFAULT 0,
  sale_unit text NOT NULL DEFAULT 'kg' CHECK (sale_unit IN ('kg','piece','colis')),
  unit_sale_price_ttc numeric(14,4) DEFAULT 0,
  unit_sale_price_ht numeric(14,4) DEFAULT 0,
  unit_cost_ex_vat numeric(14,4) DEFAULT 0,
  line_amount_ttc numeric(14,4) DEFAULT 0,
  line_amount_ht numeric(14,4) DEFAULT 0,
  line_margin_ex_vat numeric(14,4) DEFAULT 0,
  line_reason text,
  line_status text NOT NULL DEFAULT 'pending' CHECK (line_status IN ('pending','validated','cancelled')),
  source_inventory_line jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_line_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_line_id uuid NOT NULL REFERENCES sales_lines(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES lots(id),
  quantity numeric(14,4) NOT NULL,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
