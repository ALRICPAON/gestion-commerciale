BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_document_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES quality_documentation_collections(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES quality_documentation_sections(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  position integer NOT NULL,
  title text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_visible boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_document_blocks_type_check CHECK (
    block_type IN ('rich_text', 'document_table', 'mermaid_diagram', 'image', 'attachment', 'to_complete', 'separator')
  )
);

ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS collection_id uuid;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS chapter_id uuid;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS block_type text;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS position integer;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS content jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE quality_document_blocks
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quality_document_blocks_type_check'
  ) THEN
    ALTER TABLE quality_document_blocks
      ADD CONSTRAINT quality_document_blocks_type_check CHECK (
        block_type IN ('rich_text', 'document_table', 'mermaid_diagram', 'image', 'attachment', 'to_complete', 'separator')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quality_document_blocks_chapter_fk'
  ) THEN
    ALTER TABLE quality_document_blocks
      ADD CONSTRAINT quality_document_blocks_chapter_fk
      FOREIGN KEY (chapter_id) REFERENCES quality_documentation_sections(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quality_document_blocks_collection_fk'
  ) THEN
    ALTER TABLE quality_document_blocks
      ADD CONSTRAINT quality_document_blocks_collection_fk
      FOREIGN KEY (collection_id) REFERENCES quality_documentation_collections(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quality_document_blocks_chapter
  ON quality_document_blocks(store_id, chapter_id, is_visible, position);

CREATE INDEX IF NOT EXISTS idx_quality_document_blocks_collection
  ON quality_document_blocks(store_id, collection_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_document_blocks_chapter_position
  ON quality_document_blocks(chapter_id, position);

ALTER TABLE quality_documentation_versions
  ADD COLUMN IF NOT EXISTS blocks_snapshot jsonb;
ALTER TABLE quality_documentation_versions
  ADD COLUMN IF NOT EXISTS previous_blocks_snapshot jsonb;

WITH source_sections AS (
  SELECT s.*
  FROM quality_documentation_sections s
  WHERE s.archived_at IS NULL
    AND s.section_type <> 'tome'
    AND NULLIF(BTRIM(s.content_html), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM quality_document_blocks b
      WHERE b.chapter_id = s.id
        AND b.block_type = 'rich_text'
        AND b.content->>'source' = 'legacy_content_html'
    )
)
INSERT INTO quality_document_blocks
  (store_id, collection_id, chapter_id, block_type, position, title, content, is_visible, created_by, updated_by)
SELECT
  store_id,
  collection_id,
  id,
  'rich_text',
  10,
  'Texte du chapitre',
  jsonb_build_object('html', content_html, 'source', 'legacy_content_html'),
  true,
  created_by,
  updated_by
FROM source_sections;

WITH source_tables AS (
  SELECT
    t.*,
    100 + ROW_NUMBER() OVER (PARTITION BY t.section_id ORDER BY t.created_at, t.id) * 10 AS block_position
  FROM quality_document_tables t
  WHERE t.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM quality_document_blocks b
      WHERE b.chapter_id = t.section_id
        AND b.block_type = 'document_table'
        AND b.content->>'table_id' = t.id::text
    )
)
INSERT INTO quality_document_blocks
  (store_id, collection_id, chapter_id, block_type, position, title, content, is_visible, created_by, updated_by)
SELECT
  store_id,
  collection_id,
  section_id,
  'document_table',
  block_position,
  title,
  jsonb_build_object('table_id', id, 'source', 'quality_document_tables'),
  true,
  created_by,
  updated_by
FROM source_tables
ON CONFLICT DO NOTHING;

WITH source_diagrams AS (
  SELECT
    d.*,
    500 + ROW_NUMBER() OVER (PARTITION BY d.section_id ORDER BY d.created_at, d.id) * 10 AS block_position
  FROM quality_document_diagrams d
  WHERE d.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM quality_document_blocks b
      WHERE b.chapter_id = d.section_id
        AND b.block_type = 'mermaid_diagram'
        AND b.content->>'diagram_id' = d.id::text
    )
)
INSERT INTO quality_document_blocks
  (store_id, collection_id, chapter_id, block_type, position, title, content, is_visible, created_by, updated_by)
SELECT
  store_id,
  collection_id,
  section_id,
  'mermaid_diagram',
  block_position,
  title,
  jsonb_build_object('diagram_id', id, 'source', 'quality_document_diagrams'),
  true,
  created_by,
  updated_by
FROM source_diagrams
ON CONFLICT DO NOTHING;

WITH source_attachments AS (
  SELECT
    a.*,
    s.collection_id,
    900 + ROW_NUMBER() OVER (PARTITION BY a.section_id ORDER BY a.display_order, a.created_at, a.id) * 10 AS block_position
  FROM quality_documentation_attachments a
  JOIN quality_documentation_sections s ON s.id = a.section_id AND s.store_id = a.store_id
  WHERE a.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM quality_document_blocks b
      WHERE b.chapter_id = a.section_id
        AND b.block_type IN ('image', 'attachment')
        AND b.content->>'attachment_id' = a.id::text
    )
)
INSERT INTO quality_document_blocks
  (store_id, collection_id, chapter_id, block_type, position, title, content, is_visible, created_by, updated_by)
SELECT
  store_id,
  collection_id,
  section_id,
  CASE WHEN COALESCE(mime_type, '') LIKE 'image/%' THEN 'image' ELSE 'attachment' END,
  block_position,
  filename,
  jsonb_build_object('attachment_id', id, 'source', 'quality_documentation_attachments'),
  include_in_export,
  created_by,
  created_by
FROM source_attachments
ON CONFLICT DO NOTHING;

COMMIT;
