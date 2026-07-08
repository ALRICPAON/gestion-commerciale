'use strict';

const bcrypt = require('bcrypt');

const DAY_TYPES = new Set([
  'worked',
  'rest',
  'paid_leave',
  'sick_leave',
  'unpaid_leave',
  'holiday',
  'recovery',
  'training',
]);

const ABSENCE_TYPES = new Set([
  'paid_leave',
  'sick_leave',
  'unpaid_leave',
  'holiday',
  'recovery',
  'training',
]);

const ZERO_HOUR_DAY_TYPES = new Set(['rest']);

const ALTA_PLANNING_RULES = {
  auto_break_minutes_per_worked_hour: 3,
  night_start: '21:00',
  night_end: '06:00',
  weekly_base_hours: 35,
  overtime_threshold: 35,
  day_types: Array.from(DAY_TYPES),
};

function getDb(req) {
  return req.dbPool || req.db || req.app.get('db');
}

function getStoreId(req) {
  return req.user && req.user.store_id;
}

function isManager(req) {
  return req.user && ['admin', 'responsable'].includes(req.user.role);
}

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function nullableDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function nullableTime(value) {
  if (!value) return null;
  const text = String(value).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(text) ? text : null;
}

function toMinutes(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '').slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function grossMinutesBetween(start, end) {
  if (!start || !end) return 0;

  const startMinutes = timeToMinutes(start);
  let endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null) return 0;

  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }

  return Math.max(0, endMinutes - startMinutes);
}

function automaticBreakMinutes(start, end, dayType) {
  if (ZERO_HOUR_DAY_TYPES.has(dayType)) return 0;
  return Math.round((grossMinutesBetween(start, end) / 60) * ALTA_PLANNING_RULES.auto_break_minutes_per_worked_hour);
}

function minutesBetween(start, end, breakMinutes = 0) {
  return Math.max(0, grossMinutesBetween(start, end) - toMinutes(breakMinutes));
}

function formatHours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

function nightMinutesBetween(start, end, dayType) {
  if (!start || !end || ZERO_HOUR_DAY_TYPES.has(dayType)) return 0;

  const startMinutes = timeToMinutes(start);
  let endMinutes = timeToMinutes(end);
  const nightStart = timeToMinutes(ALTA_PLANNING_RULES.night_start);
  const nightEnd = timeToMinutes(ALTA_PLANNING_RULES.night_end);
  if ([startMinutes, endMinutes, nightStart, nightEnd].some((value) => value === null)) return 0;

  if (endMinutes < startMinutes) endMinutes += 24 * 60;
  let total = 0;

  for (let dayOffset = -24 * 60; dayOffset <= 24 * 60; dayOffset += 24 * 60) {
    let windowStart = nightStart + dayOffset;
    let windowEnd = nightEnd + dayOffset;
    if (windowEnd <= windowStart) windowEnd += 24 * 60;

    const overlapStart = Math.max(startMinutes, windowStart);
    const overlapEnd = Math.min(endMinutes, windowEnd);
    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }

  return total;
}

function hoursForLine(line, startField, endField, breakField) {
  if (ZERO_HOUR_DAY_TYPES.has(line.day_type)) return 0;
  return formatHours(minutesBetween(line[startField], line[endField], line[breakField]));
}

function nightHoursForLine(line) {
  const actualHasTimes = line.actual_start && line.actual_end;
  return formatHours(nightMinutesBetween(
    actualHasTimes ? line.actual_start : line.planned_start,
    actualHasTimes ? line.actual_end : line.planned_end,
    line.day_type
  ));
}

function addComputedHours(line) {
  return {
    ...line,
    planned_hours: hoursForLine(line, 'planned_start', 'planned_end', 'planned_break_minutes'),
    actual_hours: hoursForLine(line, 'actual_start', 'actual_end', 'actual_break_minutes'),
    night_hours: nightHoursForLine(line),
  };
}

function computedFieldsForLine(line) {
  const computed = addComputedHours(line);
  return {
    planned_hours: computed.planned_hours,
    actual_hours: computed.actual_hours,
    night_hours: computed.night_hours,
  };
}

