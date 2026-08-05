-- Socle referentiel documentaire maitre qualite.
-- Additif et idempotent: aucune piece existante n est supprimee ou migree automatiquement.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_master_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title text NOT NULL,
  document_type text NOT NULL,
  category text,
  source_type text NOT NULL,
  issuer_name text,
  reference_number text,
  issue_date date,
  valid_from date,
  valid_until date,
  version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'draft',
  original_filename text,
  storage_path text,
  mime_type text,
  file_size bigint,
  checksum_sha256 text,
  description text,
  source_attachment_table text,
  source_attachment_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_master_documents_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT quality_master_documents_status_check CHECK (
    status IN ('draft', 'valid', 'expired', 'replaced', 'archived')
  ),
  CONSTRAINT quality_master_documents_source_type_check CHECK (
    source_type IN ('CCI', 'laboratoire', 'prestataire', 'administration', 'fournisseur', 'interne')
  ),
  CONSTRAINT quality_master_documents_checksum_check CHECK (
    checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE IF NOT EXISTS quality_document_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  relation_type text NOT NULL DEFAULT 'reference',
  label text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_document_references_document_store_fk
    FOREIGN KEY (document_id, store_id)
    REFERENCES quality_master_documents(id, store_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quality_master_documents_store
  ON quality_master_documents(store_id, status, document_type, category);

CREATE INDEX IF NOT EXISTS idx_quality_master_documents_checksum
  ON quality_master_documents(store_id, checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quality_master_documents_source_attachment
  ON quality_master_documents(store_id, source_attachment_table, source_attachment_id)
  WHERE source_attachment_table IS NOT NULL AND source_attachment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quality_document_references_document
  ON quality_document_references(store_id, document_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_quality_document_references_target
  ON quality_document_references(store_id, target_type, target_id, archived_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_document_references_active_target
  ON quality_document_references(
    store_id,
    document_id,
    target_type,
    COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    relation_type
  )
  WHERE archived_at IS NULL;

COMMIT;
