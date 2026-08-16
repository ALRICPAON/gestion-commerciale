BEGIN;

DROP TABLE IF EXISTS product_recall_recipients;
DROP TABLE IF EXISTS product_recall_campaigns;

-- Only drop auxiliary UNIQUE constraints owned by migration 104.
-- Existing historical constraints with equivalent columns are detected and reused
-- by the forward migration, then left untouched here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recall_quality_evidence_records_id_store_id_unique'
      AND conrelid = 'quality_evidence_records'::regclass
  ) THEN
    ALTER TABLE quality_evidence_records
      DROP CONSTRAINT product_recall_quality_evidence_records_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recall_quality_events_id_store_id_unique'
      AND conrelid = 'quality_events'::regclass
  ) THEN
    ALTER TABLE quality_events
      DROP CONSTRAINT product_recall_quality_events_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recall_client_contacts_id_store_id_unique'
      AND conrelid = 'client_contacts'::regclass
  ) THEN
    ALTER TABLE client_contacts
      DROP CONSTRAINT product_recall_client_contacts_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recall_articles_id_store_id_unique'
      AND conrelid = 'articles'::regclass
  ) THEN
    ALTER TABLE articles
      DROP CONSTRAINT product_recall_articles_id_store_id_unique;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recall_clients_id_store_id_unique'
      AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients
      DROP CONSTRAINT product_recall_clients_id_store_id_unique;
  END IF;
END $$;

COMMIT;