function requestIp(req) {
  return cleanText(req.headers['x-forwarded-for']) || cleanText(req.ip) || cleanText(req.socket && req.socket.remoteAddress);
}

function requestUserAgent(req) {
  return cleanText(req.headers['user-agent']);
}

function sanitizeEmployee(employee) {
  if (!employee) return employee;
  const { validation_pin_hash, ...safeEmployee } = employee;
  return {
    ...safeEmployee,
    has_validation_pin: Boolean(validation_pin_hash),
  };
}

function sanitizeLine(line) {
  if (!line) return line;
  const { validation_pin_hash, ...safeLine } = line;
  return {
    ...safeLine,
    has_validation_pin: Boolean(validation_pin_hash),
  };
}

async function hashPin(pin) {
  const value = cleanText(pin);
  if (!value) return null;
  if (!/^\d{4,12}$/.test(value)) {
    throw makeError('Le code personnel doit contenir entre 4 et 12 chiffres.');
  }
  return bcrypt.hash(value, 10);
}

function assertManager(req) {
  if (!isManager(req)) {
    throw makeError('Acces interdit', 403);
  }
}

async function getEmployeeById(db, storeId, employeeId) {
  const { rows } = await db.query(
    'SELECT * FROM employees WHERE id = $1 AND store_id = $2',
    [employeeId, storeId]
  );
  return rows[0] || null;
}

async function getEmployeeForUser(db, storeId, userId) {
  const { rows } = await db.query(
    `SELECT * FROM employees
     WHERE store_id = $1 AND user_id = $2 AND is_active = true
     ORDER BY created_at ASC
     LIMIT 1`,
    [storeId, userId]
  );
  return rows[0] || null;
}

async function listEmployees(req) {
  assertManager(req);
  const db = getDb(req);
  const { rows } = await db.query(
    `SELECT *
     FROM employees
     WHERE store_id = $1
     ORDER BY is_active DESC, last_name ASC, first_name ASC`,
    [getStoreId(req)]
  );
  return rows.map(sanitizeEmployee);
}

async function listUsers(req) {
  assertManager(req);
  const db = getDb(req);
  const { rows } = await db.query(
    `SELECT id, email, role, is_active
     FROM users
     WHERE store_id = $1
     ORDER BY is_active DESC, email ASC`,
    [getStoreId(req)]
  );
  return rows;
}

async function createEmployee(req, payload) {
  assertManager(req);
  const db = getDb(req);
  const storeId = getStoreId(req);
  const firstName = cleanText(payload.first_name);
  const lastName = cleanText(payload.last_name);

  if (!firstName || !lastName) {
    throw makeError('Le prenom et le nom sont obligatoires.');
  }

  const validationPinHash = await hashPin(payload.validation_pin);

  const { rows } = await db.query(
    `INSERT INTO employees (
       store_id, user_id, first_name, last_name, email, phone, job_title,
       contract_type, weekly_hours, validation_pin_hash, hire_date, leave_date, is_active
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      storeId,
      cleanText(payload.user_id),
      firstName,
      lastName,
      cleanText(payload.email),
      cleanText(payload.phone),
      cleanText(payload.job_title),
      cleanText(payload.contract_type) || 'CDI',
      toNumber(payload.weekly_hours, 35),
      validationPinHash,
      nullableDate(payload.hire_date),
      nullableDate(payload.leave_date),
      payload.is_active !== false,
    ]
  );

  return sanitizeEmployee(rows[0]);
}

async function updateEmployee(req, id, payload) {
  assertManager(req);
  const db = getDb(req);
  const storeId = getStoreId(req);

  const validationPinHash = await hashPin(payload.validation_pin);
  const shouldClearPin = payload.clear_validation_pin === true;

  const { rows } = await db.query(
    `UPDATE employees
     SET
       user_id = $3,
       first_name = COALESCE($4, first_name),
       last_name = COALESCE($5, last_name),
       email = $6,
       phone = $7,
       job_title = $8,
       contract_type = COALESCE($9, contract_type),
       weekly_hours = COALESCE($10, weekly_hours),
       validation_pin_hash = CASE
         WHEN $11::boolean THEN NULL
         WHEN $12::text IS NOT NULL THEN $12::text
         ELSE validation_pin_hash
       END,
       hire_date = $13,
       leave_date = $14,
       is_active = COALESCE($15, is_active),
       updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [
      id,
      storeId,
      cleanText(payload.user_id),
      cleanText(payload.first_name),
      cleanText(payload.last_name),
      cleanText(payload.email),
      cleanText(payload.phone),
      cleanText(payload.job_title),
      cleanText(payload.contract_type),
      payload.weekly_hours === undefined ? null : toNumber(payload.weekly_hours, 35),
      shouldClearPin,
      validationPinHash,
      nullableDate(payload.hire_date),
      nullableDate(payload.leave_date),
      payload.is_active,
    ]
  );

  if (!rows[0]) throw makeError('Salarie introuvable.', 404);
  return sanitizeEmployee(rows[0]);
}

