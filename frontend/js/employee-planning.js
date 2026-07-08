const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");

if (!token || !sessionUser) window.location.href = "./login.html";

const API_BASE = window.APP_CONFIG.API_BASE_URL;
const els = {
  userName: document.getElementById("user-name"),
  logout: document.getElementById("logout-btn"),
  backHome: document.getElementById("back-home-btn"),
  refresh: document.getElementById("refresh-btn"),
  employeeForm: document.getElementById("employee-form"),
  employeeId: document.getElementById("employee-id"),
  employeeFirstName: document.getElementById("employee-first-name"),
  employeeLastName: document.getElementById("employee-last-name"),
  employeeEmail: document.getElementById("employee-email"),
  employeePhone: document.getElementById("employee-phone"),
  employeeJobTitle: document.getElementById("employee-job-title"),
  employeeContractType: document.getElementById("employee-contract-type"),
  employeeWeeklyHours: document.getElementById("employee-weekly-hours"),
  employeeIsActive: document.getElementById("employee-is-active"),
  employeeUserId: document.getElementById("employee-user-id"),
  employeeValidationPin: document.getElementById("employee-validation-pin"),
  employeeClearValidationPin: document.getElementById("employee-clear-validation-pin"),
  employeeReset: document.getElementById("employee-reset-btn"),
  employeesFeedback: document.getElementById("employees-feedback"),
  employeesTable: document.getElementById("employees-table-body"),
  weekStart: document.getElementById("week-start-input"),
  weekLabel: document.getElementById("week-label"),
  previousWeek: document.getElementById("previous-week-btn"),
  nextWeek: document.getElementById("next-week-btn"),
  planningFeedback: document.getElementById("planning-feedback"),
  planningHead: document.getElementById("planning-table-head"),
  planningBody: document.getElementById("planning-table-body"),
  validationBody: document.getElementById("validation-table-body"),
  absenceForm: document.getElementById("absence-form"),
  absenceEmployee: document.getElementById("absence-employee"),
  absenceType: document.getElementById("absence-type"),
  absenceStart: document.getElementById("absence-start"),
  absenceEnd: document.getElementById("absence-end"),
  absenceComment: document.getElementById("absence-comment"),
  absenceFeedback: document.getElementById("absence-feedback"),
  absenceTable: document.getElementById("absence-table-body"),
  payrollMonth: document.getElementById("payroll-month"),
  payrollExport: document.getElementById("payroll-export-btn"),
};

const dayTypes = [
  ["worked", "Travaille"],
  ["rest", "Repos"],
  ["paid_leave", "Conge paye"],
  ["sick_leave", "Maladie"],
  ["unpaid_leave", "Sans solde"],
  ["holiday", "Ferie"],
  ["recovery", "Recuperation"],
  ["training", "Formation"],
];

const absenceLabels = {
  paid_leave: "Conge paye",
  sick_leave: "Maladie",
  unpaid_leave: "Conge sans solde",
  holiday: "Ferie",
  recovery: "Recuperation",
  training: "Formation",
};

const statusLabels = {
  pending: "En attente",
  approved: "Acceptee",
  refused: "Refusee",
  cancelled: "Annulee",
};

const nonWorkingDayTypes = new Set(["rest", "paid_leave", "sick_leave", "unpaid_leave", "holiday", "recovery"]);
const defaultPlanningRules = {
  auto_break_minutes_per_worked_hour: 3,
  night_start: "21:00",
  night_end: "06:00",
  weekly_base_hours: 35,
  overtime_threshold: 35,
};

let employees = [];
let users = [];
let planning = { week: null, employees: [], lines: [], totals: [], rules: defaultPlanningRules };
let absenceRequests = [];

function logout() {
  ["gc_token", "gc_user", "gc_active_department", "grv2_token", "grv2_user", "grv2_active_department"].forEach((key) => localStorage.removeItem(key));
  window.location.href = "./login.html";
}

function showFeedback(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", isError);
  el.classList.toggle("success", !isError);
}

