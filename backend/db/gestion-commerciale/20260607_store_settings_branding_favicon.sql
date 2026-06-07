BEGIN;

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS favicon_url text;

COMMIT;
