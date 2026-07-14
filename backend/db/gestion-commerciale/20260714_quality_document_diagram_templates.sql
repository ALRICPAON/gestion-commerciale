BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_document_diagram_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'Autre',
  editor_mode text NOT NULL DEFAULT 'mermaid',
  source text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT quality_document_diagram_templates_mode_check CHECK (editor_mode IN ('mermaid'))
);

ALTER TABLE quality_document_diagram_templates
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Autre',
  ADD COLUMN IF NOT EXISTS editor_mode text NOT NULL DEFAULT 'mermaid',
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_quality_document_diagram_templates_store
  ON quality_document_diagram_templates(store_id, archived_at, category, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_document_diagram_templates_store_name_active
  ON quality_document_diagram_templates(store_id, lower(name))
  WHERE archived_at IS NULL AND is_system = false;

COMMIT;
