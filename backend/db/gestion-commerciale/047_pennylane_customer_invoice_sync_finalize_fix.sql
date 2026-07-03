BEGIN;

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

  sync_action := CASE
    WHEN NEW.pennylane_invoice_id IS NULL THEN 'customer_invoice.create'
    ELSE 'customer_invoice.update'
  END;
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

  UPDATE pennylane_sync_queue
  SET
    status = 'pending',
    attempts = 0,
    locked_at = NULL,
    locked_by = NULL,
    processed_at = NULL,
    last_error = NULL,
    payload = sync_payload,
    priority = LEAST(priority, CASE WHEN sync_action = 'customer_invoice.create' THEN 40 ELSE 70 END),
    scheduled_at = now(),
    updated_at = now()
  WHERE id = (
    SELECT id
    FROM pennylane_sync_queue
    WHERE store_id = NEW.store_id
      AND entity_type = 'customer_invoice'
      AND entity_id = NEW.id
      AND action = sync_action
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

COMMIT;
