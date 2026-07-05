BEGIN;

CREATE OR REPLACE FUNCTION sync_pennylane_supplier_invoice_local_status()
RETURNS trigger AS $$
BEGIN
  IF NEW.paid = true OR NEW.payment_status = 'paid' THEN
    NEW.payment_status = 'paid';

    NEW.alta_business_status = CASE
      WHEN NEW.alta_business_status IN ('litige', 'refusee') THEN NEW.alta_business_status
      ELSE 'payee'
    END;

    NEW.match_status = CASE
      WHEN NEW.alta_business_status = 'payee' THEN 'matched'
      ELSE NEW.match_status
    END;

    NEW.auto_match_status = CASE
      WHEN NEW.alta_business_status = 'payee' AND NEW.auto_match_status = 'success' THEN 'validated'
      ELSE NEW.auto_match_status
    END;

    NEW.last_synced_at = NOW();
    NEW.updated_at = NOW();

    UPDATE supplier_invoices
    SET pennylane_status = 'paid',
        pennylane_synced_at = NOW(),
        updated_at = NOW()
    WHERE store_id = NEW.store_id
      AND pennylane_payload->>'pennylane_supplier_invoice_id' = NEW.pennylane_supplier_invoice_id
      AND status <> 'cancelled';
  ELSIF NEW.payment_status = 'to_be_paid' THEN
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

    NEW.last_synced_at = NOW();
    NEW.updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pennylane_supplier_invoice_local_status ON pennylane_supplier_invoices;
CREATE TRIGGER trg_pennylane_supplier_invoice_local_status
BEFORE INSERT OR UPDATE OF payment_status, paid ON pennylane_supplier_invoices
FOR EACH ROW
EXECUTE FUNCTION sync_pennylane_supplier_invoice_local_status();

UPDATE pennylane_supplier_invoices
SET alta_business_status = 'payee',
    match_status = 'matched',
    payment_status = 'paid',
    auto_match_status = CASE
      WHEN auto_match_status = 'success' THEN 'validated'
      ELSE auto_match_status
    END,
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE (paid = true OR payment_status = 'paid')
  AND alta_business_status NOT IN ('litige', 'refusee')
  AND (
    alta_business_status <> 'payee'
    OR match_status <> 'matched'
    OR payment_status IS DISTINCT FROM 'paid'
    OR auto_match_status = 'success'
    OR last_synced_at IS NULL
  );

UPDATE supplier_invoices si
SET pennylane_status = 'paid',
    pennylane_synced_at = NOW(),
    updated_at = NOW()
FROM pennylane_supplier_invoices psi
WHERE psi.store_id = si.store_id
  AND psi.pennylane_supplier_invoice_id = si.pennylane_payload->>'pennylane_supplier_invoice_id'
  AND (psi.paid = true OR psi.payment_status = 'paid')
  AND psi.alta_business_status NOT IN ('litige', 'refusee')
  AND si.status <> 'cancelled'
  AND si.pennylane_status IS DISTINCT FROM 'paid';

COMMIT;
