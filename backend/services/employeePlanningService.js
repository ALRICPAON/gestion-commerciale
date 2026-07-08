'use strict';

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

const NON_WORKING_DAY_TYPES = new Set([
  'rest',
  'paid_leave',
  'sick_leave',
  'unpaid_leave',
  'holiday',
  'recovery',
]);

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

function minutesBetween(start, end, breakMinutes = 0) {
  if (!start || !end) return 0;

  const [sh, sm] = String(start).slice(0, 5).split(':').map(Number);
  const [eh, em] = String(end).slice(0, 5).split(':').map(Number);

  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;

  const startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;

  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }

  return Math.max(0, endMinutes - startMinutes - toMinutes(breakMinutes));
}

function formatHours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

function hoursForLine(line, startField, endField, breakField) {
  if (NON_WORKING_DAY_TYPES.has(line.day_type)) return 0;
  return formatHours(minutesBetween(line[startField], line[endField], line[breakField]));
}

function addComputedHours(line) {
  return {
    ...line,
    planned_hours: hoursForLine(line, 'planned_start', 'planned_end', 'planned_break_minutes'),
    actual_hours: hoursForLine(line, 'actual_start', 'actual_end', 'actual_break_minutes'),
  };
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

  const { rows } = await db.query(
    `INSERT INTO employees (
       store_id, user_id, first_name, last_name, email, phone, job_title,
       contract_type, weekly_hours, hire_date, leave_date, is_active
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      nullableDate(payload.hire_date),
      nullableDate(payload.leave_date),
      payload.is_active !== false,
    ]
  );

  return rows[0];
}

async function updateEmployee(req, id, payload) {
  assertManager(req);
  const db = getDb(req);
  const storeId = getStoreId(req);

  const { rows } = await db.query(
    `UPDATE employees
     SET
       user_id = COALESCE($3, user_id),
       first_name = COALESCE($4, first_name),
       last_name = COALESCE($5, last_name),
       email = $6,
       phone = $7,
       job_title = $8,
       contract_type = COALESCE($9, contract_type),
       weekly_hours = COALESCE($10, weekly_hours),
       hire_date = $11,
       leave_date = $12,
       is_active = COALESCE($13, is_active),
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
      nullableDate(payload.hire_date),
      nullableDate(payload.leave_date),
      payload.is_active,
    ]
  );

  if (!rows[0]) throw makeError('Salarie introuvable.', 404);
  return rows[0];
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
       e.weekly_hours
     FROM employee_planning_lines l
     JOIN employees e ON e.id = l.employee_id AND e.store_id = $2
     WHERE l.planning_week_id = $1
     ORDER BY e.last_name ASC, e.first_name ASC, l.work_date ASC`,
    [week.id, storeId]
  );

  const lines = lineRows.map(addComputedHours);
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
    employees,
    lines,
    totals: Array.from(totalsByEmployee.values()).map((total) => ({
      ...total,
      planned_hours: formatHours(total.planned_hours * 60),
      actual_hours: formatHours(total.actual_hours * 60),
    })),
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

  const { rows } = await db.query(
    `INSERT INTO employee_planning_lines (
       planning_week_id, employee_id, work_date, planned_start, planned_end,
       planned_break_minutes, actual_start, actual_end, actual_break_minutes,
       day_type, employee_comment, manager_comment
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
       updated_at = now()
     RETURNING *`,
    [
      week.id,
      employeeId,
      workDate,
      nullableTime(payload.planned_start),
      nullableTime(payload.planned_end),
      toMinutes(payload.planned_break_minutes),
      nullableTime(payload.actual_start),
      nullableTime(payload.actual_end),
      toMinutes(payload.actual_break_minutes),
      dayType,
      cleanText(payload.employee_comment),
      cleanText(payload.manager_comment),
    ]
  );

  return addComputedHours(rows[0]);
}

async function canValidateLine(req, lineId) {
  const db = getDb(req);
  const storeId = getStoreId(req);
  const { rows } = await db.query(
    `SELECT l.*, e.user_id, e.store_id
     FROM employee_planning_lines l
     JOIN employees e ON e.id = l.employee_id
     WHERE l.id = $1 AND e.store_id = $2`,
    [lineId, storeId]
  );

  const line = rows[0];
  if (!line) throw makeError('Ligne planning introuvable.', 404);
  if (isManager(req) || (line.user_id && line.user_id === req.user.id)) return line;
  throw makeError('Acces interdit', 403);
}

async function employeeValidateLine(req, id, payload = {}) {
  const db = getDb(req);
  await canValidateLine(req, id);

  const { rows } = await db.query(
    `UPDATE employee_planning_lines
     SET
       actual_start = COALESCE($2, actual_start),
       actual_end = COALESCE($3, actual_end),
       actual_break_minutes = COALESCE($4, actual_break_minutes),
       employee_comment = COALESCE($5, employee_comment),
       employee_validated_at = now(),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      nullableTime(payload.actual_start),
      nullableTime(payload.actual_end),
      payload.actual_break_minutes === undefined ? null : toMinutes(payload.actual_break_minutes),
      cleanText(payload.employee_comment),
    ]
  );

  return addComputedHours(rows[0]);
}

async function managerValidateLine(req, id, payload = {}) {
  assertManager(req);
  const db = getDb(req);
  const storeId = getStoreId(req);

  const { rows } = await db.query(
    `UPDATE employee_planning_lines l
     SET
       actual_start = COALESCE($3, actual_start),
       actual_end = COALESCE($4, actual_end),
       actual_break_minutes = COALESCE($5, actual_break_minutes),
       manager_comment = COALESCE($6, manager_comment),
       manager_validated_at = now(),
       updated_at = now()
     FROM employees e
     WHERE l.id = $1
       AND l.employee_id = e.id
       AND e.store_id = $2
     RETURNING l.*`,
    [
      id,
      storeId,
      nullableTime(payload.actual_start),
      nullableTime(payload.actual_end),
      payload.actual_break_minutes === undefined ? null : toMinutes(payload.actual_break_minutes),
      cleanText(payload.manager_comment),
    ]
  );

  if (!rows[0]) throw makeError('Ligne planning introuvable.', 404);
  return addComputedHours(rows[0]);
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
       l.work_date,
       l.day_type,
       l.planned_start,
       l.planned_end,
       l.planned_break_minutes,
       l.actual_start,
       l.actual_end,
       l.actual_break_minutes,
       l.employee_validated_at,
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

  return rows.map(addComputedHours);
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
