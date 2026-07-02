BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS pennylane_customer_id text,
  ADD COLUMN IF NOT EXISTS pennylane_sync_status pennylane_sync_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pennylane_sync_last_error text,
  ADD COLUMN IF NOT EXISTS pennylane_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS pennylane_sync_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS clients_store_pennylane_customer_id_uidx
  ON clients (store_id, pennylane_customer_id)
  WHERE pennylane_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS clients_store_pennylane_sync_status_idx
  ON clients (store_id, pennylane_sync_status, pennylane_sync_updated_at);

CREATE OR REPLACE FUNCTION enqueue_pennylane_client_sync()
RETURNS trigger AS $$
DECLARE
  sync_action text;
  queue_id uuid;
  sync_payload jsonb;
BEGIN
  sync_action := CASE WHEN TG_OP = 'INSERT' THEN 'client.create' ELSE 'client.update' END;
  sync_payload := jsonb_build_object(
    'client_id', NEW.id,
    'code', NEW.code,
    'name', NEW.name,
    'legal_name', NEW.legal_name,
    'email', NEW.email,
    'phone', COALESCE(NEW.phone, NEW.mobile),
    'vat_number', NEW.vat_number,
    'siret', NEW.siret,
    'status', NEW.status,
    'external_reference', 'alta:' || NEW.store_id || ':client:' || NEW.id
  );

  NEW.pennylane_sync_status := 'pending';
  NEW.pennylane_sync_last_error := NULL;
  NEW.pennylane_sync_updated_at := now();

  UPDATE pennylane_sync_queue
  SET
    payload = sync_payload,
    priority = LEAST(priority, CASE WHEN sync_action = 'client.create' THEN 50 ELSE 80 END),
    scheduled_at = now(),
    last_error = NULL,
    updated_at = now()
  WHERE id = (
    SELECT id
    FROM pennylane_sync_queue
    WHERE store_id = NEW.store_id
      AND entity_type = 'client'
      AND entity_id = NEW.id
      AND action = sync_action
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  )
  RETURNING id INTO queue_id;

  IF queue_id IS NULL THEN
    INSERT INTO pennylane_sync_queue (
      store_id, entity_type, entity_id, action, status,
      priority, payload, created_by
    ) VALUES (
      NEW.store_id, 'client', NEW.id, sync_action, 'pending',
      CASE WHEN sync_action = 'client.create' THEN 50 ELSE 80 END,
      sync_payload,
      COALESCE(NEW.updated_by, NEW.created_by)
    )
    RETURNING id INTO queue_id;
  END IF;

  INSERT INTO pennylane_sync_logs (
    queue_id, store_id, status, message,
    request_payload, created_by
  ) VALUES (
    queue_id,
    NEW.store_id,
    'pending',
    'Demande de synchronisation client Pennylane ajoutee a la queue.',
    jsonb_build_object(
      'entity_type', 'client',
      'entity_id', NEW.id,
      'action', sync_action,
      'payload', sync_payload
    ),
    COALESCE(NEW.updated_by, NEW.created_by)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clients_pennylane_sync_insert_trg ON clients;
CREATE TRIGGER clients_pennylane_sync_insert_trg
BEFORE INSERT ON clients
FOR EACH ROW
EXECUTE FUNCTION enqueue_pennylane_client_sync();

DROP TRIGGER IF EXISTS clients_pennylane_sync_update_trg ON clients;
CREATE TRIGGER clients_pennylane_sync_update_trg
BEFORE UPDATE OF
  code, name, legal_name, client_type, status, tariff_level,
  billed_client_id, store_identifier, contact_name, phone, mobile, email,
  address_line1, address_line2, postal_code, city, country,
  vat_number, siret, payment_terms, delivery_terms, notes,
  is_royale_maree_member
ON clients
FOR EACH ROW
WHEN (
  ROW(OLD.code, OLD.name, OLD.legal_name, OLD.client_type, OLD.status, OLD.tariff_level,
      OLD.billed_client_id, OLD.store_identifier, OLD.contact_name, OLD.phone, OLD.mobile, OLD.email,
      OLD.address_line1, OLD.address_line2, OLD.postal_code, OLD.city, OLD.country,
      OLD.vat_number, OLD.siret, OLD.payment_terms, OLD.delivery_terms, OLD.notes,
      OLD.is_royale_maree_member)
  IS DISTINCT FROM
  ROW(NEW.code, NEW.name, NEW.legal_name, NEW.client_type, NEW.status, NEW.tariff_level,
      NEW.billed_client_id, NEW.store_identifier, NEW.contact_name, NEW.phone, NEW.mobile, NEW.email,
      NEW.address_line1, NEW.address_line2, NEW.postal_code, NEW.city, NEW.country,
      NEW.vat_number, NEW.siret, NEW.payment_terms, NEW.delivery_terms, NEW.notes,
      NEW.is_royale_maree_member)
)
EXECUTE FUNCTION enqueue_pennylane_client_sync();

COMMIT;
