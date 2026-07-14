BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_document_diagrams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES quality_documentation_collections(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES quality_documentation_sections(id) ON DELETE CASCADE,
  block_id text NOT NULL,
  title text NOT NULL,
  diagram_type text NOT NULL DEFAULT 'process',
  orientation text NOT NULL DEFAULT 'vertical',
  schema_version integer NOT NULL DEFAULT 1,
  diagram_data jsonb NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT quality_document_diagrams_block_unique UNIQUE (store_id, section_id, block_id)
);

ALTER TABLE quality_document_diagrams
  ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES quality_documentation_collections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES quality_documentation_sections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS block_id text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS diagram_type text NOT NULL DEFAULT 'process',
  ADD COLUMN IF NOT EXISTS orientation text NOT NULL DEFAULT 'vertical',
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS diagram_data jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_quality_document_diagrams_section
  ON quality_document_diagrams(store_id, section_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_quality_document_diagrams_collection
  ON quality_document_diagrams(store_id, collection_id, updated_at DESC);

COMMIT;
