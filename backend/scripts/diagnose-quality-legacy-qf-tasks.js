#!/usr/bin/env node

/**
 * Read-only diagnostic for legacy QF-01..QF-13 quality tasks.
 *
 * Usage:
 *   node backend/scripts/diagnose-quality-legacy-qf-tasks.js <store_id>
 *
 * This script intentionally does not mutate data unless a future targeted apply
 * mode is implemented with explicit confirmation.
 */

const db = require('../db');

const QF_PATTERN = /(^|\b)QF-?(0?[1-9]|1[0-3])(\b|$)/i;

async function main() {
  const storeId = process.argv[2];
  if (!storeId) {
    throw new Error('Usage: node backend/scripts/diagnose-quality-legacy-qf-tasks.js <store_id>');
  }
  if (process.argv.includes('--apply')) {
    throw new Error('Apply mode is intentionally disabled: review the diagnostic report first and implement a targeted confirmed migration.');
  }

  const { rows } = await db.query(
    `WITH candidate_tasks AS (
       SELECT qt.*
       FROM quality_tasks qt
       WHERE qt.store_id = $1::uuid
         AND qt.module_key = 'temperature'
         AND (qt.title ~* '(^|\\m)QF-?0?[1-9](\\M|$)' OR qt.title ~* '(^|\\m)QF-?1[0-3](\\M|$)' OR qt.category = 'temperature')
     ),
     history AS (
       SELECT task_id, count(*)::int AS history_count, max(completed_at) AS last_completed_at
       FROM quality_task_history
       WHERE store_id = $1::uuid
       GROUP BY task_id
     )
     SELECT
       t.id,
       t.title,
       t.category,
       t.status,
       t.active,
       t.created_source,
       t.task_origin,
       t.source_entity_type,
       t.source_entity_id,
       t.source_locked,
       COALESCE(h.history_count, 0) AS history_count,
       h.last_completed_at,
       l.id AS possible_temperature_parameter_id,
       l.type_code AS possible_temperature_type,
       p.id AS possible_cleaning_plan_id,
       p.title AS possible_cleaning_plan_title
     FROM candidate_tasks t
     LEFT JOIN history h ON h.task_id = t.id
     LEFT JOIN quality_temperature_limits l ON l.quality_task_id = t.id AND l.store_id = t.store_id
     LEFT JOIN quality_cleaning_plans p ON p.quality_task_id = t.id AND p.store_id = t.store_id
     ORDER BY t.title ASC, t.created_at ASC`,
    [storeId]
  );

  const report = rows.map((row) => {
    let recommendation = 'keep_manual_for_review';
    if (row.possible_temperature_parameter_id) recommendation = 'attach_as_system_temperature_parameter';
    if (row.possible_cleaning_plan_id) recommendation = 'attach_as_system_cleaning_plan';
    if (!row.possible_temperature_parameter_id && !row.possible_cleaning_plan_id && row.history_count === 0 && QF_PATTERN.test(row.title || '')) {
      recommendation = 'candidate_archive_after_human_confirmation';
    }
    return {
      id: row.id,
      code: (String(row.title || '').match(QF_PATTERN) || [null])[0],
      title: row.title,
      category: row.category,
      status: row.status,
      active: row.active,
      origin: row.task_origin || 'MANUAL',
      source_entity_type: row.source_entity_type,
      source_entity_id: row.source_entity_id,
      source_locked: row.source_locked === true,
      history_count: row.history_count,
      last_completed_at: row.last_completed_at,
      possible_temperature_parameter_id: row.possible_temperature_parameter_id,
      possible_temperature_type: row.possible_temperature_type,
      possible_cleaning_plan_id: row.possible_cleaning_plan_id,
      possible_cleaning_plan_title: row.possible_cleaning_plan_title,
      recommendation,
    };
  });

  console.log(JSON.stringify({
    ok: true,
    mode: 'read_only',
    store_id: storeId,
    qf_task_count: report.length,
    report,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
