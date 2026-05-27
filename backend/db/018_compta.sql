-- 018_compta.sql

CREATE TABLE IF NOT EXISTS compta_daily_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

  closure_date DATE NOT NULL,

  ca_real_ht NUMERIC(12,2) DEFAULT 0,
  ca_n1_ht NUMERIC(12,2) DEFAULT 0,

  stock_start_value_ht NUMERIC(12,2) DEFAULT 0,
  stock_end_value_ht NUMERIC(12,2) DEFAULT 0,
  purchases_ht NUMERIC(12,2) DEFAULT 0,

  real_consumed_cost_ht NUMERIC(12,2) DEFAULT 0,
  real_margin_ht NUMERIC(12,2) DEFAULT 0,
  real_margin_pct NUMERIC(8,2) DEFAULT 0,

  theoretical_ca_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_cost_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_margin_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_margin_pct NUMERIC(8,2) DEFAULT 0,

  delta_ca_real_vs_theoretical NUMERIC(12,2) DEFAULT 0,
  delta_margin_real_vs_theoretical NUMERIC(12,2) DEFAULT 0,

  delta_ca_vs_n1 NUMERIC(12,2) DEFAULT 0,
  delta_ca_vs_n1_pct NUMERIC(8,2) DEFAULT 0,

  notes TEXT,

  validated BOOLEAN DEFAULT false,
  validated_at TIMESTAMP,
  validated_by UUID REFERENCES users(id),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(store_id, department_id, closure_date)
);

CREATE TABLE IF NOT EXISTS compta_daily_article_theoretical_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

  closure_date DATE NOT NULL,

  article_id UUID REFERENCES articles(id),
  plu TEXT,
  designation TEXT,

  qty_sold_theoretical NUMERIC(12,3) DEFAULT 0,

  unit_sale_price_ht NUMERIC(12,4) DEFAULT 0,
  unit_cost_ht NUMERIC(12,4) DEFAULT 0,

  theoretical_ca_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_cost_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_margin_ht NUMERIC(12,2) DEFAULT 0,
  theoretical_margin_pct NUMERIC(8,2) DEFAULT 0,

  source_document_id UUID,
  source_line_id UUID,

  warning TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),

  invoice_date DATE NOT NULL,
  invoice_number TEXT,
  amount_ht NUMERIC(12,2) DEFAULT 0,
  validated_amount_ht NUMERIC(12,2) DEFAULT 0,
  gap_ht NUMERIC(12,2) DEFAULT 0,

  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'cancelled')),

  notes TEXT,

  created_by UUID REFERENCES users(id),
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_invoice_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  supplier_invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES purchases(id) ON DELETE CASCADE,
  purchase_line_id UUID REFERENCES purchase_lines(id) ON DELETE CASCADE,

  linked_amount_ht NUMERIC(12,2) DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compta_daily_closures_date
ON compta_daily_closures(store_id, department_id, closure_date);

CREATE INDEX IF NOT EXISTS idx_compta_theoretical_lines_date
ON compta_daily_article_theoretical_lines(store_id, department_id, closure_date);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier
ON supplier_invoices(store_id, department_id, supplier_id);