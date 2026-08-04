const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const db = require('../db');

function jsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function normalizeTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  return text.length === 5 ? `${text}:00` : text.slice(0, 8);
}

function scheduleEntries(limit) {
  const days = jsonArray(limit.scheduled_days);
  const times = jsonArray(limit.target_times).map(normalizeTime).filter(Boolean);
  const effectiveDays = days.length ? days : ['any'];
  const effectiveTimes = times.length ? times : [normalizeTime(limit.target_time) || '00:00:00'];
  return effectiveDays.flatMap((day) => effectiveTimes.map((targetTime) => `${day}|${targetTime}`));
}

function duplicates(values) {
  const seen = new Set();
  const duplicated = new Set();
  values.forEach((value) => {
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  });
  return [...duplicated];
}

async function main() {
  const storeId = process.argv.find((arg) => arg.startsWith('--store-id='))?.split('=')[1] || process.env.STORE_ID || process.env.DEFAULT_STORE_ID;
  if (!storeId) {
    throw new Error('STORE_ID manquant. Utiliser --store-id=<uuid> ou definir STORE_ID.');
  }

  const limits = await db.query(
    `SELECT l.id, l.type_code, t.label AS type_label, l.zone_id, z.name AS zone_name,
            l.equipment_id, e.name AS equipment_name, l.scheduled_days, l.target_times,
            l.target_time, l.quality_task_id, l.is_active
     FROM quality_temperature_limits l
     LEFT JOIN quality_temperature_types t ON t.code = l.type_code
     LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
     LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
     WHERE l.store_id = $1::uuid AND l.deleted_at IS NULL
     ORDER BY l.is_active DESC, t.label ASC, z.name ASC, e.name ASC`,
    [storeId]
  );

  const links = await db.query(
    `SELECT ltt.limit_id, ltt.scheduled_day, ltt.target_time, ltt.task_id,
            qt.title, qt.active, qt.status, qt.next_due_at
     FROM quality_temperature_limit_tasks ltt
     LEFT JOIN quality_tasks qt ON qt.id = ltt.task_id
     WHERE ltt.deleted_at IS NULL
       AND ltt.limit_id IN (SELECT id FROM quality_temperature_limits WHERE store_id = $1::uuid)
     ORDER BY ltt.limit_id, ltt.scheduled_day, ltt.target_time`,
    [storeId]
  );

  const occurrences = await db.query(
    `SELECT o.task_id, count(*)::integer AS occurrences,
            count(*) FILTER (WHERE o.status = 'completed')::integer AS completed_occurrences,
            min(o.due_at) AS first_due_at, max(o.due_at) AS last_due_at
     FROM quality_task_occurrences o
     WHERE o.store_id = $1::uuid
       AND o.task_id IN (
         SELECT task_id FROM quality_temperature_limit_tasks ltt
         INNER JOIN quality_temperature_limits l ON l.id = ltt.limit_id
         WHERE l.store_id = $1::uuid AND ltt.deleted_at IS NULL
       )
     GROUP BY o.task_id`,
    [storeId]
  );

  const occurrencesByTask = new Map(occurrences.rows.map((row) => [String(row.task_id), row]));
  const linksByLimit = new Map();
  links.rows.forEach((row) => {
    const key = String(row.limit_id);
    if (!linksByLimit.has(key)) linksByLimit.set(key, []);
    linksByLimit.get(key).push(row);
  });

  const parameters = limits.rows.map((limit) => {
    const expectedEntries = scheduleEntries(limit);
    const limitLinks = linksByLimit.get(String(limit.id)) || [];
    const taskIds = limitLinks.map((link) => link.task_id).filter(Boolean);
    return {
      parameter_id: limit.id,
      label: limit.equipment_name || limit.zone_name || limit.type_label || limit.type_code,
      active: limit.is_active,
      scheduled_days: jsonArray(limit.scheduled_days),
      target_times: jsonArray(limit.target_times).map(normalizeTime).filter(Boolean),
      legacy_target_time: normalizeTime(limit.target_time),
      expected_schedule_slots: expectedEntries.length,
      linked_tasks: limitLinks.map((link) => ({
        task_id: link.task_id,
        scheduled_day: link.scheduled_day,
        target_time: normalizeTime(link.target_time),
        title: link.title,
        active: link.active,
        status: link.status,
        next_due_at: link.next_due_at,
        occurrences: occurrencesByTask.get(String(link.task_id)) || null,
      })),
      duplicate_schedule_slots: duplicates(limitLinks.map((link) => `${link.scheduled_day}|${normalizeTime(link.target_time)}`)),
      duplicate_task_ids: duplicates(taskIds.map(String)),
    };
  });

  const totalTasks = parameters.reduce((sum, item) => sum + item.linked_tasks.length, 0);
  const totalExpectedSlots = parameters.reduce((sum, item) => sum + item.expected_schedule_slots, 0);

  console.log(JSON.stringify({
    ok: true,
    store_id: storeId,
    parameters_count: parameters.length,
    total_expected_schedule_slots: totalExpectedSlots,
    total_linked_temperature_tasks: totalTasks,
    architecture: {
      observed: 'Le moteur actuel cree et relie une tache SYSTEM par combinaison scheduled_day + target_time via quality_temperature_limit_tasks.',
      occurrence_usage: 'quality_task_occurrences represente les executions attendues de chaque tache de creneau.',
      conclusion: 'La cardinalite 1 parametre = N taches est volontaire dans le code actuel. Ne pas migrer vers 1 tache par parametre sans refonte du scheduler multi-horaires.',
      proposed_frontend_strategy: 'Regrouper visuellement les taches temperature par parametre, en conservant les taches de creneau et leurs occurrences.',
    },
    parameters,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.end?.());