async function getOrCreatePlanningWeek(req, weekStart) {
  assertManager(req);
  const db = getDb(req);
  const storeId = getStoreId(req);
  const cleanWeekStart = nullableDate(weekStart);

  if (!cleanWeekStart) throw makeError('week_start est obligatoire.');

  const { rows } = await db.query(
    `INSERT INTO employee_planning_weeks (store_id, week_start, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (store_id, week_start)
     DO UPDATE SET updated_at = employee_planning_weeks.updated_at
     RETURNING *`,
    [storeId, cleanWeekStart, req.user.id]
  );

  return rows[0];
}

async function getPlanningWeek(req, weekStart) {
  const db = getDb(req);
  const storeId = getStoreId(req);
  const week = await getOrCreatePlanningWeek(req, weekStart);

  const { rows: employees } = await db.query(
    `SELECT *
     FROM employees
     WHERE store_id = $1
     ORDER BY is_active DESC, last_name ASC, first_name ASC`,
    [storeId]
  );

  const { rows: lineRows } = await db.query(
    `SELECT
       l.*,
       e.first_name,
       e.last_name,
       e.job_title,
       e.weekly_hours,
       e.user_id AS employee_user_id,
       e.validation_pin_hash
     FROM employee_planning_lines l
     JOIN employees e ON e.id = l.employee_id AND e.store_id = $2
     WHERE l.planning_week_id = $1
     ORDER BY e.last_name ASC, e.first_name ASC, l.work_date ASC`,
    [week.id, storeId]
  );

  const lines = lineRows.map((line) => sanitizeLine(addComputedHours(line)));
  const totalsByEmployee = new Map();

  for (const line of lines) {
    const current = totalsByEmployee.get(line.employee_id) || {
      employee_id: line.employee_id,
      name: `${line.first_name} ${line.last_name}`,
      planned_hours: 0,
      actual_hours: 0,
    };
    current.planned_hours += line.planned_hours;
    current.actual_hours += line.actual_hours;
    totalsByEmployee.set(line.employee_id, current);
  }

  return {
    week,
    employees: employees.map(sanitizeEmployee),
    lines,
    totals: Array.from(totalsByEmployee.values()).map((total) => ({
      ...total,
      planned_hours: formatHours(total.planned_hours * 60),
      actual_hours: formatHours(total.actual_hours * 60),
    })),
    rules: ALTA_PLANNING_RULES,
  };
}

