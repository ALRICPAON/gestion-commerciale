BEGIN;

ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS pennylane_invoice_id text,
  ADD COLUMN IF NOT EXISTS pennylane_sync_status pennylane_sync_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pennylane_sync_last_error text,
  ADD COLUMN IF NOT EXISTS pennylane_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS pennylane_sync_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS sales_documents_store_pennylane_invoice_id_uidx
  ON sales_documents (store_id, pennylane_invoice_id)
  WHERE pennylane_invoice_id IS NOT NULL
    AND document_type = 'INVOICE';

CREATE INDEX IF NOT EXISTS sales_documents_store_pennylane_invoice_sync_status_idx
  ON sales_documents (store_id, pennylane_sync_status, pennylane_sync_updated_at)
  WHERE document_type = 'INVOICE';

CREATE OR REPLACE FUNCTION is_pennylane_customer_invoice_finalized(invoice_status text)
RETURNS boolean AS $$
BEGIN
  RETURN lower(COALESCE(invoice_status, '')) IN (
    'validated',
    'finalized',
    'sent',
    'paid',
    'partially_paid',
    'overdue'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION enqueue_pennylane_customer_invoice_sync()
RETURNS trigger AS $$
DECLARE
  sync_action text;
  queue_action text;
  queue_id uuid;
  sync_payload jsonb;
BEGIN
  IF NEW.document_type IS DISTINCT FROM 'INVOICE'
     OR NOT is_pennylane_customer_invoice_finalized(NEW.status) THEN
    RETURN NEW;
  END IF;

  sync_action := CASE WHEN TG_OP = 'INSERT' THEN 'customer_invoice.create' ELSE 'customer_invoice.update' END;
  queue_action := sync_action;
  sync_payload := jsonb_build_object(
    'invoice_id', NEW.id,
    'reference_number', NEW.reference_number,
    'document_date', NEW.document_date,
    'status', NEW.status,
    'total_amount_ex_vat', NEW.total_amount_ex_vat,
    'total_vat_amount', NEW.total_vat_amount,
    'total_amount_inc_vat', NEW.total_amount_inc_vat,
    'external_reference', 'alta:' || NEW.store_id || ':customer_invoice:' || NEW.id
  );

  NEW.pennylane_sync_status := 'pending';
  NEW.pennylane_sync_last_error := NULL;
  NEW.pennylane_sync_updated_at := now();

  IF TG_OP = 'UPDATE' THEN
    UPDATE pennylane_sync_queue
    SET
      payload = sync_payload,
      priority = LEAST(priority, 40),
      scheduled_at = now(),
      last_error = NULL,
      updated_at = now()
    WHERE id = (
      SELECT id
      FROM pennylane_sync_queue
      WHERE store_id = NEW.store_id
        AND entity_type = 'customer_invoice'
        AND entity_id = NEW.id
        AND action = 'customer_invoice.create'
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING id, action INTO queue_id, queue_action;
  END IF;

  UPDATE pennylane_sync_queue
  SET
    payload = sync_payload,
    priority = LEAST(priority, CASE WHEN sync_action = 'customer_invoice.create' THEN 40 ELSE 70 END),
    scheduled_at = now(),
    last_error = NULL,
    updated_at = now()
  WHERE queue_id IS NULL
    AND id = (
      SELECT id
      FROM pennylane_sync_queue
      WHERE store_id = NEW.store_id
        AND entity_type = 'customer_invoice'
        AND entity_id = NEW.id
        AND action = sync_action
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    )
  RETURNING id, action INTO queue_id, queue_action;

  IF queue_id IS NULL THEN
    INSERT INTO pennylane_sync_queue (
      store_id, entity_type, entity_id, action, status,
      priority, payload, created_by
    ) VALUES (
      NEW.store_id, 'customer_invoice', NEW.id, sync_action, 'pending',
      CASE WHEN sync_action = 'customer_invoice.create' THEN 40 ELSE 70 END,
      sync_payload,
      COALESCE(NEW.updated_by, NEW.created_by)
    )
    RETURNING id INTO queue_id;
    queue_action := sync_action;
  END IF;

  INSERT INTO pennylane_sync_logs (
    queue_id, store_id, status, message,
    request_payload, created_by
  ) VALUES (
    queue_id,
    NEW.store_id,
    'pending',
    'Demande de synchronisation facture client Pennylane ajoutee a la queue.',
    jsonb_build_object(
      'entity_type', 'customer_invoice',
      'entity_id', NEW.id,
      'action', queue_action,
      'requested_action', sync_action,
      'payload', sync_payload
    ),
    COALESCE(NEW.updated_by, NEW.created_by)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_documents_pennylane_customer_invoice_sync_insert_trg ON sales_documents;
CREATE TRIGGER sales_documents_pennylane_customer_invoice_sync_insert_trg
BEFORE INSERT ON sales_documents
FOR EACH ROW
EXECUTE FUNCTION enqueue_pennylane_customer_invoice_sync();

DROP TRIGGER IF EXISTS sales_documents_pennylane_customer_invoice_sync_update_trg ON sales_documents;
CREATE TRIGGER sales_documents_pennylane_customer_invoice_sync_update_trg
BEFORE UPDATE OF
  status, document_type, billed_client_id, client_id,
  document_date, reference_number, notes,
  total_amount_ex_vat, total_vat_amount, total_amount_inc_vat,
  vat_rate_snapshot, is_vat_exempt_snapshot
ON sales_documents
FOR EACH ROW
WHEN (
  OLD.document_type IS DISTINCT FROM NEW.document_type
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.billed_client_id IS DISTINCT FROM NEW.billed_client_id
  OR OLD.client_id IS DISTINCT FROM NEW.client_id
  OR OLD.document_date IS DISTINCT FROM NEW.document_date
  OR OLD.reference_number IS DISTINCT FROM NEW.reference_number
  OR OLD.notes IS DISTINCT FROM NEW.notes
  OR OLD.total_amount_ex_vat IS DISTINCT FROM NEW.total_amount_ex_vat
  OR OLD.total_vat_amount IS DISTINCT FROM NEW.total_vat_amount
  OR OLD.total_amount_inc_vat IS DISTINCT FROM NEW.total_amount_inc_vat
  OR OLD.vat_rate_snapshot IS DISTINCT FROM NEW.vat_rate_snapshot
  OR OLD.is_vat_exempt_snapshot IS DISTINCT FROM NEW.is_vat_exempt_snapshot
)
EXECUTE FUNCTION enqueue_pennylane_customer_invoice_sync();

COMMIT;
