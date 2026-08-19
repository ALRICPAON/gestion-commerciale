BEGIN;

ALTER TABLE articles
  DROP COLUMN IF EXISTS storage_instruction,
  DROP COLUMN IF EXISTS storage_temperature_max,
  DROP COLUMN IF EXISTS storage_temperature_min;

COMMIT;
