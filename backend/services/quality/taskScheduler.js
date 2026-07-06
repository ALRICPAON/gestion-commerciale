const VALID_FREQUENCY_UNITS = Object.freeze(['hours', 'days', 'weeks', 'months', 'events']);
const OPEN_STATUSES = Object.freeze(['planned', 'due', 'overdue']);

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTargetTime(targetTime) {
  if (!targetTime) return null;
  const match = String(targetTime).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
    seconds: Number(match[3] || 0),
  };
}

function applyTargetTime(date, targetTime) {
  const parsed = parseTargetTime(targetTime);
  if (!parsed) return date;
  const next = new Date(date.getTime());
  next.setUTCHours(parsed.hours, parsed.minutes, parsed.seconds, 0);
  return next;
}

function addFrequency(baseDate, frequencyValue, frequencyUnit) {
  const value = Number(frequencyValue);
  if (!Number.isInteger(value) || value <= 0 || !VALID_FREQUENCY_UNITS.includes(frequencyUnit)) return null;
  if (frequencyUnit === 'events') return null;

  const next = new Date(baseDate.getTime());
  if (frequencyUnit === 'hours') next.setUTCHours(next.getUTCHours() + value);
  if (frequencyUnit === 'days') next.setUTCDate(next.getUTCDate() + value);
  if (frequencyUnit === 'weeks') next.setUTCDate(next.getUTCDate() + (value * 7));
  if (frequencyUnit === 'months') next.setUTCMonth(next.getUTCMonth() + value);
  return next;
}

function calculateNextDueAt({
  fromDate = new Date(),
  frequencyValue,
  frequencyUnit,
  targetTime = null,
} = {}) {
  const baseDate = toDate(fromDate) || new Date();
  const next = addFrequency(baseDate, frequencyValue, frequencyUnit);
  if (!next) return null;
  return applyTargetTime(next, targetTime);
}

function isOverdue(task, referenceDate = new Date()) {
  if (!task || task.active === false || !task.next_due_at) return false;
  const dueAt = toDate(task.next_due_at);
  const reference = toDate(referenceDate) || new Date();
  return Boolean(dueAt && dueAt.getTime() < reference.getTime());
}

function isDueToday(task, referenceDate = new Date()) {
  if (!task || task.active === false || !task.next_due_at) return false;
  const dueAt = toDate(task.next_due_at);
  const reference = toDate(referenceDate) || new Date();
  if (!dueAt) return false;
  return dueAt.toISOString().slice(0, 10) === reference.toISOString().slice(0, 10);
}

function resolveTaskStatus(task, referenceDate = new Date()) {
  if (!task) return 'planned';
  if (task.active === false) return 'paused';
  if (task.status && !OPEN_STATUSES.includes(task.status)) return task.status;
  if (isOverdue(task, referenceDate)) return 'overdue';
  if (isDueToday(task, referenceDate)) return 'due';
  return 'planned';
}

function enrichTask(task, referenceDate = new Date()) {
  if (!task) return null;
  return {
    ...task,
    computed_status: resolveTaskStatus(task, referenceDate),
    is_overdue: isOverdue(task, referenceDate),
    is_due_today: isDueToday(task, referenceDate),
  };
}

module.exports = {
  VALID_FREQUENCY_UNITS,
  calculateNextDueAt,
  enrichTask,
  isDueToday,
  isOverdue,
  resolveTaskStatus,
};
