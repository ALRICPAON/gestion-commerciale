BEGIN;

CREATE TABLE IF NOT EXISTS pennylane_supplier_invoice_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  resource text NOT NULL DEFAULT 'supplier_invoices',
  last_processed_at timestamptz,
  cursor text,
  sync_status text NOT NULL DEFAULT 'idle',
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pennylane_supplier_invoice_sync_state_unique UNIQUE (store_id, resource)
);

CREATE TABLE IF NOT EXISTS pennylane_supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  pennylane_supplier_invoice_id text NOT NULL,
  pennylane_supplier_id text,
  supplier_id uuid,
  invoice_number text,
  invoice_date date,
  due_date date,
  currency text NOT NULL DEFAULT 'EUR',
  amount_ex_vat numeric(14, 4),
  amount_vat numeric(14, 4),
  amount_inc_vat numeric(14, 4),
  currency_amount_ex_vat numeric(14, 4),
  currency_amount_vat numeric(14, 4),
  currency_amount_inc_vat numeric(14, 4),
  remaining_amount_with_tax numeric(14, 4),
  remaining_amount_without_tax numeric(14, 4),
  accounting_status text,
  payment_status text,
  paid boolean NOT NULL DEFAULT false,
  e_invoice_status text,
  e_invoice_reason text,
  e_invoice_flow_id text,
  pennylane_filename text,
  public_file_url text,
  external_reference text,
  alta_business_status text NOT NULL DEFAULT 'nouvelle',
  match_status text NOT NULL DEFAULT 'unmatched',
  sync_status text NOT NULL DEFAULT 'synced',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  pennylane_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pennylane_supplier_invoices_unique UNIQUE (store_id, pennylane_supplier_invoice_id),
  CONSTRAINT pennylane_supplier_invoices_alta_status_check CHECK (
    alta_business_status IN (
      'nouvelle',
      'a_rapprocher',
      'en_controle',
      'conforme',
      'ecart_prix',
      'ecart_quantite',
      'litige',
      'refusee',
      'validee_a_payer',
      'payee'
    )
  )
);

CREATE TABLE IF NOT EXISTS pennylane_supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  supplier_invoice_id uuid NOT NULL REFERENCES pennylane_supplier_invoices(id) ON DELETE CASCADE,
  pennylane_line_id text,
  e_invoice_line_id text,
  line_position integer NOT NULL DEFAULT 1,
  label text,
  quantity numeric(14, 4),
  unit text,
  raw_currency_unit_price numeric(14, 6),
  currency_amount numeric(14, 4),
  amount numeric(14, 4),
  currency_tax numeric(14, 4),
  tax numeric(14, 4),
  vat_rate text,
  ledger_account_id text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pennylane_supplier_invoice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  supplier_invoice_id uuid NOT NULL REFERENCES pennylane_supplier_invoices(id) ON DELETE CASCADE,
  purchase_id uuid,
  purchase_line_id uuid,
  reception_id uuid,
  delivery_note_id uuid,
  link_status text NOT NULL DEFAULT 'planned',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoices_store_status
  ON pennylane_supplier_invoices(store_id, alta_business_status, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoices_supplier
  ON pennylane_supplier_invoices(store_id, supplier_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoices_pennylane_supplier
  ON pennylane_supplier_invoices(store_id, pennylane_supplier_id);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoice_lines_invoice
  ON pennylane_supplier_invoice_lines(supplier_invoice_id, line_position);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoice_links_invoice
  ON pennylane_supplier_invoice_links(supplier_invoice_id);

COMMIT;
