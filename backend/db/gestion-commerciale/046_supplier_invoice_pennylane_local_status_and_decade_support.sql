BEGIN;

DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'supplier_invoices'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%pennylane_status%'
  LOOP
    EXECUTE format('ALTER TABLE supplier_invoices DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;
END $$;

ALTER TABLE supplier_invoices
  ADD CONSTRAINT chk_supplier_invoices_pennylane_status
  CHECK (pennylane_status IN (
    'not_ready',
    'ready_to_send',
    'pending',
    'sent_to_pennylane',
    'to_be_paid',
    'paid',
    'error',
    'pennylane_error'
  ));

CREATE OR REPLACE FUNCTION sync_supplier_invoice_local_status_from_pennylane()
RETURNS trigger AS $$
DECLARE
  source_pennylane_supplier_invoice_id text;
BEGIN
  IF NEW.pennylane_status = 'to_be_paid' THEN
    NEW.status = CASE
      WHEN NEW.status IN ('draft', 'matched', 'invoice_difference', 'ready_to_send', 'sent_to_pennylane', 'pennylane_error')
        THEN 'invoice_validated'
      ELSE NEW.status
    END;

    NEW.match_status = CASE
      WHEN NEW.match_status = 'unmatched' THEN 'matched'
      ELSE NEW.match_status
    END;

    NEW.pennylane_synced_at = NOW();

    source_pennylane_supplier_invoice_id := NULLIF(NEW.pennylane_payload->>'pennylane_supplier_invoice_id', '');

    IF source_pennylane_supplier_invoice_id IS NOT NULL THEN
      UPDATE pennylane_supplier_invoices
      SET alta_business_status = 'validee_a_payer',
          match_status = 'matched',
          auto_match_status = CASE
            WHEN auto_match_status = 'success' THEN 'validated'
            ELSE auto_match_status
          END,
          payment_status = COALESCE(NULLIF(payment_status, ''), 'to_be_paid'),
          last_synced_at = COALESCE(last_synced_at, NOW()),
          updated_at = NOW()
      WHERE store_id = NEW.store_id
        AND pennylane_supplier_invoice_id = source_pennylane_supplier_invoice_id
        AND alta_business_status NOT IN ('payee', 'litige', 'refusee');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_invoice_local_status_from_pennylane ON supplier_invoices;
CREATE TRIGGER trg_supplier_invoice_local_status_from_pennylane
BEFORE INSERT OR UPDATE OF pennylane_status ON supplier_invoices
FOR EACH ROW
EXECUTE FUNCTION sync_supplier_invoice_local_status_from_pennylane();

CREATE OR REPLACE FUNCTION sync_pennylane_supplier_invoice_local_status()
RETURNS trigger AS $$
BEGIN
  IF NEW.payment_status = 'to_be_paid' THEN
    NEW.alta_business_status = CASE
      WHEN NEW.alta_business_status IN ('payee', 'litige', 'refusee') THEN NEW.alta_business_status
      ELSE 'validee_a_payer'
    END;

    NEW.match_status = CASE
      WHEN NEW.alta_business_status = 'validee_a_payer' THEN 'matched'
      ELSE NEW.match_status
    END;

    NEW.auto_match_status = CASE
      WHEN NEW.alta_business_status = 'validee_a_payer' AND NEW.auto_match_status = 'success' THEN 'validated'
      ELSE NEW.auto_match_status
    END;

    NEW.last_synced_at = COALESCE(NEW.last_synced_at, NOW());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pennylane_supplier_invoice_local_status ON pennylane_supplier_invoices;
CREATE TRIGGER trg_pennylane_supplier_invoice_local_status
BEFORE INSERT OR UPDATE OF payment_status ON pennylane_supplier_invoices
FOR EACH ROW
EXECUTE FUNCTION sync_pennylane_supplier_invoice_local_status();

UPDATE supplier_invoices
SET status = CASE
      WHEN status IN ('draft', 'matched', 'invoice_difference', 'ready_to_send', 'sent_to_pennylane', 'pennylane_error')
        THEN 'invoice_validated'
      ELSE status
    END,
    match_status = CASE
      WHEN match_status = 'unmatched' THEN 'matched'
      ELSE match_status
    END,
    pennylane_synced_at = COALESCE(pennylane_synced_at, NOW()),
    updated_at = NOW()
WHERE pennylane_status = 'to_be_paid'
  AND (status <> 'invoice_validated' OR match_status = 'unmatched' OR pennylane_synced_at IS NULL);

UPDATE pennylane_supplier_invoices psi
SET alta_business_status = 'validee_a_payer',
    match_status = 'matched',
    auto_match_status = CASE
      WHEN psi.auto_match_status = 'success' THEN 'validated'
      ELSE psi.auto_match_status
    END,
    payment_status = COALESCE(NULLIF(psi.payment_status, ''), 'to_be_paid'),
    last_synced_at = COALESCE(psi.last_synced_at, NOW()),
    updated_at = NOW()
FROM supplier_invoices si
WHERE si.store_id = psi.store_id
  AND si.pennylane_status = 'to_be_paid'
  AND si.pennylane_payload->>'pennylane_supplier_invoice_id' = psi.pennylane_supplier_invoice_id
  AND psi.alta_business_status NOT IN ('payee', 'litige', 'refusee')
  AND (
    psi.alta_business_status <> 'validee_a_payer'
    OR psi.match_status <> 'matched'
    OR psi.auto_match_status = 'success'
    OR psi.last_synced_at IS NULL
  );

UPDATE pennylane_supplier_invoices
SET alta_business_status = 'validee_a_payer',
    match_status = 'matched',
    auto_match_status = CASE
      WHEN auto_match_status = 'success' THEN 'validated'
      ELSE auto_match_status
    END,
    last_synced_at = COALESCE(last_synced_at, NOW()),
    updated_at = NOW()
WHERE payment_status = 'to_be_paid'
  AND alta_business_status NOT IN ('payee', 'litige', 'refusee')
  AND (
    alta_business_status <> 'validee_a_payer'
    OR match_status <> 'matched'
    OR auto_match_status = 'success'
    OR last_synced_at IS NULL
  );

CREATE OR REPLACE VIEW supplier_invoice_bl_summary AS
WITH distinct_invoice_purchases AS (
  SELECT DISTINCT
    sim.store_id,
    sim.supplier_invoice_id,
    sim.purchase_id
  FROM supplier_invoice_matches sim
  WHERE sim.purchase_id IS NOT NULL
), purchase_totals AS (
  SELECT
    dip.store_id,
    dip.supplier_invoice_id,
    p.id AS purchase_id,
    p.bl_number,
    p.receipt_date,
    COALESCE(p.total_amount_ex_vat, SUM(pl.line_amount_ex_vat), 0) AS total_ex_vat
  FROM distinct_invoice_purchases dip
  JOIN purchases p ON p.id = dip.purchase_id AND p.store_id = dip.store_id
  LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = dip.store_id
  GROUP BY dip.store_id, dip.supplier_invoice_id, p.id, p.bl_number, p.receipt_date, p.total_amount_ex_vat
)
SELECT
  si.store_id,
  si.id AS supplier_invoice_id,
  si.supplier_id,
  COUNT(pt.purchase_id) AS bl_count,
  COALESCE(SUM(pt.total_ex_vat), 0) AS bl_total_ex_vat,
  COALESCE(si.product_total_ex_vat, si.total_ex_vat, 0) AS invoice_comparable_total_ex_vat,
  COALESCE(si.product_total_ex_vat, si.total_ex_vat, 0) - COALESCE(SUM(pt.total_ex_vat), 0) AS amount_difference,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'purchase_id', pt.purchase_id,
        'bl_number', pt.bl_number,
        'receipt_date', pt.receipt_date,
        'total_ex_vat', pt.total_ex_vat
      ) ORDER BY pt.receipt_date NULLS LAST, pt.bl_number
    ) FILTER (WHERE pt.purchase_id IS NOT NULL),
    '[]'::jsonb
  ) AS bls
FROM supplier_invoices si
LEFT JOIN purchase_totals pt ON pt.supplier_invoice_id = si.id AND pt.store_id = si.store_id
GROUP BY si.store_id, si.id, si.supplier_id, si.product_total_ex_vat, si.total_ex_vat;

COMMIT;
