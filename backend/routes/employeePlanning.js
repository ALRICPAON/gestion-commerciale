'use strict';

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const service = require('../services/employeePlanningService');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function csvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

router.use(authenticateToken, attachDbContext);

router.get('/employees', asyncHandler(async (req, res) => {
  const employees = await service.listEmployees(req);
  res.json({ ok: true, employees });
}));

router.post('/employees', asyncHandler(async (req, res) => {
  const employee = await service.createEmployee(req, req.body || {});
  res.status(201).json({ ok: true, employee });
}));

router.put('/employees/:id', asyncHandler(async (req, res) => {
  const employee = await service.updateEmployee(req, req.params.id, req.body || {});
  res.json({ ok: true, employee });
}));

router.get('/weeks/:weekStart', asyncHandler(async (req, res) => {
  const planning = await service.getPlanningWeek(req, req.params.weekStart);
  res.json({ ok: true, planning });
}));

router.post('/lines', asyncHandler(async (req, res) => {
  const line = await service.upsertPlanningLine(req, req.body || {});
  res.json({ ok: true, line });
}));

router.post('/lines/:id/employee-validate', asyncHandler(async (req, res) => {
  const line = await service.employeeValidateLine(req, req.params.id, req.body || {});
  res.json({ ok: true, line });
}));

router.post('/lines/:id/manager-validate', asyncHandler(async (req, res) => {
  const line = await service.managerValidateLine(req, req.params.id, req.body || {});
  res.json({ ok: true, line });
}));

router.get('/payroll-export', asyncHandler(async (req, res) => {
  const rows = await service.exportPayroll(req, req.query.month);

  const header = [
    'Salarié',
    'Poste',
    'Semaine du',
    'Heures prévues',
    'Heures réelles',
    'Écart heures',
    'Heures normales',
    'Heures supplémentaires',
    'Heures de nuit',
    'Congés payés',
    'Absences maladie',
    'Absences non rémunérées',
    'Récupération',
    'Formation',
    'Jours fériés',
    'Validé salarié',
    'Date validation salarié',
    'Validé responsable',
    'Date validation responsable',
    'Commentaire',
  ];

  const csvRows = [
    header.join(';'),
    ...rows.map((row) => [
      row.salarie,
      row.poste,
      formatDate(row.semaine_du),
      row.heures_prevues,
      row.heures_reelles,
      row.ecart_heures,
      row.heures_normales,
      row.heures_supplementaires,
      row.heures_de_nuit,
      row.conges_payes,
      row.absences_maladie,
      row.absences_non_remunerees,
      row.recuperation,
      row.formation,
      row.jours_feries,
      row.valide_salarie ? 'oui' : 'non',
      formatDate(row.date_validation_salarie),
      row.valide_responsable ? 'oui' : 'non',
      formatDate(row.date_validation_responsable),
      row.commentaire || '',
    ].map(csvValue).join(';')),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export-paie-${req.query.month}.csv"`);
  res.send(`\uFEFF${csvRows.join('\n')}`);
}));

router.get('/absence-requests', asyncHandler(async (req, res) => {
  const absenceRequests = await service.listAbsenceRequests(req);
  res.json({ ok: true, absence_requests: absenceRequests });
}));

router.post('/absence-requests', asyncHandler(async (req, res) => {
  const absenceRequest = await service.createAbsenceRequest(req, req.body || {});
  res.status(201).json({ ok: true, absence_request: absenceRequest });
}));

router.post('/absence-requests/:id/approve', asyncHandler(async (req, res) => {
  const absenceRequest = await service.decideAbsenceRequest(req, req.params.id, 'approved', req.body || {});
  res.json({ ok: true, absence_request: absenceRequest });
}));

router.post('/absence-requests/:id/refuse', asyncHandler(async (req, res) => {
  const absenceRequest = await service.decideAbsenceRequest(req, req.params.id, 'refused', req.body || {});
  res.json({ ok: true, absence_request: absenceRequest });
}));

router.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error('Erreur employee planning :', err);
  }
  return res.status(status).json({ error: err.message || 'Erreur serveur' });
});

module.exports = router;
