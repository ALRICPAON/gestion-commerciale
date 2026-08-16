BEGIN;

DROP TABLE IF EXISTS product_recall_recipients;
DROP TABLE IF EXISTS product_recall_campaigns;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_evidence_records_id_store_id_unique'
      AND conrelid = 'quality_evidence_records'::regclass
  ) THEN
    ALTER TABLE quality_evidence_records
      DROP CONSTRAINT quality_evidence_records_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_events_id_store_id_unique'
      AND conrelid = 'quality_events'::regclass
  ) THEN
    ALTER TABLE quality_events
      DROP CONSTRAINT quality_events_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_contacts_id_store_id_unique'
      AND conrelid = 'client_contacts'::regclass
  ) THEN
    ALTER TABLE client_contacts
      DROP CONSTRAINT client_contacts_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'articles_id_store_id_unique'
      AND conrelid = 'articles'::regclass
  ) THEN
    ALTER TABLE articles
      DROP CONSTRAINT articles_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_id_store_id_unique'
      AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients
      DROP CONSTRAINT clients_id_store_id_unique;
  END IF;
END $$;

COMMIT;
