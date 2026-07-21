const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { CASHFLOW_PERMISSIONS, requireCashflowPermission } = require('../services/cashflow/permissions');
const { runCashflowDiagnostic, syncCashflowData, PENNYLANE_CASHFLOW_CAPABILITIES } = require('../services/cashflow/pennylaneCashflowService');
const {
  chargeCompletionAlerts,
  calculateCustomerBehaviour,
  getDashboard,
  getDistrimer,
  getForecast,
  getSettings,
  latestDiagnostics,
  listBankAccounts,
  listBankTransactions,
  listCustomerReceivables,
  listPaidCustomerHistory,
  listRecurringCharges,
  listSupplierPayables,
  sendForecastExport,
  settingsForDistrimer,
  simulateDistrimerPayment,
  updateSettings,
} = require('../services/cashflow/service');
const {
  createManualItem,
  deleteManualItem,
  listManualItems,
  updateManualItem,
} = require('../services/cashflow/manualForecastService');

const router = express.Router();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function handleError(res, err) {
  const status = err.status || 500;
  const payload = { error: err.message || 'Erreur tresorerie' };
  if (status >= 500) {
    console.error('Erreur tresorerie :', {
      message: err.message,
      status,
      code: err.code || null,
    });
  } else {
    console.warn('Erreur fonctionnelle tresorerie :', {
      message: err.message,
      status,
      code: err.code || null,
    });
  }
  return res.status(status).json(payload);
}

router.use(authenticateToken, attachDbContext);

router.get('/cashflow/dashboard', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json(await getDashboard(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/sync', requireCashflowPermission(CASHFLOW_PERMISSIONS.SYNC), async (req, res) => {
  try {
    const result = await syncCashflowData(req.dbPool, {
      storeId: req.user.store_id,
      userId: req.user.id,
    });
    return res.status(202).json({
      ok: true,
      result,
      pennylane: PENNYLANE_CASHFLOW_CAPABILITIES,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/diagnostic', requireCashflowPermission(CASHFLOW_PERMISSIONS.SYNC), async (req, res) => {
  try {
    return res.json({
      diagnostics: await runCashflowDiagnostic(req.dbPool, { storeId: req.user.store_id }),
      pennylane: PENNYLANE_CASHFLOW_CAPABILITIES,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/diagnostic', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ diagnostics: await latestDiagnostics(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/forecast', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json(await getForecast(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/customer-receivables', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    const invoices = await listCustomerReceivables(req.dbPool, req.user.store_id);
    const history = await listPaidCustomerHistory(req.dbPool, req.user.store_id);
    return res.json({
      invoices,
      behaviours: calculateCustomerBehaviour(history),
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/supplier-payables', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ invoices: await listSupplierPayables(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/bank-transactions', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({
      transactions: await listBankTransactions(req.dbPool, req.user.store_id, req.query),
      warning: null,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/bank-accounts', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ accounts: await listBankAccounts(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/distrimer', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json(await getDistrimer(req.dbPool, req.user.store_id));
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/distrimer/simulate', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    const settings = await getSettings(req.dbPool, req.user.store_id);
    return res.json(simulateDistrimerPayment({
      currentExposure: req.body.current_exposure,
      plannedPurchases: req.body.planned_purchases,
      bankBalance: req.body.bank_balance,
      expectedInflows: req.body.expected_inflows,
      paymentAmount: req.body.payment_amount,
      deadline: req.body.deadline,
      settings: settingsForDistrimer(settings),
    }));
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/manual-items', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ items: await listManualItems(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/recurring-charges', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ charges: await listRecurringCharges(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/recurring-charges', requireCashflowPermission(CASHFLOW_PERMISSIONS.MANAGE), async (req, res) => {
  try {
    const amount = Number(req.body.cash_amount || req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
    if (!req.body.label || !req.body.first_due_date) return res.status(400).json({ error: 'Libelle et premiere echeance obligatoires' });
    const result = await req.dbPool.query(
      `
      INSERT INTO cashflow_recurring_charges(
        store_id, label, category_code, cash_amount, first_due_date, frequency, due_day,
        end_date, active, adjust_non_working_days, comment, created_by
      )
      VALUES($1, $2, $3, $4, $5::date, $6, $7, $8::date, $9, $10, $11, $12)
      RETURNING *
      `,
      [
        req.user.store_id,
        String(req.body.label).trim(),
        req.body.category_code || 'other',
        amount,
        req.body.first_due_date,
        req.body.frequency || 'monthly',
        req.body.due_day || null,
        req.body.end_date || null,
        req.body.active !== false,
        req.body.adjust_non_working_days === true,
        req.body.comment || null,
        req.user.id,
      ]
    );
    return res.status(201).json({ charge: result.rows[0] });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/charges-to-complete', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json(await chargeCompletionAlerts(req.dbPool, req.user.store_id));
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/manual-items', requireCashflowPermission(CASHFLOW_PERMISSIONS.MANAGE), async (req, res) => {
  try {
    const item = await createManualItem(req.dbPool, {
      storeId: req.user.store_id,
      userId: req.user.id,
      body: req.body,
    });
    return res.status(201).json({ item });
  } catch (err) {
    return handleError(res, err);
  }
});

router.put('/cashflow/manual-items/:id', requireCashflowPermission(CASHFLOW_PERMISSIONS.MANAGE), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant mouvement invalide' });
    const item = await updateManualItem(req.dbPool, {
      storeId: req.user.store_id,
      id: req.params.id,
      body: req.body,
    });
    if (!item) return res.status(404).json({ error: 'Mouvement introuvable' });
    return res.json({ item });
  } catch (err) {
    return handleError(res, err);
  }
});

router.delete('/cashflow/manual-items/:id', requireCashflowPermission(CASHFLOW_PERMISSIONS.MANAGE), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant mouvement invalide' });
    const deleted = await deleteManualItem(req.dbPool, {
      storeId: req.user.store_id,
      id: req.params.id,
    });
    if (!deleted) return res.status(404).json({ error: 'Mouvement introuvable' });
    return res.status(204).send();
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/settings', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ settings: await getSettings(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.put('/cashflow/settings', requireCashflowPermission(CASHFLOW_PERMISSIONS.SETTINGS), async (req, res) => {
  try {
    return res.json({ settings: await updateSettings(req.dbPool, req.user.store_id, req.body) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/export', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    const forecast = await getForecast(req.dbPool, req.user.store_id, req.query);
    return sendForecastExport(res, forecast, String(req.query.format || 'csv').toLowerCase());
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;
