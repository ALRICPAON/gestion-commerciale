BEGIN;

ALTER TABLE pennylane_supplier_invoices
  ADD COLUMN IF NOT EXISTS auto_match_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS auto_match_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_match_last_error text,
  ADD COLUMN IF NOT EXISTS auto_matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_bl_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_matched_lines_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_anomaly_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_conformity_score numeric(6, 2);

ALTER TABLE pennylane_supplier_invoices
  DROP CONSTRAINT IF EXISTS pennylane_supplier_invoices_alta_status_check;

ALTER TABLE pennylane_supplier_invoices
  ADD CONSTRAINT pennylane_supplier_invoices_alta_status_check CHECK (
    alta_business_status IN (
      'nouvelle',
      'a_rapprocher',
      'analyse_automatique',
      'en_controle',
      'conforme',
      'ecart_prix',
      'ecart_quantite',
      'ecart_tva',
      'bl_manquant',
      'article_inconnu',
      'controle_manuel',
      'litige',
      'refusee',
      'validee_a_payer',
      'payee'
    )
  );

CREATE TABLE IF NOT EXISTS pennylane_supplier_invoice_match_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  supplier_invoice_id uuid NOT NULL REFERENCES pennylane_supplier_invoices(id) ON DELETE CASCADE,
  supplier_invoice_line_id uuid REFERENCES pennylane_supplier_invoice_lines(id) ON DELETE CASCADE,
  supplier_id uuid,
  article_id uuid,
  purchase_id uuid,
  purchase_line_id uuid,
  lot_id uuid,
  match_source text NOT NULL DEFAULT 'none',
  match_status text NOT NULL DEFAULT 'unmatched',
  anomaly_code text,
  anomaly_label text,
  supplier_reference text,
  invoice_label text,
  article_label text,
  purchase_bl_number text,
  purchase_receipt_date date,
  ordered_quantity numeric(14, 4),
  received_quantity numeric(14, 4),
  invoice_quantity numeric(14, 4),
  purchase_unit_price_ex_vat numeric(14, 6),
  invoice_unit_price_ex_vat numeric(14, 6),
  quantity_difference numeric(14, 4),
  unit_price_difference numeric(14, 6),
  amount_difference numeric(14, 4),
  vat_difference numeric(14, 4),
  invoice_amount_ex_vat numeric(14, 4),
  purchase_amount_ex_vat numeric(14, 4),
  invoice_vat_amount numeric(14, 4),
  confidence numeric(6, 2),
  ai_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psimr_invoice
  ON pennylane_supplier_invoice_match_results(supplier_invoice_id, match_status);

CREATE INDEX IF NOT EXISTS idx_psimr_line
  ON pennylane_supplier_invoice_match_results(supplier_invoice_line_id);

CREATE INDEX IF NOT EXISTS idx_psimr_purchase
  ON pennylane_supplier_invoice_match_results(store_id, purchase_id, purchase_line_id);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoices_auto_match
  ON pennylane_supplier_invoices(store_id, auto_match_status, auto_matched_at);

COMMIT;
