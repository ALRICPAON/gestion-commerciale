#!/usr/bin/env node

/**
 * Read-only diagnostic for quality operation execution integrity after a failed
 * an /api/quality/operations/.../execute request.
 *
 * Usage:
 *   node backend/scripts/diagnose-quality-operation-execution-integrity.js <store_id> [hours]
 *
 * This script never mutates data.
 */

const db = require('../db');

async function query(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows;
}

async function count(sql, params) {
  const rows = await query(sql, params);
  return Number(rows[0]?.count || 0);
}

async function main() {
  const storeId = process.argv[2];
  const hours = Number(process.argv[3] || 24);
  if (!storeId || !Number.isFinite(hours) || hours <= 0) {
    throw new Error('Usage: node backend/scripts/diagnose-quality-operation-execution-integrity.js <store_id> [hours]');
  }
  if (process.argv.includes('--apply')) {
    throw new Error('Apply mode is intentionally disabled: diagnostic is read-only.');
  }

  const params = [storeId, hours];
  const sinceSql = "now() - ($2::int || ' hours')::interval";
  const report = {
    ok: true,
    mode: 'read_only',
    store_id: storeId,
    window_hours: hours,
    counts: {
      recent_temperature_records: await count(
        `SELECT count(*) FROM quality_temperature_records
         WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL`,
        params
      ),
      recent_cleaning_records: await count(
        `SELECT count(*) FROM quality_cleaning_records
         WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL`,
        params
      ),
      records_without_occurrence: await count(
        `SELECT count(*) FROM (
           SELECT id FROM quality_temperature_records
           WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL AND occurrence_id IS NULL
           UNION ALL
           SELECT id FROM quality_cleaning_records
           WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL AND occurrence_id IS NULL
         ) records`,
        params
      ),
      completed_occurrences_without_record: await count(
        `SELECT count(*) FROM quality_task_occurrences
         WHERE store_id = $1::uuid
           AND completed_at >= ${sinceSql}
           AND status = 'completed'
           AND source_record_id IS NULL`,
        params
      ),
    },
    samples: {
      temperature_records_without_occurrence: await query(
        `SELECT id, quality_task_id, type_code, value, recorded_at, source, created_at
         FROM quality_temperature_records
         WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL AND occurrence_id IS NULL
         ORDER BY created_at DESC
         LIMIT 25`,
        params
      ),
      cleaning_records_without_occurrence: await query(
        `SELECT id, quality_task_id, cleaning_plan_id, status, performed_at, source, created_at
         FROM quality_cleaning_records
         WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL AND occurrence_id IS NULL
         ORDER BY created_at DESC
         LIMIT 25`,
        params
      ),
      completed_occurrences_without_record: await query(
        `SELECT id, task_id, due_at, completed_at, source_record_type, source_record_id
         FROM quality_task_occurrences
         WHERE store_id = $1::uuid
           AND completed_at >= ${sinceSql}
           AND status = 'completed'
           AND source_record_id IS NULL
         ORDER BY completed_at DESC
         LIMIT 25`,
        params
      ),
      duplicate_recent_records_by_occurrence: await query(
        `SELECT occurrence_id, record_type, count(*)::int AS record_count, max(created_at) AS latest_created_at
         FROM (
           SELECT occurrence_id, 'temperature' AS record_type, created_at
           FROM quality_temperature_records
           WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL AND occurrence_id IS NOT NULL
           UNION ALL
           SELECT occurrence_id, 'cleaning' AS record_type, created_at
           FROM quality_cleaning_records
           WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL AND occurrence_id IS NOT NULL
           UNION ALL
           SELECT occurrence_id, 'manual' AS record_type, created_at
           FROM quality_manual_task_records
           WHERE store_id = $1::uuid AND created_at >= ${sinceSql} AND deleted_at IS NULL AND occurrence_id IS NOT NULL
         ) records
         GROUP BY occurrence_id, record_type
         HAVING count(*) > 1
         ORDER BY latest_created_at DESC
         LIMIT 25`,
        params
      ),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
