BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS credit_note_reason text,
  ADD COLUMN IF NOT EXISTS source_supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_effect text NOT NULL DEFAULT 'none';

UPDATE supplier_invoices
SET document_type = 'invoice'
WHERE document_type IS NULL;

ALTER TABLE supplier_invoices
  DROP CONSTRAINT IF EXISTS chk_supplier_invoices_document_type,
  DROP CONSTRAINT IF EXISTS chk_supplier_invoices_credit_note_reason,
  DROP CONSTRAINT IF EXISTS chk_supplier_invoices_stock_effect;

ALTER TABLE supplier_invoices
  ADD CONSTRAINT chk_supplier_invoices_document_type
    CHECK (document_type IN ('invoice', 'credit_note')),
  ADD CONSTRAINT chk_supplier_invoices_credit_note_reason
    CHECK (
      credit_note_reason IS NULL
      OR credit_note_reason IN ('commercial_discount', 'price_error', 'supplier_return', 'full_cancellation', 'other')
    ),
  ADD CONSTRAINT chk_supplier_invoices_stock_effect
    CHECK (stock_effect IN ('none', 'supplier_return'));

ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS document_effect_sign smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_lot_id uuid REFERENCES lots(id) ON DELETE SET NULL;

UPDATE supplier_invoice_lines
SET document_effect_sign = 1
WHERE document_effect_sign IS NULL OR document_effect_sign NOT IN (-1, 1);

ALTER TABLE supplier_invoice_lines
  DROP CONSTRAINT IF EXISTS chk_supplier_invoice_lines_document_effect_sign;

ALTER TABLE supplier_invoice_lines
  ADD CONSTRAINT chk_supplier_invoice_lines_document_effect_sign
    CHECK (document_effect_sign IN (-1, 1));

ALTER TABLE pennylane_supplier_invoices
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS credit_note_reason text,
  ADD COLUMN IF NOT EXISTS source_supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_effect text NOT NULL DEFAULT 'none';

UPDATE pennylane_supplier_invoices
SET document_type = 'invoice'
WHERE document_type IS NULL;

ALTER TABLE pennylane_supplier_invoices
  DROP CONSTRAINT IF EXISTS chk_pennylane_supplier_invoices_document_type,
  DROP CONSTRAINT IF EXISTS chk_pennylane_supplier_invoices_credit_note_reason,
  DROP CONSTRAINT IF EXISTS chk_pennylane_supplier_invoices_stock_effect;

ALTER TABLE pennylane_supplier_invoices
  ADD CONSTRAINT chk_pennylane_supplier_invoices_document_type
    CHECK (document_type IN ('invoice', 'credit_note')),
  ADD CONSTRAINT chk_pennylane_supplier_invoices_credit_note_reason
    CHECK (
      credit_note_reason IS NULL
      OR credit_note_reason IN ('commercial_discount', 'price_error', 'supplier_return', 'full_cancellation', 'other')
    ),
  ADD CONSTRAINT chk_pennylane_supplier_invoices_stock_effect
    CHECK (stock_effect IN ('none', 'supplier_return'));

ALTER TABLE pennylane_supplier_invoice_links
  ADD COLUMN IF NOT EXISTS link_type text NOT NULL DEFAULT 'invoice_match',
  ADD COLUMN IF NOT EXISTS source_supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL;

ALTER TABLE pennylane_supplier_invoice_links
  DROP CONSTRAINT IF EXISTS chk_pennylane_supplier_invoice_links_type;

ALTER TABLE pennylane_supplier_invoice_links
  ADD CONSTRAINT chk_pennylane_supplier_invoice_links_type
    CHECK (link_type IN ('invoice_match', 'credit_note_source', 'credit_note_application'));

