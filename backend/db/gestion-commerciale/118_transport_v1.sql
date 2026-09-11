ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_carrier boolean NOT NULL DEFAULT false;

UPDATE suppliers
SET is_carrier = true
WHERE supplier_type = 'transporteur'
  AND is_carrier = false;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS sale_transport_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS sale_transport_chain_id uuid,
  ADD COLUMN IF NOT EXISTS sale_transport_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_clients_sale_transport_mode'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT chk_clients_sale_transport_mode
      CHECK (sale_transport_mode IN ('none', 'franco', 'carrier_paid_by_us', 'manual'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_transport_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_transport_mode text NOT NULL DEFAULT 'manual',
  purchase_transport_chain_id uuid,
  admin_fee_ht numeric(14,4) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_supplier_transport_settings_supplier UNIQUE (store_id, supplier_id),
  CONSTRAINT chk_supplier_transport_mode
    CHECK (purchase_transport_mode IN ('franco', 'carrier_paid_by_us', 'manual'))
);

CREATE TABLE IF NOT EXISTS transport_fuel_surcharges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  effective_to date,
  surcharge_percent numeric(8,4) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_transport_fuel_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_transport_fuel_carrier_date
  ON transport_fuel_surcharges(store_id, carrier_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS transport_rate_grids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  origin_label text,
  destination_label text,
  valid_from date NOT NULL,
  valid_to date,
  is_active boolean NOT NULL DEFAULT true,
  version_number integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_transport_grid_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_transport_rate_grids_carrier_date
  ON transport_rate_grids(store_id, carrier_id, valid_from DESC);

CREATE TABLE IF NOT EXISTS transport_rate_brackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  grid_id uuid NOT NULL REFERENCES transport_rate_grids(id) ON DELETE CASCADE,
  min_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  max_weight_kg numeric(14,3),
  pricing_mode text NOT NULL,
  amount_ht numeric(14,4) NOT NULL DEFAULT 0,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transport_bracket_weight CHECK (max_weight_kg IS NULL OR max_weight_kg >= min_weight_kg),
  CONSTRAINT chk_transport_bracket_mode CHECK (pricing_mode IN ('fixed', 'per_tonne'))
);

CREATE INDEX IF NOT EXISTS idx_transport_rate_brackets_grid_order
  ON transport_rate_brackets(store_id, grid_id, display_order, min_weight_kg);

CREATE TABLE IF NOT EXISTS transport_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  direction text NOT NULL DEFAULT 'sale',
  origin_label text,
  destination_label text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_transport_chain_direction CHECK (direction IN ('purchase', 'sale', 'both'))
);

CREATE INDEX IF NOT EXISTS idx_transport_chains_store_direction
  ON transport_chains(store_id, direction, is_active);

CREATE TABLE IF NOT EXISTS transport_chain_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  chain_id uuid NOT NULL REFERENCES transport_chains(id) ON DELETE CASCADE,
  leg_order integer NOT NULL,
  carrier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  grid_id uuid NOT NULL REFERENCES transport_rate_grids(id) ON DELETE RESTRICT,
  origin_label text,
  destination_label text,
  specific_admin_fee_ht numeric(14,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_transport_chain_leg_order UNIQUE (chain_id, leg_order)
);

CREATE INDEX IF NOT EXISTS idx_transport_chain_legs_chain
  ON transport_chain_legs(store_id, chain_id, leg_order);

CREATE TABLE IF NOT EXISTS logistics_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  label text NOT NULL,
  calculation_mode text NOT NULL,
  amount_ht numeric(14,4) NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_logistics_service_mode CHECK (calculation_mode IN ('per_kg', 'per_tonne', 'fixed')),
  CONSTRAINT chk_logistics_service_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS client_logistics_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  logistics_service_id uuid NOT NULL REFERENCES logistics_services(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_client_logistics_service UNIQUE (store_id, client_id, logistics_service_id)
);

CREATE TABLE IF NOT EXISTS transport_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shipment_date date NOT NULL,
  direction text NOT NULL,
  carrier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  chain_id uuid REFERENCES transport_chains(id) ON DELETE SET NULL,
  origin_label text,
  destination_label text,
  status text NOT NULL DEFAULT 'draft',
  total_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  expected_total_ht numeric(14,2) NOT NULL DEFAULT 0,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_transport_shipment_direction CHECK (direction IN ('purchase', 'sale')),
  CONSTRAINT chk_transport_shipment_status CHECK (status IN ('draft', 'blt_generated', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_transport_shipments_day
  ON transport_shipments(store_id, shipment_date DESC, carrier_id, status);

CREATE TABLE IF NOT EXISTS transport_shipment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES transport_shipments(id) ON DELETE CASCADE,
  sales_document_id uuid REFERENCES sales_documents(id) ON DELETE SET NULL,
  purchase_id uuid,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  document_reference text,
  weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_shipment_documents_shipment
  ON transport_shipment_documents(store_id, shipment_id);

CREATE TABLE IF NOT EXISTS transport_delivery_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reference_number text NOT NULL,
  shipment_id uuid REFERENCES transport_shipments(id) ON DELETE SET NULL,
  carrier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  document_date date NOT NULL,
  direction text NOT NULL,
  status text NOT NULL DEFAULT 'validated',
  total_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  transport_amount_ht numeric(14,2) NOT NULL DEFAULT 0,
  fuel_amount_ht numeric(14,2) NOT NULL DEFAULT 0,
  admin_fee_ht numeric(14,2) NOT NULL DEFAULT 0,
  services_amount_ht numeric(14,2) NOT NULL DEFAULT 0,
  expected_total_ht numeric(14,2) NOT NULL DEFAULT 0,
  reconciliation_status text NOT NULL DEFAULT 'pending',
  carrier_invoice_reference text,
  carrier_invoiced_amount_ht numeric(14,2),
  carrier_invoice_variance_ht numeric(14,2),
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_transport_delivery_note_reference UNIQUE (store_id, reference_number),
  CONSTRAINT chk_transport_delivery_note_direction CHECK (direction IN ('purchase', 'sale')),
  CONSTRAINT chk_transport_delivery_note_status CHECK (status IN ('validated', 'cancelled')),
  CONSTRAINT chk_transport_delivery_note_reconciliation CHECK (reconciliation_status IN ('pending', 'matched', 'variance', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_transport_delivery_notes_day
  ON transport_delivery_notes(store_id, document_date DESC, carrier_id);

ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS fk_clients_sale_transport_chain;

ALTER TABLE clients
  ADD CONSTRAINT fk_clients_sale_transport_chain
  FOREIGN KEY (sale_transport_chain_id) REFERENCES transport_chains(id) ON DELETE SET NULL;

ALTER TABLE supplier_transport_settings
  DROP CONSTRAINT IF EXISTS fk_supplier_transport_chain;

ALTER TABLE supplier_transport_settings
  ADD CONSTRAINT fk_supplier_transport_chain
  FOREIGN KEY (purchase_transport_chain_id) REFERENCES transport_chains(id) ON DELETE SET NULL;
