BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_documentation_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'sanitary_approval_manual',
  version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_documentation_collections_store_type_unique UNIQUE (store_id, document_type)
);

CREATE TABLE IF NOT EXISTS quality_documentation_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES quality_documentation_collections(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES quality_documentation_sections(id) ON DELETE SET NULL,
  section_type text NOT NULL DEFAULT 'chapter',
  code text NOT NULL,
  title text NOT NULL,
  content_html text NOT NULL DEFAULT '',
  content_text text NOT NULL DEFAULT '',
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  version text NOT NULL DEFAULT '1.0',
  include_in_export boolean NOT NULL DEFAULT true,
  comment_internal text,
  regulatory_references text,
  created_by uuid,
  updated_by uuid,
  validated_by uuid,
  validated_at timestamptz,
  applicable_from date,
  revision_due_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT quality_documentation_sections_code_unique UNIQUE (store_id, collection_id, code)
);

CREATE TABLE IF NOT EXISTS quality_documentation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES quality_documentation_sections(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  previous_version text,
  version text NOT NULL,
  content_html text NOT NULL DEFAULT '',
  content_text text NOT NULL DEFAULT '',
  change_summary text,
  change_type text NOT NULL DEFAULT 'update',
  previous_content_html text,
  previous_content_text text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_documentation_missing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES quality_documentation_sections(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'normal',
  responsible_user_id uuid,
  due_at date,
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_documentation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES quality_documentation_sections(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  document_id uuid,
  filename text NOT NULL,
  original_filename text,
  mime_type text,
  file_path text NOT NULL,
  file_size bigint,
  include_in_export boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS quality_documentation_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES quality_documentation_collections(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  export_type text NOT NULL DEFAULT 'full',
  version text NOT NULL DEFAULT '1.0',
  options_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  filename text NOT NULL,
  file_path text NOT NULL,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_doc_collections_store ON quality_documentation_collections(store_id);
CREATE INDEX IF NOT EXISTS idx_quality_doc_sections_collection ON quality_documentation_sections(store_id, collection_id, parent_id, display_order);
CREATE INDEX IF NOT EXISTS idx_quality_doc_sections_status ON quality_documentation_sections(store_id, status);
CREATE INDEX IF NOT EXISTS idx_quality_doc_versions_section ON quality_documentation_versions(store_id, section_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_doc_missing_store ON quality_documentation_missing_items(store_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_quality_doc_attachments_section ON quality_documentation_attachments(store_id, section_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_quality_doc_exports_collection ON quality_documentation_exports(store_id, collection_id, generated_at DESC);

COMMIT;