async function upsertPlanningLine(req, payload) {
  assertManager(req);
  const db = getDb(req);
  const storeId = getStoreId(req);
  const employeeId = cleanText(payload.employee_id);
  const workDate = nullableDate(payload.work_date);
  const dayType = DAY_TYPES.has(payload.day_type) ? payload.day_type : 'worked';

  if (!payload.week_start || !employeeId || !workDate) {
    throw makeError('week_start, employee_id et work_date sont obligatoires.');
  }

  const employee = await getEmployeeById(db, storeId, employeeId);
  if (!employee) throw makeError('Salarie introuvable.', 404);

  const week = await getOrCreatePlanningWeek(req, payload.week_start);
  const plannedStart = nullableTime(payload.planned_start);
  const plannedEnd = nullableTime(payload.planned_end);
  const actualStart = nullableTime(payload.actual_start);
  const actualEnd = nullableTime(payload.actual_end);
  const plannedBreakMinutes = payload.planned_break_minutes === undefined || payload.planned_break_minutes === ''
    ? automaticBreakMinutes(plannedStart, plannedEnd, dayType)
    : toMinutes(payload.planned_break_minutes);
  const actualBreakMinutes = payload.actual_break_minutes === undefined || payload.actual_break_minutes === ''
    ? automaticBreakMinutes(actualStart || plannedStart, actualEnd || plannedEnd, dayType)
    : toMinutes(payload.actual_break_minutes);
  const computed = computedFieldsForLine({
    day_type: dayType,
    planned_start: plannedStart,
    planned_end: plannedEnd,
    planned_break_minutes: plannedBreakMinutes,
    actual_start: actualStart,
    actual_end: actualEnd,
    actual_break_minutes: actualBreakMinutes,
  });

  const { rows } = await db.query(
    `INSERT INTO employee_planning_lines (
       planning_week_id, employee_id, work_date, planned_start, planned_end,
       planned_break_minutes, actual_start, actual_end, actual_break_minutes,
       day_type, employee_comment, manager_comment, planned_hours, actual_hours, night_hours
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (planning_week_id, employee_id, work_date)
     DO UPDATE SET
       planned_start = EXCLUDED.planned_start,
       planned_end = EXCLUDED.planned_end,
       planned_break_minutes = EXCLUDED.planned_break_minutes,
       actual_start = EXCLUDED.actual_start,
       actual_end = EXCLUDED.actual_end,
       actual_break_minutes = EXCLUDED.actual_break_minutes,
       day_type = EXCLUDED.day_type,
       employee_comment = EXCLUDED.employee_comment,
       manager_comment = EXCLUDED.manager_comment,
       planned_hours = EXCLUDED.planned_hours,
       actual_hours = EXCLUDED.actual_hours,
       night_hours = EXCLUDED.night_hours,
       updated_at = now()
     RETURNING *`,
    [
      week.id,
      employeeId,
      workDate,
      plannedStart,
      plannedEnd,
      plannedBreakMinutes,
      actualStart,
      actualEnd,
      actualBreakMinutes,
      dayType,
      cleanText(payload.employee_comment),
      cleanText(payload.manager_comment),
      computed.planned_hours,
      computed.actual_hours,
      computed.night_hours,
    ]
  );

  return addComputedHours(rows[0]);
}

async function getLineForEmployeeValidation(req, lineId) {
  const db = getDb(req);
  const storeId = getStoreId(req);
  const { rows } = await db.query(
    `SELECT l.*, e.user_id AS employee_user_id, e.validation_pin_hash, e.store_id
     FROM employee_planning_lines l
     JOIN employees e ON e.id = l.employee_id
     WHERE l.id = $1 AND e.store_id = $2`,
    [lineId, storeId]
  );

  const line = rows[0];
  if (!line) throw makeError('Ligne planning introuvable.', 404);
  return line;
}

async function resolveEmployeeValidationMethod(req, line, payload = {}) {
  if (line.employee_user_id) {
    if (line.employee_user_id === req.user.id) return 'user_account';
    throw makeError('La validation salarie doit etre faite par le salarie avec son compte ALTA.', 403);
  }

  if (!line.validation_pin_hash) {
    throw makeError('Salarie non lie a un compte utilisateur ALTA et aucun code personnel defini.', 403);
  }

  const pin = cleanText(payload.validation_pin);
  if (!pin) {
    throw makeError('Code personnel salarie obligatoire.', 403);
  }

  const ok = await bcrypt.compare(pin, line.validation_pin_hash);
  if (!ok) {
    throw makeError('Code personnel salarie invalide.', 403);
  }

  return 'pin';
}

