BEGIN;

ALTER TABLE IF EXISTS quality_lot_status_history
  DROP CONSTRAINT IF EXISTS quality_lot_history_nc_store_fk,
  DROP CONSTRAINT IF EXISTS quality_lot_history_lot_store_fk;

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_quality_nc_store_fk;

DROP TABLE IF EXISTS quality_lot_status_history;

DROP INDEX IF EXISTS idx_lots_quality_status;

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_quality_status_check,
  DROP COLUMN IF EXISTS quality_non_conformity_id,
  DROP COLUMN IF EXISTS quality_release_comment,
  DROP COLUMN IF EXISTS quality_release_reason,
  DROP COLUMN IF EXISTS quality_released_by,
  DROP COLUMN IF EXISTS quality_released_at,
  DROP COLUMN IF EXISTS quality_blocked_by,
  DROP COLUMN IF EXISTS quality_blocked_at,
  DROP COLUMN IF EXISTS quality_block_comment,
  DROP COLUMN IF EXISTS quality_block_reason_type,
  DROP COLUMN IF EXISTS quality_block_reason,
  DROP COLUMN IF EXISTS quality_status;

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_id_store_id_unique;

ALTER TABLE quality_non_conformities
  DROP CONSTRAINT IF EXISTS quality_non_conformities_id_store_id_unique;

COMMIT;
