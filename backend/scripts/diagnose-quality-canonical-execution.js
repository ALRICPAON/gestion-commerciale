#!/usr/bin/env node

/**
 * Read-only diagnostic for canonical quality execution links.
 *
 * Usage:
 *   node backend/scripts/diagnose-quality-canonical-execution.js <store_id>
 *
 * This script never mutates production data. It reports records and
 * occurrences that should be reviewed before DDPP exports.
 */

const db = require('../db');

async function count(dbClient, sql, params) {
  const { rows } = await dbClient.query(sql, params);
  return Number(rows[0]?.count || 0);
}

async function sample(dbClient, sql, params) {
  const { rows } = await dbClient.query(sql, params);
  return rows;
}

async function main() {
  const storeId = process.argv[2];
  if (!storeId) {
    throw new Error('Usage: node backend/scripts/diagnose-quality-canonical-execution.js <store_id>');
  }
  if (process.argv.includes('--apply')) {
    throw new Error('Apply mode is intentionally disabled: this diagnostic is read-only.');
  }

  const params = [storeId];
  const report = {
    ok: true,
    mode: 'read_only',
    store_id: storeId,
    checks: {
      temperature_records_without_occurrence: await count(db,
        `SELECT count(*) FROM quality_temperature_records
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND occurrence_id IS NULL`,
        params),
      cleaning_records_without_occurrence: await count(db,
        `SELECT count(*) FROM quality_cleaning_records
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND occurrence_id IS NULL`,
        params),
      completed_occurrences_without_source_record: await count(db,
        `SELECT count(*) FROM quality_task_occurrences
         WHERE store_id = $1::uuid
           AND status = 'completed'
           AND source_record_id IS NULL`,
        params),
      temperature_records_with_task_without_occurrence: await count(db,
        `SELECT count(*) FROM quality_temperature_records
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND quality_task_id IS NOT NULL
           AND occurrence_id IS NULL`,
        params),
      cleaning_records_with_task_without_occurrence: await count(db,
        `SELECT count(*) FROM quality_cleaning_records
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND quality_task_id IS NOT NULL
           AND occurrence_id IS NULL`,
        params),
    },
    duplicate_occurrence_records: {
      temperatures: await sample(db,
        `SELECT occurrence_id, count(*)::int AS record_count
         FROM quality_temperature_records
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND occurrence_id IS NOT NULL
         GROUP BY occurrence_id
         HAVING count(*) > 1
         ORDER BY count(*) DESC, occurrence_id
         LIMIT 25`,
        params),
      cleanings: await sample(db,
        `SELECT occurrence_id, count(*)::int AS record_count
         FROM quality_cleaning_records
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND occurrence_id IS NOT NULL
         GROUP BY occurrence_id
         HAVING count(*) > 1
         ORDER BY count(*) DESC, occurrence_id
         LIMIT 25`,
        params),
      manual_tasks: await sample(db,
        `SELECT occurrence_id, count(*)::int AS record_count
         FROM quality_manual_task_records
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND occurrence_id IS NOT NULL
         GROUP BY occurrence_id
         HAVING count(*) > 1
         ORDER BY count(*) DESC, occurrence_id
         LIMIT 25`,
        params),
    },
    sample_unlinked_completed_occurrences: await sample(db,
      `SELECT id, task_id, due_date, due_at, completed_at, source_record_type, source_record_id
       FROM quality_task_occurrences
       WHERE store_id = $1::uuid
         AND status = 'completed'
         AND source_record_id IS NULL
       ORDER BY completed_at DESC NULLS LAST, due_at DESC NULLS LAST
       LIMIT 25`,
      params),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
