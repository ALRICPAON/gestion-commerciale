BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_document_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES quality_documentation_collections(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES quality_documentation_sections(id) ON DELETE CASCADE,
  block_id text NOT NULL,
  title text NOT NULL,
  table_type text NOT NULL DEFAULT 'generic',
  schema_version integer NOT NULL DEFAULT 1,
  table_data jsonb NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT quality_document_tables_block_unique UNIQUE (store_id, section_id, block_id)
);

CREATE INDEX IF NOT EXISTS idx_quality_document_tables_section
  ON quality_document_tables(store_id, section_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_quality_document_tables_collection
  ON quality_document_tables(store_id, collection_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS quality_document_table_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'Autre',
  table_data jsonb NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_quality_document_table_templates_store
  ON quality_document_table_templates(store_id, is_system, archived_at);

COMMIT;
