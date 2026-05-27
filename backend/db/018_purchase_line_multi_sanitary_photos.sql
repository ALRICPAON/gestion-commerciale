ALTER TABLE purchase_line_metadata
ADD COLUMN IF NOT EXISTS sanitary_photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE purchase_line_metadata
SET sanitary_photo_urls = jsonb_build_array(sanitary_photo_url)
WHERE sanitary_photo_url IS NOT NULL
  AND sanitary_photo_url <> ''
  AND (
    sanitary_photo_urls IS NULL
    OR sanitary_photo_urls = '[]'::jsonb
  );