CREATE TABLE IF NOT EXISTS supplier_credit_note_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  credit_note_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  source_supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  source_purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  application_type text NOT NULL DEFAULT 'financial',
  amount_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_credit_note_applications_type
    CHECK (application_type IN ('financial', 'supplier_return')),
  CONSTRAINT chk_supplier_credit_note_applications_amount
    CHECK (amount_ex_vat >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_credit_note_applications_scope
  ON supplier_credit_note_applications(
    store_id,
    credit_note_invoice_id,
    COALESCE(source_supplier_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(source_purchase_id, '00000000-0000-0000-0000-000000000000'::uuid),
    application_type
  );

CREATE INDEX IF NOT EXISTS idx_supplier_credit_note_applications_credit_note
  ON supplier_credit_note_applications(credit_note_invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_note_applications_sources
  ON supplier_credit_note_applications(store_id, source_supplier_invoice_id, source_purchase_id);

CREATE TABLE IF NOT EXISTS supplier_credit_note_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  credit_note_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  credit_note_line_id uuid REFERENCES supplier_invoice_lines(id) ON DELETE SET NULL,
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  purchase_line_id uuid NOT NULL REFERENCES purchase_lines(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL,
  unit_cost_ex_vat numeric(14,4) NOT NULL DEFAULT 0,
  movement_id uuid REFERENCES stock_movements(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_credit_note_returns_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_note_returns_credit_note
  ON supplier_credit_note_returns(credit_note_invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_note_returns_traceability
  ON supplier_credit_note_returns(store_id, purchase_id, purchase_line_id, lot_id, article_id);

CREATE OR REPLACE VIEW supplier_invoice_financial_effects AS
SELECT
  si.*,
  CASE WHEN si.document_type = 'credit_note' THEN -ABS(COALESCE(si.product_total_ex_vat, 0)) ELSE COALESCE(si.product_total_ex_vat, 0) END AS financial_product_total_ex_vat,
  CASE WHEN si.document_type = 'credit_note' THEN -ABS(COALESCE(si.total_ex_vat, 0)) ELSE COALESCE(si.total_ex_vat, 0) END AS financial_total_ex_vat,
  CASE WHEN si.document_type = 'credit_note' THEN -ABS(COALESCE(si.vat_amount, 0)) ELSE COALESCE(si.vat_amount, 0) END AS financial_vat_amount,
  CASE WHEN si.document_type = 'credit_note' THEN -ABS(COALESCE(si.total_inc_vat, 0)) ELSE COALESCE(si.total_inc_vat, 0) END AS financial_total_inc_vat,
  EXISTS (
    SELECT 1
    FROM supplier_credit_note_applications scna
    WHERE scna.credit_note_invoice_id = si.id
  ) AS credit_note_is_applied
FROM supplier_invoices si;

CREATE OR REPLACE VIEW supplier_outstanding_by_supplier AS
WITH applied_credit_notes AS (
  SELECT credit_note_invoice_id
  FROM supplier_credit_note_applications
  GROUP BY credit_note_invoice_id
)
SELECT
  si.store_id,
  si.supplier_id,
  COALESCE(SUM(
    CASE
      WHEN si.document_type = 'credit_note' AND acn.credit_note_invoice_id IS NULL
        THEN 0
      WHEN si.status IN ('invoice_validated', 'cost_adjusted', 'sent_to_pennylane') THEN
        CASE WHEN si.document_type = 'credit_note' THEN -ABS(COALESCE(si.total_ex_vat, 0)) ELSE COALESCE(si.total_ex_vat, 0) END
      ELSE 0
    END
  ), 0) AS outstanding_ex_vat,
  COALESCE(SUM(
    CASE
      WHEN si.document_type = 'credit_note' AND acn.credit_note_invoice_id IS NULL
        THEN 0
      WHEN si.status IN ('invoice_validated', 'cost_adjusted', 'sent_to_pennylane') THEN
        CASE WHEN si.document_type = 'credit_note' THEN -ABS(COALESCE(si.total_inc_vat, 0)) ELSE COALESCE(si.total_inc_vat, 0) END
      ELSE 0
    END
  ), 0) AS outstanding_inc_vat
FROM supplier_invoices si
LEFT JOIN applied_credit_notes acn ON acn.credit_note_invoice_id = si.id
GROUP BY si.store_id, si.supplier_id;

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_document_type
  ON supplier_invoices(store_id, document_type, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_pennylane_supplier_invoices_document_type
  ON pennylane_supplier_invoices(store_id, document_type, invoice_date DESC);

COMMIT;
