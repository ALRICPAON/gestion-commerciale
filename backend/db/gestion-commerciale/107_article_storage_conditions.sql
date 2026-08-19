BEGIN;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS storage_temperature_min numeric(6,2),
  ADD COLUMN IF NOT EXISTS storage_temperature_max numeric(6,2),
  ADD COLUMN IF NOT EXISTS storage_instruction text;

COMMIT;