async function employeeValidateLine(req, id, payload = {}) {
  const db = getDb(req);
  const existingLine = await getLineForEmployeeValidation(req, id);
  const validationMethod = await resolveEmployeeValidationMethod(req, existingLine, payload);
  const hasExistingActualTimes = Boolean(existingLine.actual_start || existingLine.actual_end);
  const actualStart = nullableTime(payload.actual_start) || existingLine.actual_start || existingLine.planned_start;
  const actualEnd = nullableTime(payload.actual_end) || existingLine.actual_end || existingLine.planned_end;
  const actualBreakMinutes = payload.actual_break_minutes === undefined || payload.actual_break_minutes === ''
    ? (hasExistingActualTimes ? toMinutes(existingLine.actual_break_minutes, toMinutes(existingLine.planned_break_minutes)) : toMinutes(existingLine.planned_break_minutes))
    : toMinutes(payload.actual_break_minutes);
  const computed = computedFieldsForLine({
    ...existingLine,
    actual_start: actualStart,
    actual_end: actualEnd,
    actual_break_minutes: actualBreakMinutes,
  });

  const { rows } = await db.query(
    `UPDATE employee_planning_lines
     SET
       actual_start = $2,
       actual_end = $3,
       actual_break_minutes = $4,
       employee_comment = COALESCE($5, employee_comment),
       employee_validated_at = now(),
       employee_validated_by_user_id = $6,
       employee_validation_ip = $7,
       employee_validation_user_agent = $8,
       employee_validation_method = $9,
       actual_hours = $10,
       night_hours = $11,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      actualStart,
      actualEnd,
      actualBreakMinutes,
      cleanText(payload.employee_comment),
      req.user.id,
      requestIp(req),
      requestUserAgent(req),
      validationMethod,
      computed.actual_hours,
      computed.night_hours,
    ]
  );

  return sanitizeLine(addComputedHours(rows[0]));
}

async function managerValidateLine(req, id, payload = {}) {
  assertManager(req);
  const db = getDb(req);
  const storeId = getStoreId(req);
  const lineCheck = await db.query(
    `SELECT l.*
     FROM employee_planning_lines l
     JOIN employees e ON e.id = l.employee_id
     WHERE l.id = $1 AND e.store_id = $2`,
    [id, storeId]
  );
  const existingLine = lineCheck.rows[0];
  if (!existingLine) throw makeError('Ligne planning introuvable.', 404);
  const hasExistingActualTimes = Boolean(existingLine.actual_start || existingLine.actual_end);
  const actualStart = nullableTime(payload.actual_start) || existingLine.actual_start || existingLine.planned_start;
  const actualEnd = nullableTime(payload.actual_end) || existingLine.actual_end || existingLine.planned_end;
  const actualBreakMinutes = payload.actual_break_minutes === undefined || payload.actual_break_minutes === ''
    ? (hasExistingActualTimes ? toMinutes(existingLine.actual_break_minutes, toMinutes(existingLine.planned_break_minutes)) : toMinutes(existingLine.planned_break_minutes))
    : toMinutes(payload.actual_break_minutes);
  const computed = computedFieldsForLine({
    ...existingLine,
    actual_start: actualStart,
    actual_end: actualEnd,
    actual_break_minutes: actualBreakMinutes,
  });

  const { rows } = await db.query(
    `UPDATE employee_planning_lines l
     SET
       actual_start = $3,
       actual_end = $4,
       actual_break_minutes = $5,
       manager_comment = COALESCE($6, manager_comment),
       manager_validated_at = now(),
       manager_validated_by_user_id = $7,
       manager_validation_ip = $8,
       manager_validation_user_agent = $9,
       manager_validation_method = $10,
       actual_hours = $11,
       night_hours = $12,
       updated_at = now()
     FROM employees e
     WHERE l.id = $1
       AND l.employee_id = e.id
       AND e.store_id = $2
     RETURNING l.*`,
    [
      id,
      storeId,
      actualStart,
      actualEnd,
      actualBreakMinutes,
      cleanText(payload.manager_comment),
      req.user.id,
      requestIp(req),
      requestUserAgent(req),
      'user_account',
      computed.actual_hours,
      computed.night_hours,
    ]
  );

  if (!rows[0]) throw makeError('Ligne planning introuvable.', 404);
  return sanitizeLine(addComputedHours(rows[0]));
}

async function exportPayroll(req, month) {
  assertManager(req);
  const db = getDb(req);

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw makeError('Le mois doit etre au format YYYY-MM.');
  }

  const { rows } = await db.query(
    `SELECT
       e.id AS employee_id,
       e.first_name,
       e.last_name,
       e.job_title,
       date_trunc('week', l.work_date)::date AS week_start,
       l.work_date,
       l.day_type,
       l.planned_start,
       l.planned_end,
       l.planned_break_minutes,
       l.actual_start,
       l.actual_end,
       l.actual_break_minutes,
       l.employee_validated_at,
       l.employee_validation_method,
       l.manager_validated_at,
       l.employee_comment,
       l.manager_comment
     FROM employee_planning_lines l
     JOIN employee_planning_weeks w ON w.id = l.planning_week_id
     JOIN employees e ON e.id = l.employee_id
     WHERE w.store_id = $1
       AND l.work_date >= ($2 || '-01')::date
       AND l.work_date < (($2 || '-01')::date + interval '1 month')
     ORDER BY e.last_name ASC, e.first_name ASC, l.work_date ASC`,
    [getStoreId(req), month]
  );

  const groups = new Map();

  for (const sourceRow of rows) {
    const row = addComputedHours(sourceRow);
    const weekStart = dateOnly(row.week_start);
    const key = `${row.employee_id}:${weekStart}`;
    const current = groups.get(key) || {
      employee_id: row.employee_id,
      salarie: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      poste: row.job_title || '',
      semaine_du: weekStart,
      heures_prevues: 0,
      heures_reelles: 0,
      heures_de_nuit: 0,
      jours_travailles: 0,
      jours_repos: 0,
      jours_conges_payes: 0,
      heures_conges_payes: 0,
      jours_maladie: 0,
      heures_maladie: 0,
      jours_sans_solde: 0,
      heures_sans_solde: 0,
      jours_feries: 0,
      heures_jours_feries: 0,
      jours_recuperation: 0,
      heures_recuperation: 0,
      jours_formation: 0,
      heures_formation: 0,
      employee_validation_dates: [],
      employee_validation_methods: [],
      manager_validation_dates: [],
      employee_validated: true,
      manager_validated: true,
      comments: [],
    };

    const payrollHours = row.actual_start && row.actual_end ? row.actual_hours : row.planned_hours;
    current.heures_prevues += row.planned_hours;
    current.heures_reelles += payrollHours;
    current.heures_de_nuit += row.night_hours;

    if (row.day_type === 'worked') current.jours_travailles += 1;
    if (row.day_type === 'rest') current.jours_repos += 1;
    if (row.day_type === 'paid_leave') {
      current.jours_conges_payes += 1;
      current.heures_conges_payes += payrollHours;
    }
    if (row.day_type === 'sick_leave') {
      current.jours_maladie += 1;
      current.heures_maladie += payrollHours;
    }
    if (row.day_type === 'unpaid_leave') {
      current.jours_sans_solde += 1;
      current.heures_sans_solde += payrollHours;
    }
    if (row.day_type === 'holiday') {
      current.jours_feries += 1;
      current.heures_jours_feries += payrollHours;
    }
    if (row.day_type === 'recovery') {
      current.jours_recuperation += 1;
      current.heures_recuperation += payrollHours;
    }
    if (row.day_type === 'training') {
      current.jours_formation += 1;
      current.heures_formation += payrollHours;
    }

    current.employee_validated = current.employee_validated && Boolean(row.employee_validated_at);
    current.manager_validated = current.manager_validated && Boolean(row.manager_validated_at);
    if (row.employee_validated_at) current.employee_validation_dates.push(row.employee_validated_at);
    if (row.employee_validation_method) current.employee_validation_methods.push(row.employee_validation_method);
    if (row.manager_validated_at) current.manager_validation_dates.push(row.manager_validated_at);
    if (row.employee_comment) current.comments.push(row.employee_comment);
    if (row.manager_comment) current.comments.push(row.manager_comment);

    groups.set(key, current);
  }

  return Array.from(groups.values()).map((row) => {
    const heuresReelles = formatHours(row.heures_reelles * 60);
    return {
      ...row,
      heures_prevues: formatHours(row.heures_prevues * 60),
      heures_reelles: heuresReelles,
      ecart_heures: formatHours((row.heures_reelles - row.heures_prevues) * 60),
      heures_normales: Math.min(heuresReelles, ALTA_PLANNING_RULES.weekly_base_hours),
      heures_supplementaires: Math.max(0, heuresReelles - ALTA_PLANNING_RULES.overtime_threshold),
      heures_de_nuit: formatHours(row.heures_de_nuit * 60),
      heures_conges_payes: formatHours(row.heures_conges_payes * 60),
      heures_maladie: formatHours(row.heures_maladie * 60),
      heures_sans_solde: formatHours(row.heures_sans_solde * 60),
      heures_jours_feries: formatHours(row.heures_jours_feries * 60),
      heures_recuperation: formatHours(row.heures_recuperation * 60),
      heures_formation: formatHours(row.heures_formation * 60),
      valide_salarie: row.employee_validated,
      date_validation_salarie: row.employee_validation_dates.sort().slice(-1)[0] || '',
      methode_validation_salarie: Array.from(new Set(row.employee_validation_methods)).join(' | '),
      valide_responsable: row.manager_validated,
      date_validation_responsable: row.manager_validation_dates.sort().slice(-1)[0] || '',
      commentaire: Array.from(new Set(row.comments)).join(' | '),
    };
  });
}

async function listAbsenceRequests(req) {
  const db = getDb(req);
  const storeId = getStoreId(req);

  if (isManager(req)) {
    const { rows } = await db.query(
      `SELECT ar.*, e.first_name, e.last_name, e.job_title
       FROM employee_absence_requests ar
       JOIN employees e ON e.id = ar.employee_id
       WHERE e.store_id = $1
       ORDER BY ar.created_at DESC`,
      [storeId]
    );
    return rows;
  }

  const employee = await getEmployeeForUser(db, storeId, req.user.id);
  if (!employee) return [];

  const { rows } = await db.query(
    `SELECT ar.*, e.first_name, e.last_name, e.job_title
     FROM employee_absence_requests ar
     JOIN employees e ON e.id = ar.employee_id
     WHERE ar.employee_id = $1 AND e.store_id = $2
     ORDER BY ar.created_at DESC`,
    [employee.id, storeId]
  );
  return rows;
}

async function createAbsenceRequest(req, payload) {
  const db = getDb(req);
  const storeId = getStoreId(req);
  let employeeId = cleanText(payload.employee_id);

  if (!isManager(req)) {
    const employee = await getEmployeeForUser(db, storeId, req.user.id);
    if (!employee) throw makeError('Aucun salarie lie a cet utilisateur.', 403);
    employeeId = employee.id;
  }

  if (!employeeId || !nullableDate(payload.start_date) || !nullableDate(payload.end_date)) {
    throw makeError('employee_id, start_date et end_date sont obligatoires.');
  }

  const employee = await getEmployeeById(db, storeId, employeeId);
  if (!employee) throw makeError('Salarie introuvable.', 404);

  const absenceType = ABSENCE_TYPES.has(payload.absence_type) ? payload.absence_type : 'paid_leave';

  const { rows } = await db.query(
    `INSERT INTO employee_absence_requests (
       employee_id, start_date, end_date, absence_type, status, employee_comment
     )
     VALUES ($1,$2,$3,$4,'pending',$5)
     RETURNING *`,
    [
      employeeId,
      nullableDate(payload.start_date),
      nullableDate(payload.end_date),
      absenceType,
      cleanText(payload.employee_comment),
    ]
  );

  return rows[0];
}

async function decideAbsenceRequest(req, id, decision, payload = {}) {
  assertManager(req);
  const db = getDb(req);
  const status = decision === 'approved' ? 'approved' : 'refused';

  const { rows } = await db.query(
    `UPDATE employee_absence_requests ar
     SET
       status = $3,
       manager_comment = $4,
       decided_by = $5,
       decided_at = now(),
       updated_at = now()
     FROM employees e
     WHERE ar.id = $1
       AND ar.employee_id = e.id
       AND e.store_id = $2
     RETURNING ar.*`,
    [id, getStoreId(req), status, cleanText(payload.manager_comment), req.user.id]
  );

  if (!rows[0]) throw makeError('Demande absence introuvable.', 404);
  return rows[0];
}

module.exports = {
  minutesBetween,
  listEmployees,
  listUsers,
  createEmployee,
  updateEmployee,
  getPlanningWeek,
  upsertPlanningLine,
  employeeValidateLine,
  managerValidateLine,
  exportPayroll,
  listAbsenceRequests,
  createAbsenceRequest,
  decideAbsenceRequest,
};
