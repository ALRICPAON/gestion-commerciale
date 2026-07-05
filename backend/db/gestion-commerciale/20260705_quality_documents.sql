CREATE TABLE IF NOT EXISTS quality_document_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO quality_document_types (code, label) VALUES
  ('NOTICE', 'Notice constructeur'),
  ('FACTURE', 'Facture'),
  ('CERTIFICAT', 'Certificat'),
  ('GARANTIE', 'Garantie'),
  ('PLAN', 'Plan'),
  ('PHOTO', 'Photo'),
  ('VIDEO', 'Vidéo'),
  ('PROCEDURE', 'Procédure'),
  ('FDS', 'Fiche de données sécurité'),
  ('CONTRAT', 'Contrat'),
  ('AUTRE', 'Autre')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, is_active = true;

CREATE TABLE IF NOT EXISTS quality_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  zone_id uuid REFERENCES quality_zones(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES quality_equipments(id) ON DELETE CASCADE,
  type_code text NOT NULL REFERENCES quality_document_types(code),
  name text NOT NULL,
  description text,
  version text,
  document_date date,
  author text,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_documents_owner_check CHECK (
    (owner_type = 'zone' AND zone_id IS NOT NULL AND equipment_id IS NULL AND owner_id = zone_id)
    OR (owner_type = 'equipment' AND equipment_id IS NOT NULL AND zone_id IS NULL AND owner_id = equipment_id)
    OR (owner_type NOT IN ('zone', 'equipment') AND zone_id IS NULL AND equipment_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_documents_store_id ON quality_documents(store_id);
CREATE INDEX IF NOT EXISTS idx_quality_documents_owner ON quality_documents(store_id, owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_quality_documents_type ON quality_documents(type_code);
CREATE INDEX IF NOT EXISTS idx_quality_documents_archived ON quality_documents(archived_at);

CREATE TABLE IF NOT EXISTS quality_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  zone_id uuid REFERENCES quality_zones(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES quality_equipments(id) ON DELETE CASCADE,
  caption text,
  photo_date date,
  author text,
  display_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quality_photos_owner_check CHECK (
    (owner_type = 'zone' AND zone_id IS NOT NULL AND equipment_id IS NULL AND owner_id = zone_id)
    OR (owner_type = 'equipment' AND equipment_id IS NOT NULL AND zone_id IS NULL AND owner_id = equipment_id)
    OR (owner_type NOT IN ('zone', 'equipment') AND zone_id IS NULL AND equipment_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_photos_store_id ON quality_photos(store_id);
CREATE INDEX IF NOT EXISTS idx_quality_photos_owner ON quality_photos(store_id, owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_quality_photos_archived ON quality_photos(archived_at);
CREATE INDEX IF NOT EXISTS idx_quality_photos_primary ON quality_photos(store_id, owner_type, owner_id, is_primary);
