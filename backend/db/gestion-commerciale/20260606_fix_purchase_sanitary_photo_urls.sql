-- Diagnostic a executer avant migration pour inspecter les 3 derniers achats annules.
-- Il permet de verifier purchase_lines, purchase_line_metadata, sanitary_photo_url
-- et le type JSONB de sanitary_photo_urls.
SELECT
  p.id AS purchase_id,
  p.status,
  p.created_at,
  p.updated_at,
  pl.id AS purchase_line_id,
  pl.line_number,
  pl.supplier_label,
  plm.sanitary_photo_url,
  plm.sanitary_photo_urls,
  jsonb_typeof(plm.sanitary_photo_urls) AS sanitary_photo_urls_type
FROM (
  SELECT id, status, created_at, updated_at
  FROM purchases
  WHERE status = 'cancelled'
  ORDER BY updated_at DESC NULLS LAST, created_at DESC
  LIMIT 3
) p
LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id AND plm.meta_key = 'gc_line'
ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, pl.line_number;

BEGIN;

-- Nettoyage : sanitary_photo_urls doit etre un tableau JSONB.
-- Si une valeur non-array existe, on repart de sanitary_photo_url quand il est exploitable,
-- sinon on stocke un tableau vide. Les arrays existants sont filtres sur les URLs attendues.
WITH normalized AS (
  SELECT
    id,
    CASE
      WHEN jsonb_typeof(sanitary_photo_urls) = 'array' THEN COALESCE((
        SELECT jsonb_agg(to_jsonb(photo_url))
        FROM jsonb_array_elements_text(sanitary_photo_urls) AS item(photo_url)
        WHERE photo_url ~ '^(https?://|/uploads/sanitary-photos/)'
      ), '[]'::jsonb)
      WHEN COALESCE(NULLIF(trim(sanitary_photo_url), ''), '') ~ '^(https?://|/uploads/sanitary-photos/)'
        THEN jsonb_build_array(trim(sanitary_photo_url))
      ELSE '[]'::jsonb
    END AS sanitary_photo_urls_clean
  FROM purchase_line_metadata
  WHERE meta_key = 'gc_line'
)
UPDATE purchase_line_metadata plm
SET sanitary_photo_urls = normalized.sanitary_photo_urls_clean,
    updated_at = NOW()
FROM normalized
WHERE plm.id = normalized.id
  AND COALESCE(plm.sanitary_photo_urls, 'null'::jsonb) IS DISTINCT FROM normalized.sanitary_photo_urls_clean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_line_metadata_sanitary_photo_urls_array_chk'
  ) THEN
    ALTER TABLE purchase_line_metadata
      ADD CONSTRAINT purchase_line_metadata_sanitary_photo_urls_array_chk
      CHECK (sanitary_photo_urls IS NULL OR jsonb_typeof(sanitary_photo_urls) = 'array')
      NOT VALID;
  END IF;
END $$;

ALTER TABLE purchase_line_metadata
  VALIDATE CONSTRAINT purchase_line_metadata_sanitary_photo_urls_array_chk;

COMMIT;