function clearFeedback(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("error", "success");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  }[char]));
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Erreur API");
  return data;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function mondayOf(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function weekDays() {
  const start = parseDate(els.weekStart.value);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatDate(value) {
  if (!value) return "-";
  return parseDate(String(value).slice(0, 10)).toLocaleDateString("fr-FR");
}

function formatHour(value) {
  return value ? String(value).slice(0, 5) : "";
}

function timeToMinutes(value) {
  const [hour, minute] = String(value || "").slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function grossMinutesBetween(start, end) {
  if (!start || !end) return 0;
  const startTotal = timeToMinutes(start);
  let endTotal = timeToMinutes(end);
  if (startTotal === null || endTotal === null) return 0;
  if (endTotal < startTotal) endTotal += 24 * 60;
  return Math.max(0, endTotal - startTotal);
}

function autoBreakMinutes(start, end, dayType) {
  if (nonWorkingDayTypes.has(dayType)) return 0;
  const rule = Number((planning.rules || defaultPlanningRules).auto_break_minutes_per_worked_hour || 0);
  return Math.round((grossMinutesBetween(start, end) / 60) * rule);
}

function minutesBetween(start, end, breakMinutes = 0) {
  const pause = Math.max(0, Number(breakMinutes || 0));
  return Math.max(0, grossMinutesBetween(start, end) - pause);
}

function hoursFromFields(start, end, breakMinutes, dayType) {
  if (nonWorkingDayTypes.has(dayType)) return 0;
  return Math.round((minutesBetween(start, end, breakMinutes) / 60) * 100) / 100;
}

function formatHours(value) {
  return `${Number(value || 0).toFixed(2)} h`;
}

function nightHoursFromFields(start, end, dayType) {
  if (!start || !end || nonWorkingDayTypes.has(dayType)) return 0;
  const startTotal = timeToMinutes(start);
  let endTotal = timeToMinutes(end);
  const rules = planning.rules || defaultPlanningRules;
  const nightStart = timeToMinutes(rules.night_start);
  const nightEnd = timeToMinutes(rules.night_end);
  if ([startTotal, endTotal, nightStart, nightEnd].some((value) => value === null)) return 0;
  if (endTotal < startTotal) endTotal += 24 * 60;

  let total = 0;
  for (let dayOffset = -24 * 60; dayOffset <= 24 * 60; dayOffset += 24 * 60) {
    let windowStart = nightStart + dayOffset;
    let windowEnd = nightEnd + dayOffset;
    if (windowEnd <= windowStart) windowEnd += 24 * 60;
    const overlapStart = Math.max(startTotal, windowStart);
    const overlapEnd = Math.min(endTotal, windowEnd);
    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }

  return Math.round((total / 60) * 100) / 100;
}

function employeeName(employee) {
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function lineFor(employeeId, workDate) {
  return planning.lines.find((line) => line.employee_id === employeeId && String(line.work_date).slice(0, 10) === workDate) || null;
}

function totalFor(employeeId) {
  return planning.totals.find((total) => total.employee_id === employeeId)?.planned_hours || 0;
}

function totalActualFor(employeeId) {
  return planning.totals.find((total) => total.employee_id === employeeId)?.actual_hours || 0;
}

function dayTypeOptions(selected) {
  return dayTypes.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function resetEmployeeForm() {
  els.employeeId.value = "";
  els.employeeForm.reset();
  els.employeeContractType.value = "CDI";
  els.employeeWeeklyHours.value = "35";
  els.employeeIsActive.value = "true";
  if (els.employeeUserId) els.employeeUserId.value = "";
  if (els.employeeValidationPin) els.employeeValidationPin.value = "";
  if (els.employeeClearValidationPin) els.employeeClearValidationPin.value = "false";
}

function renderUserOptions() {
  if (!els.employeeUserId) return;
  els.employeeUserId.innerHTML = `<option value="">Aucun compte lie</option>${users.map((user) => (
    `<option value="${user.id}">${escapeHtml(user.email || user.id)}${user.is_active ? "" : " (inactif)"}</option>`
  )).join("")}`;
}

function renderEmployees() {
  if (!employees.length) {
    els.employeesTable.innerHTML = `<tr><td colspan="7">Aucun salarie</td></tr>`;
  } else {
    els.employeesTable.innerHTML = employees.map((employee) => `
      <tr>
        <td>${escapeHtml(employeeName(employee))}</td>
        <td>${escapeHtml(employee.job_title || "-")}</td>
        <td>${escapeHtml(employee.email || "-")}</td>
        <td>${escapeHtml(employee.contract_type || "-")}</td>
        <td>${Number(employee.weekly_hours || 0).toLocaleString("fr-FR")}</td>
        <td>${employee.is_active ? "Actif" : "Inactif"}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-action="edit-employee" data-id="${employee.id}">Modifier</button></td>
      </tr>
    `).join("");
  }

  els.absenceEmployee.innerHTML = employees
    .filter((employee) => employee.is_active)
    .map((employee) => `<option value="${employee.id}">${escapeHtml(employeeName(employee))}</option>`)
    .join("");
}

function renderPlanning() {
  const days = weekDays();
  els.weekLabel.textContent = `Du ${formatDate(dateKey(days[0]))} au ${formatDate(dateKey(days[6]))}`;
  els.planningHead.innerHTML = `<tr><th>Salarie</th>${days.map((day) => `<th>${day.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}</th>`).join("")}<th>Total prevu</th></tr>`;

  const activeEmployees = employees.filter((employee) => employee.is_active);
  if (!activeEmployees.length) {
    els.planningBody.innerHTML = `<tr><td colspan="9">Cree un salarie actif pour commencer le planning.</td></tr>`;
    return;
  }

  els.planningBody.innerHTML = activeEmployees.map((employee) => `
    <tr>
      <td><strong>${escapeHtml(employeeName(employee))}</strong><br><small>${escapeHtml(employee.job_title || "")}</small></td>
      ${days.map((day) => renderPlanningCell(employee, dateKey(day))).join("")}
      <td>
        <strong data-planning-total="${employee.id}">${formatHours(totalFor(employee.id))}</strong>
        <br><small>Reel : <span data-actual-total="${employee.id}">${formatHours(totalActualFor(employee.id))}</span></small>
      </td>
    </tr>
  `).join("");
}

function renderPlanningCell(employee, workDate) {
  const line = lineFor(employee.id, workDate) || {};
  const id = `${employee.id}-${workDate}`;
  const dayType = line.day_type || "worked";
  const plannedBreak = line.planned_break_minutes ?? autoBreakMinutes(formatHour(line.planned_start), formatHour(line.planned_end), dayType);
  return `
    <td>
      <div class="form-group">
        <select data-field="day_type" data-cell="${id}" data-employee-id="${employee.id}">${dayTypeOptions(dayType)}</select>
      </div>
      <div class="filters-row">
        <input aria-label="Debut prevu" data-field="planned_start" data-cell="${id}" data-employee-id="${employee.id}" type="time" value="${formatHour(line.planned_start)}" />
        <input aria-label="Fin prevue" data-field="planned_end" data-cell="${id}" data-employee-id="${employee.id}" type="time" value="${formatHour(line.planned_end)}" />
      </div>
      <div class="filters-row">
        <input aria-label="Pause prevue" data-field="planned_break_minutes" data-cell="${id}" data-employee-id="${employee.id}" data-auto-break="true" type="number" min="0" step="1" value="${plannedBreak || 0}" />
        <button class="btn btn-secondary btn-sm" type="button" data-action="save-line" data-employee-id="${employee.id}" data-work-date="${workDate}" data-line-id="${line.id || ""}">OK</button>
      </div>
      <small>Pause auto : <span data-cell-auto-break="${id}">${autoBreakMinutes(formatHour(line.planned_start), formatHour(line.planned_end), dayType)}</span> min</small><br>
      <small>Prevu : <span data-cell-planned-hours="${id}">${formatHours(line.planned_hours || 0)}</span> - Nuit : <span data-cell-night-hours="${id}">${formatHours(line.night_hours || 0)}</span></small>
    </td>
  `;
}

function planningCellValue(cellId, field) {
  return document.querySelector(`[data-cell="${cellId}"][data-field="${field}"]`)?.value || "";
}

function plannedHoursForCell(cellId) {
  return hoursFromFields(
    planningCellValue(cellId, "planned_start"),
    planningCellValue(cellId, "planned_end"),
    planningCellValue(cellId, "planned_break_minutes"),
    planningCellValue(cellId, "day_type") || "worked"
  );
}

function nightHoursForCell(cellId) {
  return nightHoursFromFields(
    planningCellValue(cellId, "planned_start"),
    planningCellValue(cellId, "planned_end"),
    planningCellValue(cellId, "day_type") || "worked"
  );
}

function refreshPlanningCell(cellId) {
  const dayType = planningCellValue(cellId, "day_type") || "worked";
  const autoBreak = autoBreakMinutes(
    planningCellValue(cellId, "planned_start"),
    planningCellValue(cellId, "planned_end"),
    dayType
  );
  const autoTarget = document.querySelector(`[data-cell-auto-break="${cellId}"]`);
  const breakInput = document.querySelector(`[data-cell="${cellId}"][data-field="planned_break_minutes"]`);
  if (autoTarget) autoTarget.textContent = String(autoBreak);
  if (breakInput?.dataset.autoBreak === "true") breakInput.value = String(autoBreak);
  const target = document.querySelector(`[data-cell-planned-hours="${cellId}"]`);
  if (target) target.textContent = formatHours(plannedHoursForCell(cellId));
  const nightTarget = document.querySelector(`[data-cell-night-hours="${cellId}"]`);
  if (nightTarget) nightTarget.textContent = formatHours(nightHoursForCell(cellId));
}

function refreshEmployeePlannedTotal(employeeId) {
  const total = Array.from(document.querySelectorAll(`[data-employee-id="${employeeId}"][data-field="day_type"]`))
    .reduce((sum, input) => sum + plannedHoursForCell(input.dataset.cell), 0);
  const target = document.querySelector(`[data-planning-total="${employeeId}"]`);
  if (target) target.textContent = formatHours(total);
}

function refreshPlanningHoursFromInput(input) {
  const cellId = input.dataset.cell;
  const employeeId = input.dataset.employeeId;
  if (!cellId || !employeeId) return;
  refreshPlanningCell(cellId);
  refreshEmployeePlannedTotal(employeeId);
}

function validationValue(lineId, field) {
  return document.querySelector(`[data-line-id="${lineId}"][data-validation-field="${field}"]`)?.value || "";
}

function refreshValidationLine(lineId) {
  const row = document.querySelector(`[data-validation-row="${lineId}"]`);
  if (!row) return;
  const breakInput = document.querySelector(`[data-line-id="${lineId}"][data-validation-field="actual_break_minutes"]`);
  if (breakInput?.dataset.autoBreak === "true") {
    breakInput.value = String(autoBreakMinutes(
      validationValue(lineId, "actual_start"),
      validationValue(lineId, "actual_end"),
      row.dataset.dayType || "worked"
    ));
  }

  const plannedHours = hoursFromFields(
    row.dataset.plannedStart,
    row.dataset.plannedEnd,
    row.dataset.plannedBreak,
    row.dataset.dayType || "worked"
  );
  const actualHours = hoursFromFields(
    validationValue(lineId, "actual_start"),
    validationValue(lineId, "actual_end"),
    validationValue(lineId, "actual_break_minutes"),
    row.dataset.dayType || "worked"
  );

  const plannedTarget = document.querySelector(`[data-validation-planned-hours="${lineId}"]`);
  const actualTarget = document.querySelector(`[data-validation-actual-hours="${lineId}"]`);
  const nightTarget = document.querySelector(`[data-validation-night-hours="${lineId}"]`);
  const deltaTarget = document.querySelector(`[data-validation-delta="${lineId}"]`);

  if (plannedTarget) plannedTarget.textContent = formatHours(plannedHours);
  if (actualTarget) actualTarget.textContent = formatHours(actualHours);
  if (nightTarget) nightTarget.textContent = formatHours(nightHoursFromFields(
    validationValue(lineId, "actual_start"),
    validationValue(lineId, "actual_end"),
    row.dataset.dayType || "worked"
  ));
  if (deltaTarget) deltaTarget.textContent = formatHours(actualHours - plannedHours);
  refreshEmployeeActualTotal(row.dataset.employeeId);
}

function refreshEmployeeActualTotal(employeeId) {
  if (!employeeId) return;
  const total = Array.from(document.querySelectorAll(`[data-validation-row][data-employee-id="${employeeId}"]`))
    .reduce((sum, row) => {
      const lineId = row.dataset.validationRow;
      return sum + hoursFromFields(
        validationValue(lineId, "actual_start"),
        validationValue(lineId, "actual_end"),
        validationValue(lineId, "actual_break_minutes"),
        row.dataset.dayType || "worked"
      );
    }, 0);
  const target = document.querySelector(`[data-actual-total="${employeeId}"]`);
  if (target) target.textContent = formatHours(total);
}

function employeeValidationControl(line) {
  const linkedUserId = line.employee_user_id || line.user_id || "";
  if (linkedUserId) {
    if (linkedUserId === sessionUser.id) {
      return `<button class="btn btn-secondary btn-sm" type="button" data-action="employee-validate" data-line-id="${line.id}">Validation salarie</button>`;
    }
    return `<small>La validation salarie doit etre faite par le salarie avec son compte ou son code personnel.</small>`;
  }

  if (line.has_validation_pin) {
    return `<input data-pin-line-id="${line.id}" type="password" inputmode="numeric" autocomplete="one-time-code" placeholder="Code salarie" aria-label="Code personnel salarie" />
      <button class="btn btn-secondary btn-sm" type="button" data-action="employee-validate" data-line-id="${line.id}">Validation salarie</button>`;
  }

  return `<small>Salarie non lie a un compte utilisateur ALTA. La validation salarie doit etre faite par le salarie avec son compte ou son code personnel.</small>`;
}

function renderValidation() {
  const lines = planning.lines.slice().sort((a, b) => `${a.work_date}-${a.last_name}`.localeCompare(`${b.work_date}-${b.last_name}`));
  if (!lines.length) {
    els.validationBody.innerHTML = `<tr><td colspan="12">Aucune ligne a valider</td></tr>`;
    return;
  }

  els.validationBody.innerHTML = lines.map((line) => {
    const actualStart = formatHour(line.actual_start) || formatHour(line.planned_start);
    const actualEnd = formatHour(line.actual_end) || formatHour(line.planned_end);
    const hasActualTimes = Boolean(line.actual_start || line.actual_end);
    const actualBreak = hasActualTimes
      ? (line.actual_break_minutes ?? line.planned_break_minutes ?? autoBreakMinutes(actualStart, actualEnd, line.day_type || "worked"))
      : (line.planned_break_minutes ?? autoBreakMinutes(actualStart, actualEnd, line.day_type || "worked"));
    const actualHours = hoursFromFields(actualStart, actualEnd, actualBreak, line.day_type || "worked");
    const nightHours = nightHoursFromFields(actualStart, actualEnd, line.day_type || "worked");
    return `
    <tr data-validation-row="${line.id}" data-employee-id="${line.employee_id}" data-day-type="${line.day_type || "worked"}" data-planned-start="${formatHour(line.planned_start)}" data-planned-end="${formatHour(line.planned_end)}" data-planned-break="${line.planned_break_minutes || 0}">
      <td>${escapeHtml(`${line.first_name || ""} ${line.last_name || ""}`.trim())}</td>
      <td>${formatDate(line.work_date)}</td>
      <td><input data-validation-field="actual_start" data-line-id="${line.id}" type="time" value="${actualStart}" /></td>
      <td><input data-validation-field="actual_end" data-line-id="${line.id}" type="time" value="${actualEnd}" /></td>
      <td><input data-validation-field="actual_break_minutes" data-line-id="${line.id}" data-auto-break="true" type="number" min="0" step="1" value="${actualBreak || 0}" /></td>
      <td data-validation-planned-hours="${line.id}">${formatHours(line.planned_hours || 0)}</td>
      <td data-validation-actual-hours="${line.id}">${formatHours(actualHours)}</td>
      <td data-validation-night-hours="${line.id}">${formatHours(nightHours)}</td>
      <td data-validation-delta="${line.id}">${formatHours(Number(actualHours || 0) - Number(line.planned_hours || 0))}</td>
      <td>${line.employee_validated_at ? "Valide" : "Non valide"}</td>
      <td>${line.manager_validated_at ? "Valide" : "Non valide"}</td>
      <td>
        <div class="page-actions-right">
          ${employeeValidationControl(line)}
          <button class="btn btn-primary btn-sm" type="button" data-action="manager-validate" data-line-id="${line.id}">Responsable</button>
        </div>
      </td>
    </tr>
  `;
  }).join("");
  employees.forEach((employee) => refreshEmployeeActualTotal(employee.id));
}

function renderAbsences() {
  if (!absenceRequests.length) {
    els.absenceTable.innerHTML = `<tr><td colspan="6">Aucune demande</td></tr>`;
    return;
  }

  els.absenceTable.innerHTML = absenceRequests.map((request) => `
    <tr>
      <td>${escapeHtml(`${request.first_name || ""} ${request.last_name || ""}`.trim())}</td>
      <td>${formatDate(request.start_date)} - ${formatDate(request.end_date)}</td>
      <td>${escapeHtml(absenceLabels[request.absence_type] || request.absence_type || "-")}</td>
      <td>${escapeHtml(statusLabels[request.status] || request.status || "-")}</td>
      <td>${escapeHtml(request.employee_comment || request.manager_comment || "-")}</td>
      <td>${request.status === "pending" ? `<div class="page-actions-right"><button class="btn btn-primary btn-sm" type="button" data-action="approve-absence" data-id="${request.id}">Accepter</button><button class="btn btn-danger btn-sm" type="button" data-action="refuse-absence" data-id="${request.id}">Refuser</button></div>` : "-"}</td>
    </tr>
  `).join("");
}

async function loadEmployees() {
  const data = await apiFetch("/api/employee-planning/employees");
  employees = data.employees || [];
  renderEmployees();
}

async function loadUsers() {
  const data = await apiFetch("/api/employee-planning/users");
  users = data.users || [];
  renderUserOptions();
}

async function loadPlanning() {
  const data = await apiFetch(`/api/employee-planning/weeks/${encodeURIComponent(els.weekStart.value)}`);
  planning = data.planning || { week: null, employees: [], lines: [], totals: [] };
  renderPlanning();
  renderValidation();
}

async function loadAbsences() {
  const data = await apiFetch("/api/employee-planning/absence-requests");
  absenceRequests = data.absence_requests || [];
  renderAbsences();
}

async function refreshAll() {
  clearFeedback(els.employeesFeedback);
  clearFeedback(els.planningFeedback);
  clearFeedback(els.absenceFeedback);
  await loadEmployees();
  await loadUsers();
  await loadPlanning();
  await loadAbsences();
}

async function saveEmployee(event) {
  event.preventDefault();
  clearFeedback(els.employeesFeedback);
  const id = els.employeeId.value;
  const payload = {
    first_name: els.employeeFirstName.value,
    last_name: els.employeeLastName.value,
    email: els.employeeEmail.value,
    phone: els.employeePhone.value,
    job_title: els.employeeJobTitle.value,
    contract_type: els.employeeContractType.value,
    weekly_hours: Number(els.employeeWeeklyHours.value || 35),
    is_active: els.employeeIsActive.value === "true",
    user_id: els.employeeUserId?.value || null,
    validation_pin: els.employeeValidationPin?.value || null,
    clear_validation_pin: els.employeeClearValidationPin?.value === "true",
  };
  await apiFetch(id ? `/api/employee-planning/employees/${encodeURIComponent(id)}` : "/api/employee-planning/employees", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  resetEmployeeForm();
  await refreshAll();
  showFeedback(els.employeesFeedback, "Salarie enregistre.");
}

async function saveLine(button) {
  clearFeedback(els.planningFeedback);
  const employeeId = button.dataset.employeeId;
  const workDate = button.dataset.workDate;
  const cell = `${employeeId}-${workDate}`;
  const value = (field) => document.querySelector(`[data-cell="${cell}"][data-field="${field}"]`)?.value || "";
  await apiFetch("/api/employee-planning/lines", {
    method: "POST",
    body: JSON.stringify({
      week_start: els.weekStart.value,
      employee_id: employeeId,
      work_date: workDate,
      day_type: value("day_type"),
      planned_start: value("planned_start"),
      planned_end: value("planned_end"),
      planned_break_minutes: Number(value("planned_break_minutes") || 0),
    }),
  });
  await loadPlanning();
  showFeedback(els.planningFeedback, "Ligne enregistree.");
}

function validationPayload(lineId) {
  const value = (field) => document.querySelector(`[data-line-id="${lineId}"][data-validation-field="${field}"]`)?.value || "";
  const pin = document.querySelector(`[data-pin-line-id="${lineId}"]`)?.value || "";
  return {
    actual_start: value("actual_start"),
    actual_end: value("actual_end"),
    actual_break_minutes: Number(value("actual_break_minutes") || 0),
    validation_pin: pin || undefined,
  };
}

async function validateLine(lineId, kind) {
  clearFeedback(els.planningFeedback);
  await apiFetch(`/api/employee-planning/lines/${encodeURIComponent(lineId)}/${kind}`, {
    method: "POST",
    body: JSON.stringify(validationPayload(lineId)),
  });
  await loadPlanning();
  showFeedback(els.planningFeedback, "Validation enregistree.");
}

async function createAbsence(event) {
  event.preventDefault();
  clearFeedback(els.absenceFeedback);
  await apiFetch("/api/employee-planning/absence-requests", {
    method: "POST",
    body: JSON.stringify({
      employee_id: els.absenceEmployee.value,
      absence_type: els.absenceType.value,
      start_date: els.absenceStart.value,
      end_date: els.absenceEnd.value,
      employee_comment: els.absenceComment.value,
    }),
  });
  els.absenceForm.reset();
  await loadAbsences();
  showFeedback(els.absenceFeedback, "Demande creee.");
}

async function decideAbsence(id, action) {
  clearFeedback(els.absenceFeedback);
  await apiFetch(`/api/employee-planning/absence-requests/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  await loadAbsences();
  showFeedback(els.absenceFeedback, "Demande mise a jour.");
}

function editEmployee(id) {
  const employee = employees.find((item) => item.id === id);
  if (!employee) return;
  els.employeeId.value = employee.id;
  els.employeeFirstName.value = employee.first_name || "";
  els.employeeLastName.value = employee.last_name || "";
  els.employeeEmail.value = employee.email || "";
  els.employeePhone.value = employee.phone || "";
  els.employeeJobTitle.value = employee.job_title || "";
  els.employeeContractType.value = employee.contract_type || "CDI";
  els.employeeWeeklyHours.value = employee.weekly_hours || 35;
  els.employeeIsActive.value = employee.is_active ? "true" : "false";
  if (els.employeeUserId) els.employeeUserId.value = employee.user_id || "";
  if (els.employeeValidationPin) els.employeeValidationPin.value = "";
  if (els.employeeClearValidationPin) els.employeeClearValidationPin.value = "false";
  els.employeeFirstName.focus();
}

function shiftWeek(days) {
  els.weekStart.value = dateKey(addDays(parseDate(els.weekStart.value), days));
  loadPlanning().catch((error) => showFeedback(els.planningFeedback, error.message, true));
}

function downloadPayrollExport() {
  const month = els.payrollMonth.value;
  if (!month) {
    showFeedback(els.planningFeedback, "Choisis un mois pour exporter.", true);
    return;
  }
  fetch(`${API_BASE}/api/employee-planning/payroll-export?month=${encodeURIComponent(month)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Erreur export");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `export-paie-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }).catch((error) => showFeedback(els.planningFeedback, error.message, true));
}

function bindEvents() {
  els.logout?.addEventListener("click", logout);
  els.backHome?.addEventListener("click", () => { window.location.href = "./home.html"; });
  els.refresh?.addEventListener("click", () => refreshAll().catch((error) => showFeedback(els.planningFeedback, error.message, true)));
  els.employeeForm?.addEventListener("submit", (event) => saveEmployee(event).catch((error) => showFeedback(els.employeesFeedback, error.message, true)));
  els.employeeReset?.addEventListener("click", resetEmployeeForm);
  els.employeesTable?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='edit-employee']");
    if (button) editEmployee(button.dataset.id);
  });
  els.weekStart?.addEventListener("change", () => loadPlanning().catch((error) => showFeedback(els.planningFeedback, error.message, true)));
  els.previousWeek?.addEventListener("click", () => shiftWeek(-7));
  els.nextWeek?.addEventListener("click", () => shiftWeek(7));
  els.planningBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='save-line']");
    if (button) saveLine(button).catch((error) => showFeedback(els.planningFeedback, error.message, true));
  });
  els.planningBody?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-cell][data-field]");
    if (input?.dataset.field === "planned_break_minutes") input.dataset.autoBreak = "false";
    if (input) refreshPlanningHoursFromInput(input);
  });
  els.planningBody?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-cell][data-field]");
    if (input?.dataset.field === "planned_break_minutes") input.dataset.autoBreak = "false";
    if (input) refreshPlanningHoursFromInput(input);
  });
  els.validationBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "employee-validate") validateLine(button.dataset.lineId, "employee-validate").catch((error) => showFeedback(els.planningFeedback, error.message, true));
    if (button.dataset.action === "manager-validate") validateLine(button.dataset.lineId, "manager-validate").catch((error) => showFeedback(els.planningFeedback, error.message, true));
  });
  els.validationBody?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-line-id][data-validation-field]");
    if (input?.dataset.validationField === "actual_break_minutes") input.dataset.autoBreak = "false";
    if (input) refreshValidationLine(input.dataset.lineId);
  });
  els.validationBody?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-line-id][data-validation-field]");
    if (input?.dataset.validationField === "actual_break_minutes") input.dataset.autoBreak = "false";
    if (input) refreshValidationLine(input.dataset.lineId);
  });
  els.absenceForm?.addEventListener("submit", (event) => createAbsence(event).catch((error) => showFeedback(els.absenceFeedback, error.message, true)));
  els.absenceTable?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "approve-absence") decideAbsence(button.dataset.id, "approve").catch((error) => showFeedback(els.absenceFeedback, error.message, true));
    if (button.dataset.action === "refuse-absence") decideAbsence(button.dataset.id, "refuse").catch((error) => showFeedback(els.absenceFeedback, error.message, true));
  });
  els.payrollExport?.addEventListener("click", downloadPayrollExport);
}

async function init() {
  els.userName.textContent = sessionUser.email || "Utilisateur";
  const today = new Date();
  els.weekStart.value = dateKey(mondayOf(today));
  els.payrollMonth.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  bindEvents();
  await refreshAll();
}

init().catch((error) => {
  console.error("Erreur init employee planning :", error);
  showFeedback(els.planningFeedback, error.message || "Erreur chargement planning", true);
});
