BEGIN;

DROP TRIGGER IF EXISTS trg_quality_evidence_records_updated_at ON quality_evidence_records;
DROP TRIGGER IF EXISTS trg_quality_events_updated_at ON quality_events;

DROP FUNCTION IF EXISTS set_quality_evidence_records_updated_at();
DROP FUNCTION IF EXISTS set_quality_events_updated_at();

DROP TABLE IF EXISTS quality_evidence_records;
DROP TABLE IF EXISTS quality_events;

COMMIT;
